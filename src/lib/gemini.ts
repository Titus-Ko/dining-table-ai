import { GoogleGenerativeAI } from '@google/generative-ai';
import type { DiscourseMessage, ResponseLength, SeatConfig } from '@/types/discourse';

export function getFreeGeminiApiKeys(): string[] {
  const envVars = [
    process.env.GEMINI_FREE_API_KEYS,
    process.env.GEMINI_FREE_API_KEY,
    process.env.GEMINI_FREE_KEY,
    process.env.GEMINI_FREE_KEY_1,
    process.env.GEMINI_FREE_KEY_2,
    process.env.GEMINI_FREE_KEY_3,
    process.env.GEMINI_FREE_KEY_4,
    process.env.GEMINI_FREE_KEY_5,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY2,
    process.env.GEMINI_KEY_2,
    process.env.GOOGLE_API_KEY_2,
    process.env.NEXT_PUBLIC_GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.NEXT_PUBLIC_GEMINI_API_KEY,
  ];

  const keys: string[] = [];
  for (const val of envVars) {
    if (
      val &&
      typeof val === 'string' &&
      val.trim() &&
      val.trim() !== 'your_actual_api_key_here' &&
      val.trim() !== 'your_gemini_api_key_here' &&
      val.trim() !== 'your_optional_backup_gemini_key_here'
    ) {
      val.split(',').forEach((k) => {
        const cleaned = k.trim();
        if (cleaned && !keys.includes(cleaned)) {
          keys.push(cleaned);
        }
      });
    }
  }
  return keys.reverse();
}

export function getPaidGeminiApiKeys(): string[] {
  const envVars = [
    process.env.GEMINI_PAID_API_KEYS,
    process.env.GEMINI_PAID_API_KEY,
    process.env.GEMINI_PAID_KEY,
    process.env.GEMINI_PAID_KEY_1,
    process.env.GEMINI_PAID_KEY_2,
    process.env.GEMINI_PAID_KEY_3,
    process.env.GEMINI_API_KEY_PAID,
    process.env.GEMINI_KEY_PAID,
    process.env.PAID_GEMINI_API_KEY,
    process.env.GEMINI_BACKUP_API_KEY,
    process.env.GEMINI_BACKUP_PAID_API_KEY,
  ];

  const keys: string[] = [];
  const freeKeys = getFreeGeminiApiKeys();
  for (const val of envVars) {
    if (
      val &&
      typeof val === 'string' &&
      val.trim() &&
      val.trim() !== 'your_actual_api_key_here' &&
      val.trim() !== 'your_gemini_api_key_here'
    ) {
      val.split(',').forEach((k) => {
        const cleaned = k.trim();
        if (cleaned && !keys.includes(cleaned) && !freeKeys.includes(cleaned)) {
          keys.push(cleaned);
        }
      });
    }
  }
  return keys.reverse();
}

const exhaustedKeys = new Set<string>();
const dailyExhaustedKeyModels = new Set<string>();

function classifyError(errMsg: string): 'permanent' | 'daily_quota' | 'rate_limit' | 'transient' | 'fatal' {
  const lower = errMsg.toLowerCase();
  if (
    lower.includes('perday') ||
    lower.includes('per_day') ||
    lower.includes('requests per day') ||
    lower.includes('generaterequestsperday')
  ) {
    return 'daily_quota';
  }
  if (
    lower.includes('retry in') ||
    lower.includes('retrydelay') ||
    lower.includes('per minute') ||
    lower.includes('per_minute')
  ) {
    return 'rate_limit';
  }
  if (
    lower.includes('402') ||
    lower.includes('payment required') ||
    lower.includes('prepayment credits are depleted') ||
    lower.includes('credits are depleted') ||
    lower.includes('account has been suspended') ||
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid') ||
    lower.includes('403') ||
    lower.includes('forbidden')
  ) {
    return 'permanent';
  }
  if (
    lower.includes('429') ||
    lower.includes('too many requests') ||
    lower.includes('resource_exhausted') ||
    lower.includes('rate limit')
  ) {
    return 'rate_limit';
  }
  if (
    lower.includes('503') ||
    lower.includes('500') ||
    lower.includes('502') ||
    lower.includes('504') ||
    lower.includes('service unavailable') ||
    lower.includes('high demand') ||
    lower.includes('fetch failed') ||
    lower.includes('network') ||
    lower.includes('timeout')
  ) {
    return 'transient';
  }
  return 'fatal';
}

function getModelFallbackChain(requestedModel: string): string[] {
  const clean = (requestedModel || 'gemini-3.7-flash').trim();
  const fallbacks = [
    clean,
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
  ];
  return Array.from(new Set(fallbacks));
}

export interface GenerateTurnInput {
  topic: string;
  activeSeat: SeatConfig;
  allSeats: SeatConfig[];
  history: DiscourseMessage[];
  round: number;
  responseLength: ResponseLength;
  customApiKey?: string;
}

export interface GenerateTurnOutput {
  content: string;
  requestedModel: string;
  actualModel: string;
  latencyMs: number;
}

function buildDiscoursePrompts(input: GenerateTurnInput): {
  systemInstruction: string;
  userPrompt: string;
} {
  const { topic, activeSeat, allSeats, history, round, responseLength } = input;
  const enabledSeats = allSeats.filter((s) => s.enabled);

  const lengthDirective =
    responseLength === 'concise'
      ? 'Keep your response punchy, sharp, and conversational: 2 to 4 sentences maximum (roughly 50–90 words), like a real remark across a dinner table.'
      : responseLength === 'balanced'
      ? 'Keep your response focused and engaging: 1 to 2 tight paragraphs (roughly 100–170 words). Make a clear point and directly address others at the table.'
      : 'Provide a substantive, deeply reasoned contribution of 2 to 3 paragraphs (roughly 180–280 words), unpacking nuances, evidence, and counter-arguments.';

  const effectivePersona = activeSeat.persona.trim()
    ? activeSeat.persona.trim()
    : activeSeat.defaultPersonaHint;

  const rosterDescription = enabledSeats
    .map((s) => {
      const who = s.role === 'human' ? 'Human Participant at the table' : `AI (${s.model})`;
      const p = s.persona.trim() ? s.persona.trim() : s.defaultPersonaHint;
      const marker = s.id === activeSeat.id ? ' <-- YOU ARE SPEAKING NOW' : '';
      return `- Seat ${s.id} (${s.name}) [${who}]: ${p}${marker}`;
    })
    .join('\n');

  const systemInstruction = `You are "${activeSeat.name}" sitting at Seat ${activeSeat.id} of "Dining Table AI", an intellectual dinner-table discourse simulation.

DEBATE TOPIC AT THE TABLE:
"${topic}"

SEATED PARTICIPANTS AROUND THE TABLE:
${rosterDescription}

YOUR ROLE & PERSPECTIVE:
${effectivePersona}

DINNER-TABLE DISCOURSE RULES:
1. Speak directly in the first person as ${activeSeat.name}. Do NOT prefix your response with your name or "[Seat ${activeSeat.id}]:".
2. Treat this as a live, dynamic conversation around a dining table: directly reference, challenge, refine, or build on specific points made by previous speakers by name when history exists.
3. Avoid generic filler openings ("Thank you", "That's a great point", "As an AI"). Dive straight into your argument, counter-example, or provocative question.
4. Maintain intellectual distinctiveness from the other seats so the table doesn't collapse into bland agreement.
5. ${lengthDirective}`;

  let transcriptText = '';
  if (history.length === 0) {
    transcriptText =
      '(No one has spoken yet. You have the opening remarks at the table for Round 1. Frame the debate boldly and stake out your initial position!)';
  } else {
    transcriptText = history
      .map((msg) => {
        if (msg.role === 'moderator') {
          return `[Table Host / Moderator Guidance]: ${msg.content}`;
        }
        return `[Round ${msg.round} · ${msg.speakerName} (Seat ${msg.seatId})]: ${msg.content}`;
      })
      .join('\n\n');
  }

  const userPrompt = `CURRENT ROUND: Round ${round}
TOPIC: "${topic}"

DISCOURSE TRANSCRIPT SO FAR:
${transcriptText}

Now it is your turn to speak at the dining table as ${activeSeat.name} (Seat ${activeSeat.id}). Deliver your response:`;

  return { systemInstruction, userPrompt };
}

export async function generateDiscourseTurn(input: GenerateTurnInput): Promise<GenerateTurnOutput> {
  const startTime = Date.now();
  const { systemInstruction, userPrompt } = buildDiscoursePrompts(input);

  const customKey = input.customApiKey?.trim();
  const trialKeys: string[] = [];

  if (customKey) {
    trialKeys.push(customKey);
  } else {
    const free = getFreeGeminiApiKeys().filter((k) => !exhaustedKeys.has(k));
    const paid = getPaidGeminiApiKeys().filter((k) => !exhaustedKeys.has(k));
    trialKeys.push(...free, ...paid);
  }

  if (trialKeys.length === 0) {
    throw new Error(
      'No Gemini API key found. Add GEMINI_API_KEY to .env.local or enter your API key in the top-right API Key settings.'
    );
  }

  const candidateModels = getModelFallbackChain(input.activeSeat.model);
  let lastError: unknown = null;

  for (const currentModel of candidateModels) {
    for (let keyIdx = 0; keyIdx < trialKeys.length; keyIdx++) {
      const apiKey = trialKeys[keyIdx];
      if (!customKey && exhaustedKeys.has(apiKey)) continue;
      if (!customKey && dailyExhaustedKeyModels.has(`${apiKey}:${currentModel}`)) continue;

      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: currentModel,
        systemInstruction,
      });

      for (let retry = 0; retry < 2; retry++) {
        try {
          const result = await model.generateContent(userPrompt);
          const text = result.response.text().trim();
          if (!text) {
            throw new Error(`Empty response from ${currentModel}`);
          }
          return {
            content: text,
            requestedModel: input.activeSeat.model,
            actualModel: currentModel,
            latencyMs: Date.now() - startTime,
          };
        } catch (err: unknown) {
          lastError = err;
          const errMsg = err instanceof Error ? err.message : String(err);
          const kind = classifyError(errMsg);

          if (kind === 'permanent' && !customKey) {
            exhaustedKeys.add(apiKey);
            break;
          }
          if (kind === 'daily_quota' && !customKey) {
            dailyExhaustedKeyModels.add(`${apiKey}:${currentModel}`);
            break;
          }
          if (kind === 'rate_limit') {
            if (keyIdx < trialKeys.length - 1) {
              break; // try next key immediately
            }
            if (retry === 0) {
              await new Promise((r) => setTimeout(r, 1500));
              continue;
            }
            break;
          }
          if (kind === 'transient' && retry === 0) {
            await new Promise((r) => setTimeout(r, 1000));
            continue;
          }
          break; // try next key or fallback model
        }
      }
    }
  }

  const finalMessage =
    lastError instanceof Error ? lastError.message : 'All configured Gemini keys and fallback models failed.';
  throw new Error(finalMessage);
}
