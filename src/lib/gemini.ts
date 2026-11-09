import fs from 'fs';
import path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { DiscourseMessage, ResponseLength, SeatConfig } from '@/types/discourse';

/**
 * Retrieve the single configured GEMINI_API_KEY for Dining Table AI from .env.local.
 * Reads directly from disk first so edits to .env.local take effect immediately without restarting the dev server.
 */
export function getConfiguredGeminiKey(): string | null {
  const candidateFiles = [
    path.resolve(process.cwd(), 'dining-table-ai', '.env.local'),
    path.resolve(process.cwd(), '.env.local'),
  ];

  for (const filePath of candidateFiles) {
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split(/\r?\n/);
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line || line.startsWith('#')) continue;
          const match = line.match(/^GEMINI_API_KEY\s*=\s*(.+)$/);
          if (match) {
            const val = match[1].trim().replace(/^['"]|['"]$/g, '');
            if (
              val &&
              val !== 'your_actual_api_key_here' &&
              val !== 'your_gemini_api_key_here'
            ) {
              return val;
            }
          }
        }
        // Also allow if the user pasted the raw key on a line by itself
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (line && !line.startsWith('#') && !line.includes('=')) {
            return line;
          }
        }
      }
    } catch {
      // Ignore file read errors and fall back to process.env
    }
  }

  const envVal = process.env.GEMINI_API_KEY?.trim();
  if (
    envVal &&
    envVal !== 'your_actual_api_key_here' &&
    envVal !== 'your_gemini_api_key_here'
  ) {
    return envVal;
  }
  return null;
}

const unavailableModels = new Set<string>();

function getModelFallbackChain(requestedModel: string): string[] {
  const clean = (requestedModel || 'gemini-3.5-flash-lite').trim();
  const fallbacks = [
    clean,
    'gemini-3.5-flash-lite',
    'gemini-3.5-flash',
    'gemini-3.6-flash',
    'gemini-3.7-flash',
    'gemini-3.8-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
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
      ? 'Keep it super short and punchy (35–65 words max): 1 quick reaction sentence followed by 2–3 short bullet points.'
      : responseLength === 'balanced'
      ? 'Keep it brief and scannable (65–110 words max): 1–2 plain-English sentences plus 3–4 crisp bullet points.'
      : 'Keep it clear and structured (110–160 words max): a brief point followed by 4–5 detailed bullet points in plain language.';

  const effectivePersona = activeSeat.persona.trim()
    ? activeSeat.persona.trim()
    : activeSeat.defaultPersonaHint;

  // IMPORTANT: Other seats' internal personas/instructions are strictly private.
  // Each seat only knows the names/seat numbers of who else is at the table, plus what they say out loud.
  const rosterDescription = enabledSeats
    .map((s) => {
      const marker = s.id === activeSeat.id ? ' (YOU)' : '';
      return `- Seat ${s.id}: ${s.name}${marker}`;
    })
    .join('\n');

  const systemInstruction = `You are "${activeSeat.name}" sitting at Seat ${activeSeat.id} of "Dining Table AI", a lively dinner-table debate.

DEBATE TOPIC:
"${topic}"

PEOPLE AT THE TABLE (You only know what others say out loud, NOT their internal thoughts or hidden personas):
${rosterDescription}

YOUR PRIVATE THINKING STYLE & STANCE (Known ONLY to you):
${effectivePersona}

HOW TO SPEAK & FORMAT YOUR RESPONSE:
1. USE PLAIN LAYMAN'S ENGLISH: Talk like a sharp, everyday person at a dinner table. Avoid big academic words, jargon, or stiff essay language. Use simple, relatable examples.
2. BE BRIEF & LESS VERBOSE: Cut all fluff. Never say "Thank you", "That's a great point", or "As an AI". Jump straight into your point.
3. USE BULLET POINTS OFTEN: Format the core of your response using short, easy-to-scan bullet points ("- ") so your arguments are quick to read.
4. PRIORITIZE THE LAST 1–2 MESSAGES + TRACK DEVELOPING THREADS:
   - Put most of your focus on directly reacting to the LAST 1–2 messages just spoken at the table.
   - Keep earlier messages in mind so you don't repeat points, and only reach back to an earlier message if you are continuing a developing line of reasoning or calling out a contradiction.
5. Speak in the first person as ${activeSeat.name}. Do NOT prefix your response with your name or "[Seat ${activeSeat.id}]:".
6. ${lengthDirective}`;

  let transcriptSection = '';
  if (history.length === 0) {
    transcriptSection =
      '(No one has spoken yet. Kick off Round 1 with a short, plain-English take and 2–3 bullet points!)';
  } else {
    const recentCount = Math.min(2, history.length);
    const earlierMessages = history.slice(0, history.length - recentCount);
    const latestMessages = history.slice(history.length - recentCount);

    const formatMsg = (msg: DiscourseMessage) => {
      if (msg.role === 'moderator') {
        return `[Table Host / Moderator Guidance]: ${msg.content}`;
      }
      return `[Round ${msg.round} · ${msg.speakerName} (Seat ${msg.seatId})]:\n${msg.content}`;
    };

    const earlierBlock =
      earlierMessages.length > 0
        ? `EARLIER SPOKEN MESSAGES AT THE TABLE (Keep in mind for context & developing lines of reasoning):\n${earlierMessages
            .map(formatMsg)
            .join('\n\n')}\n\n`
        : '';

    const latestBlock = `LAST ${latestMessages.length} SPOKEN MESSAGE(S) (Put your primary focus on responding to these!):\n${latestMessages
      .map(formatMsg)
      .join('\n\n')}`;

    transcriptSection = `${earlierBlock}${latestBlock}`;
  }

  const userPrompt = `CURRENT ROUND: Round ${round}
TOPIC: "${topic}"

${transcriptSection}

Your turn as ${activeSeat.name} (Seat ${activeSeat.id}). Reply in plain layman's terms using short bullet points:`;

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
