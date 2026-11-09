import { GoogleGenerativeAI } from '@google/generative-ai';
import type { DiscourseMessage, ResponseLength, SeatConfig } from '@/types/discourse';

/**
 * Retrieve the single configured GEMINI_API_KEY for Dining Table AI from .env.local.
 */
export function getConfiguredGeminiKey(): string | null {
  const val = process.env.GEMINI_API_KEY?.trim();
  if (
    !val ||
    val === 'your_actual_api_key_here' ||
    val === 'your_gemini_api_key_here'
  ) {
    return null;
  }
  return val;
}

const unavailableModels = new Set<string>();

function getModelFallbackChain(requestedModel: string): string[] {
  const clean = (requestedModel || 'gemini-2.5-flash').trim();
  const fallbacks = [
    clean,
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-2.0-flash',
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
  ];
  return Array.from(new Set(fallbacks)).filter((m) => !unavailableModels.has(m));
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

  const apiKey = input.customApiKey?.trim() || getConfiguredGeminiKey();

  if (!apiKey) {
    throw new Error(
      'No Gemini API key found. Set GEMINI_API_KEY in dining-table-ai/.env.local or click "🔑 API Key" in the top-right corner of the app.'
    );
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const candidateModels = getModelFallbackChain(input.activeSeat.model);
  let lastError: unknown = null;

  for (const currentModel of candidateModels) {
    try {
      const model = genAI.getGenerativeModel({
        model: currentModel,
        systemInstruction,
      });

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
      const errMsg = (err instanceof Error ? err.message : String(err)).toLowerCase();
      if (errMsg.includes('api_key_invalid') || errMsg.includes('api key not valid') || errMsg.includes('403')) {
        throw err;
      }
      if (errMsg.includes('404') || errMsg.includes('not found') || errMsg.includes('not supported')) {
        unavailableModels.add(currentModel);
      }
    }
  }

  const finalMessage =
    lastError instanceof Error ? lastError.message : 'Failed to generate response with the configured Gemini API key.';
  throw new Error(finalMessage);
}
