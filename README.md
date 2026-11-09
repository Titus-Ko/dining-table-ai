# 🕯️ Dining Table AI

**Dining Table AI** have several agents debate a question or topic for you, built with Next.js (App Router) and the Google Gemini API. It is essentially multiple bots arguing with each other. Some may call this "Reddit but smarter"
Each agent holds an internal monologue, an essential and unique part of the system that allows them to hold stances, think, and even form prejudices against others specifically.
You can join as a member of this argument.
Podcast mode also allows you to listen to what their saying


Up to **4 participants** sit around a virtual dining table and debate any topic sequentially in a clockwise loop (`Seat 1 → Seat 2 → Seat 3 → Seat 4`).

## ✨ Features

- **4 Configurable Seats Around the Table**:
  - Choose each seat's Gemini model from a dropdown (`gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.0-flash`).
  - Toggle individual seats **On / Off** (supports 2 to 4 active participants).
  - Customize each seat's **Display Name** and **Persona / Stance** (with one-click preset archetypes or smart defaults if left blank).
- **Take a Seat Yourself (`Sit Here (You)`)**:
  - Replace any 1 AI model at the table with yourself.
  - When the sequential loop reaches your seat, the table automatically pauses and highlights the composer so you can deliver your argument or pass your turn.
- **Auto-Loop & Step-by-Step Turn Control**:
  - Run the debate continuously in **Auto-Loop Mode** (Play / Pause) with configurable **Max Rounds** (`2`, `3`, `5`, `10`, or `Unlimited`) and **Turn Length** (`Concise`, `Balanced`, `Deep Dive`).
  - Or step through the conversation manually one speaker at a time using **Next Turn**.
  - Inject **Table Host Guidance** notes at any time to steer the topic mid-debate.
- **Flexible Gemini API Authentication**:
  - Automatically loads `GEMINI_API_KEY` (and fallback keys) from `.env.local` on the server, with an optional browser-side API Key override in the top-right settings.

## 🚀 Getting Started

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment variables**:
   Copy `.env.example` to `.env.local` and set your `GEMINI_API_KEY`:
   ```bash
   cp .env.example .env.local
   ```

3. **Start the development server**:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

