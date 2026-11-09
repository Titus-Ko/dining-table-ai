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

  // Separate moderator/host guidance notes from spoken seat messages
  const hostGuidanceMessages = history.filter((m) => m.role === 'moderator');
  const latestHostGuidance =
    hostGuidanceMessages.length > 0
      ? hostGuidanceMessages[hostGuidanceMessages.length - 1].content
      : null;

  const spokenHistory = history.filter((m) => m.role !== 'moderator');
  const currentMessageNumber = spokenHistory.length + 1;
  const isOpeningFour = currentMessageNumber <= 4;
  const isFifthMessageAnchor = currentMessageNumber % 5 === 0;
  const isStrongHostFocusTurn = isOpeningFour || isFifthMessageAnchor;

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

  const hostPriorityBlock = latestHostGuidance
    ? `ACTIVE TABLE HOST GUIDANCE (HIGHEST PRIORITY — MUST STEER YOUR RESPONSE):
"${latestHostGuidance}"
(All active host notes so far: ${hostGuidanceMessages.map((m) => `"${m.content}"`).join(' -> ')})`
    : `ACTIVE TABLE HOST GUIDANCE:
Follow the main Host Prompt Topic closely: "${topic}"`;

  const fifthMessageDirective = isOpeningFour
    ? `\nCRITICAL OPENING ROUND RULE (Message #${currentMessageNumber} of First 4):
Because this is one of the FIRST 4 MESSAGES at the table, you MUST heavily focus on directly answering the core Host Prompt Topic ("${topic}")${
        latestHostGuidance ? ` and the Table Host Guidance ("${latestHostGuidance}")` : ''
      }. Do NOT drift onto a side tangent from the previous speaker—give your seat's direct, plain-English take on the Host Prompt Topic while briefly reacting to the last speaker.`
    : isFifthMessageAnchor
    ? `\nCRITICAL 5TH-MESSAGE CHECKPOINT (Message #${currentMessageNumber}):
Because this is the ${currentMessageNumber}th spoken message at the table (every 5th message rule), you MUST strongly re-anchor the discussion to the Host Prompt Topic ("${topic}")${
        latestHostGuidance ? ` and the Table Host Guidance ("${latestHostGuidance}")` : ''
      }. Pull the table back from any narrow side-tangents, directly address the core host prompt, and connect the recent points directly to what the Host asked.`
    : `\nHOST TOPIC ALIGNMENT:
Always keep the Host Prompt Topic ("${topic}")${
        latestHostGuidance ? ` and the Table Host Guidance ("${latestHostGuidance}")` : ''
      } in consideration while responding, ensuring the conversation never drifts off-topic.`;

  const systemInstruction = `You are "${activeSeat.name}" sitting at Seat ${activeSeat.id} of "Dining Table AI", a lively dinner-table debate.

MAIN HOST PROMPT TOPIC:
"${topic}"

${hostPriorityBlock}
${fifthMessageDirective}

PEOPLE AT THE TABLE (You only know what others say out loud, NOT their internal thoughts or hidden personas):
${rosterDescription}

YOUR PRIVATE THINKING STYLE & STANCE (Known ONLY to you):
${effectivePersona}

HOW TO SPEAK & FORMAT YOUR RESPONSE:
1. TABLE HOST PRIORITY: Table Host Guidance and the Host Prompt Topic always take top priority in steering what you discuss. Every seat must keep the host topic in mind on every turn${
    isStrongHostFocusTurn
      ? ', and on this turn (First 4 Opening / 5th-Message Checkpoint) you MUST strongly center your response on the Host Prompt Topic and Host Guidance!'
      : '.'
  }
2. USE PLAIN LAYMAN'S ENGLISH: Talk like a sharp, everyday person at a dinner table. Avoid big academic words, jargon, or stiff essay language. Use simple, relatable examples.
3. BE BRIEF & LESS VERBOSE: Cut all fluff. Never say "Thank you", "That's a great point", or "As an AI". Jump straight into your point.
4. USE BULLET POINTS OFTEN: Format the core of your response using short, easy-to-scan bullet points ("- ") so your arguments are quick to read.
5. PRIORITIZE THE LAST 1–2 MESSAGES + TRACK DEVELOPING THREADS:
   - Put most of your focus on directly reacting to the LAST 1–2 messages just spoken at the table (and any Table Host Guidance).
   - Keep earlier messages in mind so you don't repeat points, and reach back to an earlier message when continuing a developing line of reasoning.
6. Speak in the first person as ${activeSeat.name}. Do NOT prefix your response with your name or "[Seat ${activeSeat.id}]:".
7. ${lengthDirective}`;

  let transcriptSection = '';
  if (history.length === 0) {
    transcriptSection =
      '(No one has spoken yet. Kick off Round 1 by directly addressing the Host Prompt Topic in plain layman’s English with 2–3 bullet points!)';
  } else {
    const recentCount = Math.min(2, spokenHistory.length);
    const earlierMessages = spokenHistory.slice(0, spokenHistory.length - recentCount);
    const latestMessages = spokenHistory.slice(spokenHistory.length - recentCount);

    const formatMsg = (msg: DiscourseMessage) =>
      `[Round ${msg.round} · ${msg.speakerName} (Seat ${msg.seatId})]:\n${msg.content}`;

    const earlierBlock =
      earlierMessages.length > 0
        ? `EARLIER SPOKEN MESSAGES AT THE TABLE (Context & developing lines of reasoning):\n${earlierMessages
            .map(formatMsg)
            .join('\n\n')}\n\n`
        : '';

    const latestBlock =
      latestMessages.length > 0
        ? `LAST ${latestMessages.length} SPOKEN MESSAGE(S) (Put primary focus on these while honoring Host Guidance):\n${latestMessages
            .map(formatMsg)
            .join('\n\n')}`
        : '';

    transcriptSection = `${earlierBlock}${latestBlock}`;
  }

  const userPrompt = `CURRENT ROUND: Round ${round} · Spoken Message #${currentMessageNumber}${
    isOpeningFour
      ? ' (🎯 Opening 4 Messages — Strong Host Topic Focus!)'
      : isFifthMessageAnchor
      ? ' (🎯 5th-Message Host Topic Re-Anchor Turn!)'
      : ''
  }
HOST PROMPT TOPIC: "${topic}"
${
  latestHostGuidance
    ? `PRIORITY TABLE HOST GUIDANCE (MUST FOLLOW): "${latestHostGuidance}"\n`
    : ''
}
${transcriptSection}

${
  isOpeningFour
    ? `IMPORTANT (Opening 4 Messages Rule): Since this is Message #${currentMessageNumber} of the first 4 opening turns, put heavy focus on directly answering the Host Prompt Topic ("${topic}")${
        latestHostGuidance ? ` and Table Host Guidance ("${latestHostGuidance}")` : ''
      } alongside your reaction to the previous speaker.\n`
    : isFifthMessageAnchor
    ? `IMPORTANT (5th Message Rule): Strongly consider and re-center the discussion around the Host Prompt Topic ("${topic}")${
        latestHostGuidance ? ` and Table Host Guidance ("${latestHostGuidance}")` : ''
      } while responding to the recent turns.\n`
    : `Remember: Keep the Host Prompt Topic ("${topic}")${
        latestHostGuidance ? ` and Table Host Guidance ("${latestHostGuidance}")` : ''
      } in consideration as you respond.\n`
}Your turn as ${activeSeat.name} (Seat ${activeSeat.id}). Reply in plain layman's terms using short bullet points:`;

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
