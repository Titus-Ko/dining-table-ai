'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  DEFAULT_SEATS,
  GEMINI_MODEL_OPTIONS,
  PRESET_PERSONAS,
  SAMPLE_TOPICS,
  type DiscourseMessage,
  type ResponseLength,
  type SeatConfig,
} from '@/types/discourse';
import styles from './page.module.css';

export default function DiningTablePage() {
  // Debate Topic & Configuration (starts blank so no sample topic is mixed in unless clicked)
  const [topic, setTopic] = useState<string>('');
  const [seats, setSeats] = useState<SeatConfig[]>(DEFAULT_SEATS);
  const [responseLength, setResponseLength] = useState<ResponseLength>('concise');
  const [maxRounds, setMaxRounds] = useState<number>(3); // 0 = unlimited

  // Turn & Loop State
  const [messages, setMessages] = useState<DiscourseMessage[]>([]);
  const [currentRound, setCurrentRound] = useState<number>(1);
  const [turnPointer, setTurnPointer] = useState<number>(0); // Index within enabledSeats
  const [isAutoLooping, setIsAutoLooping] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Open Persona Drawer per seat
  const [openPersonaSeatIds, setOpenPersonaSeatIds] = useState<Record<number, boolean>>({
    1: false,
    2: false,
    3: false,
    4: false,
  });

  // Human / Moderator Input State
  const [composerText, setComposerText] = useState<string>('');
  const composerInputRef = useRef<HTMLInputElement | null>(null);
  const feedEndRef = useRef<HTMLDivElement | null>(null);

  // API Key State
  const [hasServerKey, setHasServerKey] = useState<boolean>(true);
  const [serverKeyCount, setServerKeyCount] = useState<number>(0);
  const [customApiKey, setCustomApiKey] = useState<string>('');
  const [showApiModal, setShowApiModal] = useState<boolean>(false);
  const [copiedTranscript, setCopiedTranscript] = useState<boolean>(false);

  // Enabled seats in sequential table order (1 -> 2 -> 3 -> 4)
  const enabledSeats = useMemo(() => seats.filter((s) => s.enabled), [seats]);

  const safePointer = enabledSeats.length > 0 ? turnPointer % enabledSeats.length : 0;
  const activeSeat: SeatConfig | undefined = enabledSeats[safePointer];
  const isHumanTurn = Boolean(activeSeat && activeSeat.role === 'human');

  // Check server-side .env.local API key availability on mount
  useEffect(() => {
    const savedKey = window.localStorage.getItem('dining_table_gemini_key') || '';
    if (savedKey) setCustomApiKey(savedKey);

    fetch('/api/debate')
      .then((res) => res.json())
      .then((data) => {
        if (typeof data.hasServerKey === 'boolean') {
          setHasServerKey(data.hasServerKey);
          setServerKeyCount(data.keyCount || 0);
        }
      })
      .catch(() => {
        // Ignore status check error
      });
  }, []);

  // Auto-scroll transcript when messages change
  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isGenerating]);

  // Focus composer when it becomes the human's turn
  useEffect(() => {
    if (isHumanTurn && (isAutoLooping || messages.length > 0)) {
      composerInputRef.current?.focus();
    }
  }, [isHumanTurn, isAutoLooping, messages.length, safePointer]);

  // Advance pointer to the next seat around the table
  const advanceTableTurn = useCallback(
    (currentIdx: number, roundNow: number, totalEnabled: number) => {
      const nextIdx = currentIdx + 1;
      if (nextIdx < totalEnabled) {
        setTurnPointer(nextIdx);
      } else {
        const nextRound = roundNow + 1;
        setTurnPointer(0);
        setCurrentRound(nextRound);
        if (maxRounds > 0 && nextRound > maxRounds) {
          setIsAutoLooping(false);
        }
      }
    },
    [maxRounds]
  );

  // Effective topic: uses top Topic input, or falls back to the latest Table Host Guidance note
  const latestHostNote = useMemo(() => {
    const notes = messages.filter((m) => m.role === 'moderator');
    return notes.length > 0 ? notes[notes.length - 1].content : '';
  }, [messages]);

  const effectiveTopic = topic.trim() || latestHostNote.trim();

  // Trigger a single AI turn for the active seat
  const executeAiTurn = useCallback(async () => {
    if (!activeSeat || activeSeat.role !== 'ai' || isGenerating) return;
    if (!effectiveTopic) {
      setErrorMsg('Please enter a debate topic at the top (or send a Table Host Guidance note below) before starting.');
      setIsAutoLooping(false);
      return;
    }

    setIsGenerating(true);
    setErrorMsg(null);

    try {
      const response = await fetch('/api/debate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: effectiveTopic,
          activeSeat,
          allSeats: seats,
          history: messages,
          round: currentRound,
          responseLength,
          customApiKey: customApiKey.trim() || undefined,
        }),
      });

      const data = await response.json();
      if (!response.ok || data.error) {
        throw new Error(data.error || `Request failed with status ${response.status}`);
      }

      const spokenSoFar = messages.filter((m) => m.role !== 'moderator').length;
      const newMsg: DiscourseMessage = {
        id: `${Date.now()}-seat-${activeSeat.id}`,
        seatId: activeSeat.id,
        speakerName: activeSeat.name,
        role: 'ai',
        requestedModel: data.requestedModel || activeSeat.model,
        actualModel: data.actualModel || activeSeat.model,
        personaUsed: activeSeat.persona.trim() || activeSeat.defaultPersonaHint,
        round: currentRound,
        turnIndex: spokenSoFar + 1,
        content: data.content,
        timestamp: Date.now(),
        latencyMs: data.latencyMs,
        accentColor: activeSeat.accentColor,
      };

      setMessages((prev) => [...prev, newMsg]);
      advanceTableTurn(safePointer, currentRound, enabledSeats.length);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to generate AI turn.';
      setErrorMsg(msg);
      setIsAutoLooping(false);
    } finally {
      setIsGenerating(false);
    }
  }, [
    activeSeat,
    isGenerating,
    effectiveTopic,
    seats,
    messages,
    currentRound,
    responseLength,
    customApiKey,
    advanceTableTurn,
    safePointer,
    enabledSeats.length,
  ]);

  // Sequential Auto-Loop Effect
  useEffect(() => {
    if (!isAutoLooping || isGenerating) return;
    if (!activeSeat) return;

    // Stop auto-loop if max rounds reached
    if (maxRounds > 0 && currentRound > maxRounds) {
      setIsAutoLooping(false);
      return;
    }

    // If the active seat is Human ("You"), wait for user input in the composer
    if (activeSeat.role === 'human') {
      return;
    }

    const delayMs = messages.length === 0 ? 150 : 1100;
    const timer = setTimeout(() => {
      executeAiTurn();
    }, delayMs);

    return () => clearTimeout(timer);
  }, [
    isAutoLooping,
    isGenerating,
    activeSeat,
    maxRounds,
    currentRound,
    messages.length,
    executeAiTurn,
  ]);

  // Handle Manual "Next Turn" button
  const handleManualNextTurn = () => {
    if (isGenerating || !activeSeat) return;
    if (maxRounds > 0 && currentRound > maxRounds) {
      // Allow extending rounds automatically if user explicitly clicks Next Turn
      setMaxRounds((prev) => prev + 1);
    }
    if (activeSeat.role === 'human') {
      composerInputRef.current?.focus();
      return;
    }
    executeAiTurn();
  };

  // Handle Human Seat submission OR Table Host Guidance submission
  const handleComposerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = composerText.trim();
    if (!trimmed) return;

    if (isHumanTurn && activeSeat) {
      const spokenSoFar = messages.filter((m) => m.role !== 'moderator').length;
      const humanMsg: DiscourseMessage = {
        id: `${Date.now()}-human-${activeSeat.id}`,
        seatId: activeSeat.id,
        speakerName: activeSeat.name,
        role: 'human',
        round: currentRound,
        turnIndex: spokenSoFar + 1,
        content: trimmed,
        timestamp: Date.now(),
        accentColor: activeSeat.accentColor,
      };
      setMessages((prev) => [...prev, humanMsg]);
      setComposerText('');
      advanceTableTurn(safePointer, currentRound, enabledSeats.length);
    } else {
      // Moderator / Table Host guidance note
      const spokenSoFar = messages.filter((m) => m.role !== 'moderator').length;
      // If no one has spoken yet (or topic is empty), also set the main topic to this Host Guidance
      // so an old top-bar topic is never mixed in!
      if (spokenSoFar === 0 || !topic.trim()) {
        setTopic(trimmed);
      }
      const hostMsg: DiscourseMessage = {
        id: `${Date.now()}-moderator`,
        seatId: 0,
        speakerName: 'Table Host Guidance',
        role: 'moderator',
        round: currentRound,
        turnIndex: messages.length + 1,
        content: trimmed,
        timestamp: Date.now(),
        accentColor: '#f59e0b',
      };
      setMessages((prev) => [...prev, hostMsg]);
      setComposerText('');
    }
  };

  // Skip/Pass human turn
  const handleSkipHumanTurn = () => {
    if (!isHumanTurn) return;
    advanceTableTurn(safePointer, currentRound, enabledSeats.length);
  };

  // Reset the discourse transcript, topic & rounds
  const handleResetDebate = () => {
    setIsAutoLooping(false);
    setMessages([]);
    setTopic('');
    setCurrentRound(1);
    setTurnPointer(0);
    setErrorMsg(null);
  };

  // Seat configuration helpers
  const toggleSeatRoleHuman = (seatId: number) => {
    setSeats((prev) => {
      const target = prev.find((s) => s.id === seatId);
      if (!target) return prev;
      const becomingHuman = target.role !== 'human';

      return prev.map((s) => {
        if (s.id === seatId) {
          const defaultSeatName = `Seat ${s.id} · ${s.position.charAt(0).toUpperCase() + s.position.slice(1)}`;
          return {
            ...s,
            enabled: true,
            role: becomingHuman ? 'human' : 'ai',
            name: becomingHuman
              ? s.name.startsWith('Seat ')
                ? `You (Seat ${s.id})`
                : s.name
              : s.name.startsWith('You')
              ? defaultSeatName
              : s.name,
          };
        }
        // Only 1 seat can be replaced with yourself at a time
        if (becomingHuman && s.role === 'human') {
          const defaultSeatName = `Seat ${s.id} · ${s.position.charAt(0).toUpperCase() + s.position.slice(1)}`;
          return {
            ...s,
            role: 'ai',
            name: s.name.startsWith('You') ? defaultSeatName : s.name,
          };
        }
        return s;
      });
    });
  };

  const toggleSeatEnabled = (seatId: number) => {
    setSeats((prev) => {
      const enabledCount = prev.filter((s) => s.enabled).length;
      const target = prev.find((s) => s.id === seatId);
      if (target?.enabled && enabledCount <= 2) {
        setErrorMsg('At least 2 seats must remain active at the dining table.');
        return prev;
      }
      return prev.map((s) => (s.id === seatId ? { ...s, enabled: !s.enabled } : s));
    });
  };

  const updateSeatField = <K extends keyof SeatConfig>(
    seatId: number,
    field: K,
    value: SeatConfig[K]
  ) => {
    setSeats((prev) => prev.map((s) => (s.id === seatId ? { ...s, [field]: value } : s)));
  };

  const handleSaveApiKey = (val: string) => {
    setCustomApiKey(val);
    if (val.trim()) {
      window.localStorage.setItem('dining_table_gemini_key', val.trim());
    } else {
      window.localStorage.removeItem('dining_table_gemini_key');
    }
  };

  const handleExportMarkdown = () => {
    if (messages.length === 0) return;
    const lines = [
      `# Dining Table AI — Discourse Transcript`,
      `**Topic:** ${topic}`,
      `**Date:** ${new Date().toLocaleString()}`,
      '',
      '---',
      '',
      ...messages.map((m) => {
        const modelInfo =
          m.role === 'ai' ? ` (${m.actualModel || m.requestedModel})` : m.role === 'human' ? ' (Human)' : '';
        return `### [Round ${m.round}] ${m.speakerName}${modelInfo}\n${m.content}\n`;
      }),
    ];
    navigator.clipboard.writeText(lines.join('\n'));
    setCopiedTranscript(true);
    setTimeout(() => setCopiedTranscript(false), 2000);
  };

  // Find latest message per seat for the dining table preview
  const latestMessageBySeat = useMemo(() => {
    const map: Record<number, DiscourseMessage> = {};
    for (const m of messages) {
      if (m.seatId >= 1 && m.seatId <= 4) {
        map[m.seatId] = m;
      }
    }
    return map;
  }, [messages]);

  const renderSeatCard = (seat: SeatConfig, areaClass: string) => {
    const isSpeakingNow = activeSeat?.id === seat.id && seat.enabled;
    const isDrawerOpen = Boolean(openPersonaSeatIds[seat.id]);
    const latestMsg = latestMessageBySeat[seat.id];

    return (
      <div key={seat.id} className={areaClass}>
        <div
          className={`${styles.seatCard} ${isSpeakingNow ? `${styles.seatCardActive} speaking-pulse` : ''} ${
            !seat.enabled ? styles.seatCardDisabled : ''
          }`}
          style={{
            borderColor: isSpeakingNow ? seat.accentColor : undefined,
          }}
        >
          {/* Seat Header Row */}
          <div className={styles.seatTopRow}>
            <div className={styles.seatIdentity}>
              <div
                className={styles.seatAvatar}
                style={{
                  background: `${seat.accentColor}22`,
                  border: `1px solid ${seat.accentColor}66`,
                }}
                title={`Seat ${seat.id} (${seat.position.toUpperCase()})`}
              >
                {seat.role === 'human' ? '👤' : seat.avatarEmoji}
              </div>
              <input
                type="text"
                className={styles.seatNameInput}
                value={seat.name}
                onChange={(e) => updateSeatField(seat.id, 'name', e.target.value)}
                aria-label={`Seat ${seat.id} speaker name`}
              />
            </div>

            <div className={styles.seatTopActions}>
              <button
                type="button"
                onClick={() => toggleSeatRoleHuman(seat.id)}
                className={`${styles.roleToggleBtn} ${seat.role === 'human' ? styles.roleToggleHuman : ''}`}
                title={
                  seat.role === 'human'
                    ? 'Switch this seat back to a Gemini AI model'
                    : 'Replace this seat with yourself (Human)'
                }
              >
                {seat.role === 'human' ? '✓ You (Seated)' : 'Sit Here (You)'}
              </button>

              <button
                type="button"
                onClick={() => toggleSeatEnabled(seat.id)}
                className={styles.enableBtn}
                title={seat.enabled ? 'Remove seat from turn loop' : 'Include seat in turn loop'}
              >
                {seat.enabled ? 'On' : 'Off'}
              </button>
            </div>
          </div>

          {/* Model Selector or Human Banner */}
          {seat.role === 'ai' ? (
            <div className={styles.modelSelectRow}>
              <select
                className={styles.modelDropdown}
                value={seat.model}
                onChange={(e) => updateSeatField(seat.id, 'model', e.target.value)}
                disabled={!seat.enabled}
                aria-label={`Select Gemini model for Seat ${seat.id}`}
              >
                {GEMINI_MODEL_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label} — {opt.description}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className={styles.humanSeatBanner}>
              🎙️ You occupy Seat {seat.id}. The loop pauses here on your turn.
            </div>
          )}

          {/* Optional Persona / Stance Configurator */}
          {seat.enabled && (
            <>
              <button
                type="button"
                className={styles.personaToggle}
                onClick={() =>
                  setOpenPersonaSeatIds((prev) => ({
                    ...prev,
                    [seat.id]: !prev[seat.id],
                  }))
                }
              >
                <span>
                  🎭 Persona / Stance:{' '}
                  <strong style={{ color: '#e2e8f0' }}>
                    {seat.persona.trim() ? 'Custom' : 'Smart Default'}
                  </strong>
                </span>
                <span>{isDrawerOpen ? '▴ Hide' : '▾ Edit'}</span>
              </button>

              {isDrawerOpen && (
                <div className={styles.personaDrawer}>
                  <div className={styles.presetRow}>
                    {PRESET_PERSONAS.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        className={styles.presetPill}
                        onClick={() => {
                          updateSeatField(seat.id, 'persona', preset.persona);
                          if (preset.name && seat.role === 'ai') {
                            updateSeatField(seat.id, 'name', preset.name);
                          }
                        }}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <textarea
                    className={styles.personaTextarea}
                    placeholder={`Optional custom stance or persona... (Default: ${seat.defaultPersonaHint})`}
                    value={seat.persona}
                    onChange={(e) => updateSeatField(seat.id, 'persona', e.target.value)}
                  />
                </div>
              )}
            </>
          )}

          {/* Latest Speech Bubble Preview */}
          {latestMsg && seat.enabled && (
            <div
              className={styles.latestSnippet}
              style={{ borderLeftColor: seat.accentColor }}
              title={latestMsg.content}
            >
              “{latestMsg.content}”
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={styles.container}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.brandGroup}>
          <div className={styles.brandIcon}>🕯️</div>
          <div>
            <div className={styles.brandTitle}>
              Dining Table AI
              <span
                style={{
                  fontSize: '0.68rem',
                  padding: '2px 8px',
                  borderRadius: '999px',
                  background: 'rgba(245, 158, 11, 0.14)',
                  color: '#fbbf24',
                  border: '1px solid rgba(245, 158, 11, 0.3)',
                }}
              >
                Discourse Simulator
              </span>
            </div>
            <div className={styles.brandSubtitle}>
              Sequential multi-model Gemini roundtable · Replace any seat with yourself
            </div>
          </div>
        </div>

        <div className={styles.headerRight}>
          <div className={styles.statusBadge}>
            <span>🔄 Round {currentRound}{maxRounds > 0 ? ` / ${maxRounds}` : ''}</span>
            <span>·</span>
            <span>{enabledSeats.length} Seated</span>
          </div>

          <div className={styles.statusBadge}>
            <span
              className={`${styles.statusDot} ${
                customApiKey.trim() || hasServerKey ? styles.statusDotReady : styles.statusDotWarn
              }`}
            />
            <span>
              {customApiKey.trim()
                ? 'Custom Gemini Key Active'
                : hasServerKey
                ? `Server .env.local Ready (${serverKeyCount || 1} key${serverKeyCount === 1 ? '' : 's'})`
                : 'No API Key Configured'}
            </span>
          </div>

          <button
            type="button"
            className={styles.apiBtn}
            onClick={() => setShowApiModal(true)}
          >
            🔑 API Key
          </button>
        </div>
      </header>

      {/* Topic & Turn Control Bar */}
      <section className={styles.controlBar}>
        <div className={styles.topicRow}>
          <div className={styles.topicInputWrapper}>
            <span className={styles.topicLabelBadge}>Topic</span>
            <input
              type="text"
              className={styles.topicInput}
              placeholder="Enter a debate question or proposition for the dining table..."
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
          </div>

          <div className={styles.actionGroup}>
            <button
              type="button"
              className={`${styles.primaryBtn} ${isAutoLooping ? styles.pauseBtn : ''}`}
              onClick={() => {
                if (!isAutoLooping && maxRounds > 0 && currentRound > maxRounds) {
                  setMaxRounds(currentRound + 2);
                }
                setIsAutoLooping((prev) => !prev);
              }}
              disabled={!effectiveTopic}
            >
              {isAutoLooping ? '⏸ Pause Auto-Loop' : messages.length > 0 ? '▶ Resume Auto-Loop' : '▶ Start Debate Loop'}
            </button>

            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={handleManualNextTurn}
              disabled={isGenerating || !effectiveTopic || isHumanTurn}
              title={
                isHumanTurn
                  ? 'It is currently your turn! Type your response in the composer below.'
                  : 'Trigger the next speaker in sequence without auto-looping'
              }
            >
              ⏭ Next Turn {activeSeat ? `(Seat ${activeSeat.id})` : ''}
            </button>

            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={handleResetDebate}
              disabled={messages.length === 0 && !topic.trim() && currentRound === 1 && turnPointer === 0}
            >
              ↺ Reset Table
            </button>
          </div>
        </div>

        <div className={styles.subControlsRow}>
          <div className={styles.samplePrompts}>
            <span className={styles.sampleLabel}>Sample Topics:</span>
            {SAMPLE_TOPICS.map((sample, idx) => (
              <button
                key={idx}
                type="button"
                className={styles.sampleChip}
                onClick={() => setTopic(sample)}
                title={sample}
              >
                {sample}
              </button>
            ))}
          </div>

          <div className={styles.loopOptions}>
            <label className={styles.optionGroup}>
              <span>Max Rounds:</span>
              <select
                className={styles.selectSmall}
                value={maxRounds}
                onChange={(e) => setMaxRounds(Number(e.target.value))}
              >
                <option value={2}>2 Rounds</option>
                <option value={3}>3 Rounds</option>
                <option value={5}>5 Rounds</option>
                <option value={10}>10 Rounds</option>
                <option value={0}>Unlimited</option>
              </select>
            </label>

            <label className={styles.optionGroup}>
              <span>Turn Length:</span>
              <select
                className={styles.selectSmall}
                value={responseLength}
                onChange={(e) => setResponseLength(e.target.value as ResponseLength)}
              >
                <option value="concise">Concise (Short + 2–3 bullets)</option>
                <option value="balanced">Balanced (Brief + 3–4 bullets)</option>
                <option value="deep">Deep Dive (4–5 detailed bullets)</option>
              </select>
            </label>
          </div>
        </div>
      </section>

      {/* Split Workspace: Visual Table (Left) + Chronological Transcript (Right) */}
      <main className={styles.workspace}>
        {/* Left: Visual Dining Table & 4 Seats */}
        <section className={styles.tableSection}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitle}>
              <span>🍽️ The Dining Table</span>
            </div>
            <div className={styles.sectionHint}>
              Clockwise loop: Seat 1 → Seat 2 → Seat 3 → Seat 4
            </div>
          </div>

          <div className={styles.diningRoomGrid}>
            {renderSeatCard(seats[0], styles.seatAreaNorth)}
            {renderSeatCard(seats[3], styles.seatAreaWest)}

            {/* Center Dining Table */}
            <div className={styles.centerTable}>
              <div className={styles.tableInnerRim} />
              <div className={`${styles.candleIcon} candle-glow`}>🕯️</div>
              <div className={styles.tableRoundTag}>
                {isGenerating && activeSeat
                  ? `${activeSeat.name} is speaking...`
                  : isHumanTurn && activeSeat
                  ? `Waiting for ${activeSeat.name}`
                  : `Round ${currentRound} · Ready`}
              </div>
              <div className={styles.tableTopicText} title={effectiveTopic}>
                “{effectiveTopic || 'Enter a topic or send Host Guidance to begin'}”
              </div>

              <div className={styles.tableTurnOrder}>
                {enabledSeats.map((s, idx) => (
                  <React.Fragment key={s.id}>
                    <span
                      className={`${styles.turnPip} ${
                        activeSeat?.id === s.id ? styles.turnPipActive : ''
                      }`}
                      title={`${s.name} (${s.role === 'human' ? 'You' : s.model})`}
                    >
                      {s.id}
                    </span>
                    {idx < enabledSeats.length - 1 && (
                      <span style={{ color: 'rgba(255,255,255,0.28)' }}>→</span>
                    )}
                  </React.Fragment>
                ))}
              </div>
            </div>

            {renderSeatCard(seats[1], styles.seatAreaEast)}
            {renderSeatCard(seats[2], styles.seatAreaSouth)}
          </div>
        </section>

        {/* Right: Chronological Discourse Transcript & Composer */}
        <section className={styles.transcriptSection}>
          <div className={styles.transcriptHeader}>
            <div className={styles.sectionTitle}>
              <span>📜 Live Discourse Feed</span>
              <span
                style={{
                  fontSize: '0.74rem',
                  color: 'var(--text-secondary)',
                  fontWeight: 500,
                }}
              >
                ({messages.length} {messages.length === 1 ? 'turn' : 'turns'})
              </span>
            </div>

            {messages.length > 0 && (
              <button
                type="button"
                className={styles.apiBtn}
                onClick={handleExportMarkdown}
              >
                {copiedTranscript ? '✓ Copied Markdown' : '📋 Copy Transcript'}
              </button>
            )}
          </div>

          <div className={styles.messageList}>
            {messages.length === 0 && !isGenerating ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyIcon}>🍷</div>
                <h3 style={{ color: '#f8fafc', fontSize: '1rem' }}>
                  The Dining Table is Set
                </h3>
                <p style={{ fontSize: '0.82rem', lineHeight: 1.5 }}>
                  Choose a Gemini model for each of the 4 seats (or click{' '}
                  <strong>“Sit Here (You)”</strong> on any seat to join the table yourself),
                  then click <strong>Start Debate Loop</strong> or <strong>Next Turn</strong>.
                </p>
              </div>
            ) : (
              messages.map((msg, idx) => {
                const prevRound = idx > 0 ? messages[idx - 1].round : 0;
                const showRoundDivider = msg.round !== prevRound;

                return (
                  <React.Fragment key={msg.id}>
                    {showRoundDivider && (
                      <div className={styles.roundDivider}>
                        <div className={styles.roundLine} />
                        <span className={styles.roundLabel}>Round {msg.round}</span>
                        <div className={styles.roundLine} />
                      </div>
                    )}

                    <div
                      className={styles.messageCard}
                      style={{
                        borderLeft: `3px solid ${msg.accentColor}`,
                      }}
                    >
                      <div className={styles.messageHeader}>
                        <div className={styles.speakerMeta}>
                          <span
                            className={styles.speakerDot}
                            style={{ background: msg.accentColor }}
                          />
                          <span className={styles.speakerName}>{msg.speakerName}</span>

                          {msg.role === 'ai' && (
                            <span className={styles.modelPill}>
                              🤖 {msg.actualModel || msg.requestedModel}
                            </span>
                          )}
                          {msg.role === 'human' && (
                            <span
                              className={styles.modelPill}
                              style={{
                                background: 'rgba(52, 211, 153, 0.14)',
                                color: '#6ee7b7',
                                borderColor: 'rgba(52, 211, 153, 0.35)',
                              }}
                            >
                              👤 You (Seat {msg.seatId})
                            </span>
                          )}
                          {msg.role === 'moderator' && (
                            <span
                              className={styles.modelPill}
                              style={{
                                background: 'rgba(245, 158, 11, 0.16)',
                                color: '#fbbf24',
                              }}
                            >
                              📣 Priority Host Guidance
                            </span>
                          )}
                          {msg.role !== 'moderator' && (msg.turnIndex <= 4 || msg.turnIndex % 5 === 0) && (
                            <span
                              className={styles.modelPill}
                              style={{
                                background: 'rgba(245, 158, 11, 0.18)',
                                color: '#fde68a',
                                borderColor: 'rgba(245, 158, 11, 0.45)',
                              }}
                              title="Opening 4 messages and every 5th message strongly focus on the Host Prompt Topic and Table Host Guidance"
                            >
                              {msg.turnIndex <= 4
                                ? '🎯 Opening Host Topic Focus'
                                : '🎯 5th-Msg Host Topic Focus'}
                            </span>
                          )}
                        </div>

                        <span className={styles.timeMeta}>
                          {msg.role === 'moderator' ? 'Host Steering' : `Msg #${msg.turnIndex}`}
                          {msg.latencyMs ? ` · ${(msg.latencyMs / 1000).toFixed(1)}s` : ''}
                        </span>
                      </div>

                      <div className={styles.messageBody}>{msg.content}</div>
                    </div>
                  </React.Fragment>
                );
              })
            )}

            {isGenerating && activeSeat && (
              <div
                className={styles.messageCard}
                style={{
                  borderLeft: `3px solid ${activeSeat.accentColor}`,
                  opacity: 0.85,
                }}
              >
                <div className={styles.messageHeader}>
                  <div className={styles.speakerMeta}>
                    <span
                      className={styles.speakerDot}
                      style={{ background: activeSeat.accentColor }}
                    />
                    <span className={styles.speakerName}>{activeSeat.name}</span>
                    <span className={styles.modelPill}>🤖 {activeSeat.model}</span>
                  </div>
                  <span className={styles.timeMeta}>Formulating argument...</span>
                </div>
                <div
                  className={styles.messageBody}
                  style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}
                >
                  Thinking across the dining table...
                </div>
              </div>
            )}

            <div ref={feedEndRef} />
          </div>

          {errorMsg && (
            <div className={styles.errorBanner}>
              <span>⚠️ {errorMsg}</span>
              <button
                type="button"
                className={styles.enableBtn}
                onClick={() => setErrorMsg(null)}
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Bottom Composer (Human Turn OR Host Guidance) */}
          <form
            onSubmit={handleComposerSubmit}
            className={`${styles.composerArea} ${
              isHumanTurn ? styles.composerHumanActive : ''
            }`}
          >
            <div className={styles.composerPromptLabel}>
              {isHumanTurn && activeSeat ? (
                <span style={{ color: '#6ee7b7' }}>
                  🎙️ Your Turn at {activeSeat.name} (Round {currentRound}) — Speak to the table:
                </span>
              ) : (
                <span>
                  💬 Table Host Guidance (optional — steer the AI speakers at any point):
                </span>
              )}

              {isHumanTurn && (
                <button
                  type="button"
                  onClick={handleSkipHumanTurn}
                  className={styles.enableBtn}
                  style={{ color: '#cbd5e1' }}
                >
                  Pass Turn →
                </button>
              )}
            </div>

            <div className={styles.composerRow}>
              <input
                ref={composerInputRef}
                type="text"
                className={styles.composerInput}
                placeholder={
                  isHumanTurn
                    ? 'Type your argument or rebuttal for the table and press Enter...'
                    : 'Inject a moderator prompt (e.g., "Address the economic downsides")...'
                }
                value={composerText}
                onChange={(e) => setComposerText(e.target.value)}
              />
              <button
                type="submit"
                className={styles.primaryBtn}
                disabled={!composerText.trim()}
              >
                {isHumanTurn ? 'Speak Turn' : 'Send Note'}
              </button>
            </div>
          </form>
        </section>
      </main>

      {/* Optional API Key Override Modal */}
      {showApiModal && (
        <div className={styles.modalBackdrop} onClick={() => setShowApiModal(false)}>
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 700 }}>🔑 Gemini API Key Settings</h3>
              <button
                type="button"
                className={styles.enableBtn}
                onClick={() => setShowApiModal(false)}
              >
                ✕ Close
              </button>
            </div>

            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              By default, Dining Table AI uses your server-side{' '}
              <code>GEMINI_API_KEY</code> configured in <code>.env.local</code>{' '}
              ({hasServerKey ? `${serverKeyCount} server key(s) detected` : 'none detected'}).
              You can optionally provide a browser override key below:
            </p>

            <input
              type="password"
              className={styles.composerInput}
              placeholder="Optional: Paste AIzaSy... Gemini API Key override"
              value={customApiKey}
              onChange={(e) => handleSaveApiKey(e.target.value)}
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              {customApiKey && (
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={() => handleSaveApiKey('')}
                >
                  Clear Override (Use Server .env.local)
                </button>
              )}
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={() => setShowApiModal(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

