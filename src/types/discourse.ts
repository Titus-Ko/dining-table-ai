export type SeatPosition = 'north' | 'east' | 'south' | 'west';

export type ParticipantRole = 'ai' | 'human';

export type ResponseLength = 'concise' | 'balanced' | 'deep';

export interface GeminiModelOption {
  id: string;
  label: string;
  badge: string;
  description: string;
}

export const GEMINI_MODEL_OPTIONS: GeminiModelOption[] = [
  {
    id: 'gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash Lite',
    badge: '3.5 Flash Lite',
    description: 'Ultra-fast, lightweight default for rapid table discourse',
  },
  {
    id: 'gemini-3.5-flash',
    label: 'Gemini 3.5 Flash',
    badge: '3.5 Flash',
    description: 'Rapid conversational responses',
  },
  {
    id: 'gemini-3.6-flash',
    label: 'Gemini 3.6 Flash',
    badge: '3.6 Flash',
    description: 'Fast, structured multi-turn discourse',
  },
  {
    id: 'gemini-3.7-flash',
    label: 'Gemini 3.7 Flash',
    badge: '3.7 Flash',
    description: 'Balanced analytical depth & nuanced rhetoric',
  },
  {
    id: 'gemini-3.8-flash',
    label: 'Gemini 3.8 Flash',
    badge: '3.8 Flash',
    description: 'Frontier high-speed reasoning & sharp synthesis',
  },
  {
    id: 'gemini-2.5-flash-lite',
    label: 'Gemini 2.5 Flash Lite',
    badge: '2.5 Flash Lite',
    description: 'Low-latency 2.5 Flash Lite',
  },
  {
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    badge: '2.5 Flash',
    description: 'Classic fast multimodal & text model',
  },
  {
    id: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    badge: '2.5 Pro',
    description: 'Deep reasoning & first-principles argumentation',
  },
  {
    id: 'gemini-2.0-flash',
    label: 'Gemini 2.0 Flash',
    badge: '2.0 Flash',
    description: 'Low-latency baseline Gemini Flash',
  },
];

export interface SeatConfig {
  id: number; // 1, 2, 3, 4
  position: SeatPosition;
  enabled: boolean;
  role: ParticipantRole; // 'ai' | 'human'
  name: string;
  model: string;
  persona: string; // Optional custom persona / stance
  defaultPersonaHint: string;
  accentColor: string;
  avatarEmoji: string;
}

export interface DiscourseMessage {
  id: string;
  seatId: number; // 1-4, or 0 for moderator/host guidance
  speakerName: string;
  role: ParticipantRole | 'moderator';
  requestedModel?: string;
  actualModel?: string;
  personaUsed?: string;
  round: number;
  turnIndex: number;
  content: string;
  timestamp: number;
  latencyMs?: number;
  accentColor: string;
}

export interface PresetPersona {
  label: string;
  name: string;
  persona: string;
}

export const PRESET_PERSONAS: PresetPersona[] = [
  {
    label: 'Default (Natural)',
    name: '',
    persona: '',
  },
  {
    label: 'The Visionary',
    name: 'Nova (Visionary)',
    persona: 'Optimistic futurist who argues for bold innovation, transformative upside, and long-term progress.',
  },
  {
    label: 'The Skeptic',
    name: 'Gideon (Skeptic)',
    persona: 'Rigorous critic who stress-tests assumptions, demands empirical proof, and exposes second-order risks.',
  },
  {
    label: 'The Pragmatist',
    name: 'vera (Pragmatist)',
    persona: 'Real-world operator focused on economics, incentives, feasibility, and immediate trade-offs.',
  },
  {
    label: 'The Ethicist',
    name: 'Soren (Philosopher)',
    persona: 'Examines moral philosophy, human agency, historical parallels, and societal fairness.',
  },
  {
    label: 'Devil’s Advocate',
    name: 'Contrarion',
    persona: 'Deliberately challenges consensus at the table and defends the most counter-intuitive stance.',
  },
];

export const DEFAULT_SEATS: SeatConfig[] = [
  {
    id: 1,
    position: 'north',
    enabled: true,
    role: 'ai',
    name: 'Seat 1 · North',
    model: 'gemini-3.5-flash-lite',
    persona: '',
    defaultPersonaHint: 'Proponent & First-Principles Strategist — opens angles and builds strong constructive theses.',
    accentColor: '#f59e0b', // Warm Amber
    avatarEmoji: '🍷',
  },
  {
    id: 2,
    position: 'east',
    enabled: true,
    role: 'ai',
    name: 'Seat 2 · East',
    model: 'gemini-3.5-flash-lite',
    persona: '',
    defaultPersonaHint: 'Critical Examiner — probes weak spots, counter-examples, and hidden assumptions.',
    accentColor: '#38bdf8', // Sky Blue
    avatarEmoji: '🥂',
  },
  {
    id: 3,
    position: 'south',
    enabled: true,
    role: 'ai',
    name: 'Seat 3 · South',
    model: 'gemini-3.5-flash-lite',
    persona: '',
    defaultPersonaHint: 'Pragmatic Realist — grounds the debate in real-world execution, incentives, and economics.',
    accentColor: '#34d399', // Emerald
    avatarEmoji: '☕',
  },
  {
    id: 4,
    position: 'west',
    enabled: true,
    role: 'ai',
    name: 'Seat 4 · West',
    model: 'gemini-3.5-flash-lite',
    persona: '',
    defaultPersonaHint: 'Philosophical Synthesizer — connects deeper ethical, historical, and human implications.',
    accentColor: '#c084fc', // Violet
    avatarEmoji: '🕯️',
  },
];

export const SAMPLE_TOPICS: string[] = [
  'Should autonomous AI agents be granted legal personhood and independent bank accounts?',
  'Is universal basic income inevitable, or will it erode human purpose and agency?',
  'Would society thrive more in a fully decentralized city-state model or stronger global governance?',
  'Should longevity biotech aim to eliminate biological aging completely, regardless of social disruption?',
  'In university education, should traditional lectures and exams be replaced entirely by Socratic AI tutors and oral defense?',
];

