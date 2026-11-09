import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Dining Table AI · Guided Multi-Model Discourse Simulation',
  description:
    'Seat up to 4 Gemini models (or take a seat yourself) around a virtual dining table for sequential, guided multi-turn debate and discourse.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

