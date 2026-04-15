import React, { useState, useEffect, useRef } from 'react';
import './ChatWindow.css';

// ── Sub-components ─────────────────────────────────────────────────────────────

function DiceRollBlock({ label, results }) {
  return (
    <div className="dice-roll-block">
      {label && <span className="dice-roll-label">{label}</span>}
      <div className="dice-roll-results">
        {results.map((r, i) => <span key={i} className="dice-roll-result">{r}</span>)}
      </div>
    </div>
  );
}

function ArbiterBlock({ question, ruling }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`arbiter-block ${open ? 'open' : ''}`}>
      <button className="arbiter-header" onClick={() => setOpen(o => !o)}>
        <span className="arbiter-icon">⚖</span>
        <span className="arbiter-label">Rules Arbiter</span>
        <span className="arbiter-question-preview">{question}</span>
        <span className="arbiter-chevron">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="arbiter-body">
          <div className="arbiter-q"><span className="arbiter-q-label">Q</span>{question}</div>
          <div className="arbiter-a"><span className="arbiter-a-label">A</span>{ruling}</div>
        </div>
      )}
    </div>
  );
}

function ArbiterPending({ question }) {
  return (
    <div className="arbiter-block pending">
      <div className="arbiter-header">
        <span className="arbiter-icon">⚖</span>
        <span className="arbiter-label">Rules Arbiter</span>
        <span className="arbiter-question-preview">{question}</span>
        <span className="arbiter-spinner" />
      </div>
    </div>
  );
}

function StateBlock({ content, isStreaming }) {
  const [open, setOpen] = useState(true);
  return (
    <div className={`state-block ${open ? 'open' : ''} ${isStreaming ? 'streaming' : ''}`}>
      <button className="state-header" onClick={() => setOpen(o => !o)}>
        <span className="state-icon">💾</span>
        <span className="state-label">Session State Saved</span>
        <span className="state-chevron">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="state-body">
          <div className="state-content">
            {content}
            {isStreaming && <span className="cursor" />}
          </div>
        </div>
      )}
    </div>
  );
}

function Message({ msg }) {
  if (msg.role === 'archive') {
    return (
      <div className="message message-archive">
        <div className="message-archive-header">
          <span className="archive-rule" /><span className="archive-label">📜 Session Archive</span><span className="archive-rule" />
        </div>
        <div className="message-content">{msg.content}</div>
        <div className="message-archive-footer">
          <span className="archive-rule" /><span className="archive-label-end">— End of Archive —</span><span className="archive-rule" />
        </div>
      </div>
    );
  }
  if (msg.role === 'state') {
    return <StateBlock content={msg.content} isStreaming={false} />;
  }
  if (msg.role === 'arbiter') {
    return <ArbiterBlock question={msg.question} ruling={msg.ruling} />;
  }
  if (msg.role === 'dice_roll') {
    return <DiceRollBlock label={msg.label} results={msg.results} />;
  }
  if (msg.role === 'tool_use' || msg.role === 'tool_result') return null;

  return (
    <div className={`message message-${msg.role}`}>
      <div className="message-label">{msg.role === 'user' ? 'You' : 'GM'}</div>
      <div className="message-content">{msg.content}</div>
    </div>
  );
}

function mergeMessages(raw) {
  const result = [];
  const toolUseMap = {};
  for (const m of raw) {
    if (m.role === 'tool_use') {
      try {
        const d = typeof m.content === 'string' ? JSON.parse(m.content) : m.content;
        if (d.expressions) {
          toolUseMap[d.tool_use_id] = { id: m.id, type: 'dice', label: d.label, expressions: d.expressions };
        } else {
          toolUseMap[d.tool_use_id] = { id: m.id, type: 'arbiter', question: d.question };
        }
      } catch {}
    } else if (m.role === 'tool_result') {
      try {
        const d = typeof m.content === 'string' ? JSON.parse(m.content) : m.content;
        const use = toolUseMap[d.tool_use_id];
        if (use?.type === 'arbiter') {
          result.push({ id: `arbiter-${use.id}`, role: 'arbiter', question: use.question, ruling: d.result });
        } else if (use?.type === 'dice') {
          const results = d.result.split('\n').filter(Boolean);
          result.push({ id: `dice-${use.id}`, role: 'dice_roll', label: use.label, results });
        }
      } catch {}
    } else {
      result.push(m);
    }
  }
  return result;
}

// ── End Session dialog ────────────────────────────────────────────────────────
function EndSessionConfirm({ onConfirm, onCancel }) {
  return (
    <div className="end-overlay" onClick={onCancel}>
      <div className="end-dialog" onClick={e => e.stopPropagation()}>
        <div className="end-dialog-title">End Session?</div>
        <p className="end-dialog-body">
          The GM will produce a session state snapshot and save it to the campaign folder.
          This will restore continuity at the start of your next session.
        </p>
        <div className="end-dialog-footer">
          <button className="btn-cancel" onClick={onCancel}>Cancel</button>
          <button className="btn-end-confirm" onClick={onConfirm}>Save State & End</button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function ChatWindow({ session, campaign, onSessionTitleChange, onOpenSidebar }) {
  const [messages,       setMessages]       = useState([]);
  const [input,          setInput]          = useState('');
  const [streaming,      setStreaming]       = useState(false);
  const [streamBuffer,   setStreamBuffer]   = useState('');
  const [pendingArbiter, setPendingArbiter] = useState(null);
  const [arbiterBlocks,  setArbiterBlocks]  = useState([]);
  const [diceRollBlocks, setDiceRollBlocks] = useState([]);
  const [ending,         setEnding]         = useState(false);
  const [stateBuffer,    setStateBuffer]    = useState('');
  const [reportBuffer,   setReportBuffer]   = useState('');
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [sessionEnded,   setSessionEnded]   = useState(false);
  const [sessionTitle,   setSessionTitle]   = useState(session.title);
  const bottomRef   = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    fetch(`/api/sessions/${session.id}/messages`)
      .then(r => r.json())
      .then(raw => {
        const merged = mergeMessages(raw);
        setMessages(merged);
        setSessionEnded(!!session.ended_at);
      });
    setStreamBuffer(''); setStreaming(false);
    setPendingArbiter(null); setArbiterBlocks([]); setDiceRollBlocks([]);
    setEnding(false); setStateBuffer(''); setReportBuffer('');
    setShowEndConfirm(false);
    setSessionTitle(session.title);
  }, [session.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamBuffer, pendingArbiter, arbiterBlocks, diceRollBlocks, stateBuffer, reportBuffer]);

  // ── Send chat message ───────────────────────────────────────────────────────
  const send = async () => {
    if (!input.trim() || streaming || ending || sessionEnded) return;
    const text = input.trim();
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setMessages(m => [...m, { role: 'user', content: text, id: Date.now() }]);
    setStreaming(true); setStreamBuffer('');
    setPendingArbiter(null); setArbiterBlocks([]); setDiceRollBlocks([]);

    try {
      const res = await fetch(`/api/sessions/${session.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      await consumeStream(res, { isEnd: false });
    } catch (err) {
      setMessages(m => [...m, { role: 'assistant', content: `[Error: ${err.message}]`, id: Date.now() }]);
      setStreaming(false);
    }
  };

  // ── End session ─────────────────────────────────────────────────────────────
  const handleEndSession = async () => {
    setShowEndConfirm(false);
    setEnding(true); setStateBuffer('');

    try {
      const res = await fetch(`/api/sessions/${session.id}/end`, { method: 'POST' });
      await consumeStream(res, { isEnd: true });
    } catch (err) {
      setMessages(m => [...m, { role: 'assistant', content: `[Error ending session: ${err.message}]`, id: Date.now() }]);
      setEnding(false);
    }
  };

  // ── Shared SSE consumer ─────────────────────────────────────────────────────
  const consumeStream = async (res, { isEnd }) => {
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let textBuffer = '';
    let reportTextBuffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const lines = decoder.decode(value).split('\n');

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6));

          if (data.text) {
            textBuffer += data.text;
            if (isEnd) {
              setStateBuffer(textBuffer);
            } else {
              setStreamBuffer(textBuffer);
            }
          }

          if (data.arbiter_start) {
            if (!isEnd && textBuffer.trim()) {
              setMessages(m => [...m, { role: 'assistant', content: textBuffer, id: Date.now() }]);
              textBuffer = '';
              setStreamBuffer('');
            }
            setPendingArbiter(data.question);
          }

          if (data.arbiter_done) {
            setPendingArbiter(null);
            setArbiterBlocks(bs => [...bs, { question: data.question, ruling: data.ruling }]);
          }

          if (data.dice_roll) {
            setDiceRollBlocks(bs => [...bs, { label: data.label, results: data.results }]);
          }

          if (data.session_title) {
            setSessionTitle(data.session_title);
            onSessionTitleChange?.(data.session_title);
          }

          if (data.report_text) {
            reportTextBuffer += data.report_text;
            setReportBuffer(reportTextBuffer);
          }

          if (data.done) {
            if (isEnd) {
              // Reload to get saved state + report messages
              const fresh = await fetch(`/api/sessions/${session.id}/messages`).then(r => r.json());
              setMessages(mergeMessages(fresh));
              setStateBuffer(''); setReportBuffer('');
              setEnding(false);
              setSessionEnded(true);
            } else {
              const fresh = await fetch(`/api/sessions/${session.id}/messages`).then(r => r.json());
              setMessages(mergeMessages(fresh));
              setStreamBuffer(''); setArbiterBlocks([]); setDiceRollBlocks([]); setPendingArbiter(null);
              setStreaming(false);
            }
          }

          if (data.error) {
            setMessages(m => [...m, { role: 'assistant', content: `[Error: ${data.error}]`, id: Date.now() }]);
            setStreaming(false); setEnding(false);
          }
        } catch {}
      }
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const handleInput = (e) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px';
  };

  const busy = streaming || ending;

  return (
    <div className="chat-window" style={{ '--campaign-color': campaign.color }}>
      <div className="chat-header">
        <button
          className="chat-sessions-toggle"
          type="button"
          onClick={onOpenSidebar}
          aria-label="Open sessions drawer"
        >
          <span className="chat-sessions-toggle-icon">☰</span>
          <span>Sessions</span>
        </button>
        <span className="chat-session-title">
          {sessionTitle}
          {sessionEnded && <span className="session-ended-badge">Ended</span>}
        </span>
        <div className="chat-header-actions">
          <span className="chat-campaign-tag">{campaign.icon} {campaign.name}</span>
          {!sessionEnded && (
            <button
              className="btn-end-session"
              onClick={() => setShowEndConfirm(true)}
              disabled={busy}
              title="End session and save state"
            >
              End Session
            </button>
          )}
        </div>
      </div>

      <div className="messages">
        {messages.length === 0 && !streaming && !ending && (
          <div className="messages-empty">
            <span className="messages-empty-icon">{campaign.icon}</span>
            <p>The session begins. What do you do?</p>
          </div>
        )}

        {messages.map((msg, i) => <Message key={msg.id ?? i} msg={msg} />)}

        {diceRollBlocks.map((b, i) => (
          <DiceRollBlock key={`live-dice-${i}`} label={b.label} results={b.results} />
        ))}
        {arbiterBlocks.map((b, i) => (
          <ArbiterBlock key={`live-arbiter-${i}`} question={b.question} ruling={b.ruling} />
        ))}
        {pendingArbiter && <ArbiterPending question={pendingArbiter} />}

        {streaming && streamBuffer && (
          <div className="message message-assistant streaming">
            <div className="message-label">GM</div>
            <div className="message-content">{streamBuffer}<span className="cursor" /></div>
          </div>
        )}
        {streaming && !streamBuffer && !pendingArbiter && (
          <div className="message message-assistant">
            <div className="message-label">GM</div>
            <div className="message-content thinking"><span /><span /><span /></div>
          </div>
        )}

        {ending && (
          <StateBlock content={stateBuffer || '…'} isStreaming={!reportBuffer} />
        )}
        {ending && reportBuffer && (
          <div className="message message-archive">
            <div className="message-archive-header">
              <span className="archive-rule" /><span className="archive-label">📜 Session Report</span><span className="archive-rule" />
            </div>
            <div className="message-content">{reportBuffer}<span className="cursor" /></div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {!sessionEnded && (
        <div className="input-row">
          <div className="input-area">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder="Describe your action… (Enter to send, Shift+Enter for newline)"
              rows={2}
              disabled={busy}
            />
            <button className="send-btn" onClick={send} disabled={busy || !input.trim()}>
              {streaming ? '…' : '→'}
            </button>
          </div>
        </div>
      )}

      {sessionEnded && (
        <div className="session-ended-bar">
          Session ended — state saved to campaign folder.
        </div>
      )}

      {showEndConfirm && (
        <EndSessionConfirm
          onConfirm={handleEndSession}
          onCancel={() => setShowEndConfirm(false)}
        />
      )}
    </div>
  );
}
