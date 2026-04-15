import React, { useState, useEffect, useRef } from 'react';
import './ChatWindow.css';

export default function ChatWindow({ session, campaign }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState('');
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    fetch(`/api/sessions/${session.id}/messages`)
      .then(r => r.json())
      .then(setMessages);
    setStreamBuffer('');
    setStreaming(false);
  }, [session.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamBuffer]);

  const send = async () => {
    if (!input.trim() || streaming) return;
    const text = input.trim();
    setInput('');
    setMessages(m => [...m, { role: 'user', content: text, id: Date.now() }]);
    setStreaming(true);
    setStreamBuffer('');

    try {
      const res = await fetch(`/api/sessions/${session.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.text) {
              buffer += data.text;
              setStreamBuffer(b => b + data.text);
            }
            if (data.done) {
              setMessages(m => [...m, { role: 'assistant', content: buffer, id: Date.now() }]);
              setStreamBuffer('');
              setStreaming(false);
            }
            if (data.error) {
              setMessages(m => [...m, { role: 'assistant', content: `[Error: ${data.error}]`, id: Date.now() }]);
              setStreamBuffer('');
              setStreaming(false);
            }
          } catch {}
        }
      }
    } catch (err) {
      setMessages(m => [...m, { role: 'assistant', content: `[Connection error: ${err.message}]`, id: Date.now() }]);
      setStreamBuffer('');
      setStreaming(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  // Auto-resize textarea
  const handleInput = (e) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px';
  };

  return (
    <div className="chat-window" style={{ '--campaign-color': campaign.color }}>
      <div className="chat-header">
        <span className="chat-session-title">{session.title}</span>
        <span className="chat-campaign-tag">{campaign.icon} {campaign.name}</span>
      </div>

      <div className="messages">
        {messages.length === 0 && !streaming && (
          <div className="messages-empty">
            <span className="messages-empty-icon">{campaign.icon}</span>
            <p>The session begins. What do you do?</p>
          </div>
        )}

        {messages.map((msg, i) => (
          msg.role === 'archive' ? (
            <div key={msg.id ?? i} className="message message-archive">
              <div className="message-archive-header">
                <span className="archive-rule" />
                <span className="archive-label">📜 Session Archive</span>
                <span className="archive-rule" />
              </div>
              <div className="message-content">{msg.content}</div>
              <div className="message-archive-footer">
                <span className="archive-rule" />
                <span className="archive-label-end">— End of Archive —</span>
                <span className="archive-rule" />
              </div>
            </div>
          ) : (
            <div key={msg.id ?? i} className={`message message-${msg.role}`}>
              <div className="message-label">
                {msg.role === 'user' ? 'You' : 'GM'}
              </div>
              <div className="message-content">{msg.content}</div>
            </div>
          )
        ))}

        {streaming && streamBuffer && (
          <div className="message message-assistant streaming">
            <div className="message-label">GM</div>
            <div className="message-content">
              {streamBuffer}
              <span className="cursor" />
            </div>
          </div>
        )}

        {streaming && !streamBuffer && (
          <div className="message message-assistant">
            <div className="message-label">GM</div>
            <div className="message-content thinking">
              <span /><span /><span />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="input-row">
        <div className="input-area">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Describe your action… (Enter to send, Shift+Enter for newline)"
            rows={2}
            disabled={streaming}
          />
          <button
            className="send-btn"
            onClick={send}
            disabled={streaming || !input.trim()}
            title="Send (Enter)"
          >
            {streaming ? '…' : '→'}
          </button>
        </div>
      </div>
    </div>
  );
}
