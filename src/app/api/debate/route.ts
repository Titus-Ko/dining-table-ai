import { NextResponse } from 'next/server';
import {
  generateDiscourseTurn,
  getConfiguredGeminiKey,
  type GenerateTurnInput,
} from '@/lib/gemini';

export async function GET() {
  const key = getConfiguredGeminiKey();

  return NextResponse.json({
    hasServerKey: Boolean(key),
    keyCount: key ? 1 : 0,
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<GenerateTurnInput>;

    if (!body.topic || !body.topic.trim()) {
      return NextResponse.json(
        { error: 'Please provide a debate topic before starting the turn.' },
        { status: 400 }
      );
    }

    if (!body.activeSeat) {
      return NextResponse.json(
        { error: 'Missing activeSeat configuration.' },
        { status: 400 }
      );
    }

    const result = await generateDiscourseTurn({
      topic: body.topic.trim(),
      activeSeat: body.activeSeat,
      allSeats: body.allSeats || [body.activeSeat],
      history: body.history || [],
      round: body.round || 1,
      responseLength: body.responseLength || 'concise',
      customApiKey: body.customApiKey,
    });

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unexpected error generating discourse turn.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
