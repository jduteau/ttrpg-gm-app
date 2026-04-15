import React, { useState, useEffect, useCallback } from 'react';
import './Sidebar.css';

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }) + ' · ' + d.toLocaleTimeString('en-CA', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function fileLabel(path) {
  const name = path.split('/').pop().replace(/\.[^.]+$/, '');
  return name.replace(/^\d+-/, '').replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

export default function Sidebar({
  campaign,
  activeSession,
  onSelectSession,
  onNewSession,
  onChangeCampaign,
  onHasActiveChange,
  isOpen,
  onClose,
}) {
  const [sessions, setSessions] = useState([]);
  const [deletingId, setDeletingId] = useState(null);

  const fetchSessions = useCallback(() => {
    fetch(`/api/campaigns/${campaign.id}/sessions`)
      .then(r => r.json())
      .then(data => {
        setSessions(data);
        onHasActiveChange?.(data.some(s => !s.ended_at));
      })
      .catch(console.error);
  }, [campaign.id]);

  useEffect(() => { fetchSessions(); }, [fetchSessions, activeSession]);

  const handleDelete = async (e, sessionId) => {
    e.stopPropagation();
    if (!confirm('Delete this session?')) return;
    setDeletingId(sessionId);
    await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
    setDeletingId(null);
    fetchSessions();
    if (activeSession?.id === sessionId) onSelectSession(null);
  };

  const contextFiles = activeSession?.context_files || [];
  const modules    = contextFiles.filter(f => f.startsWith('modules/'));
  const references = contextFiles.filter(f => f.startsWith('references/'));

  return (
    <aside className={`sidebar ${isOpen ? 'open' : ''}`} style={{ '--campaign-color': campaign.color }}>
      <div className="sidebar-header">
        <div className="sidebar-header-top">
          <button className="campaign-back" onClick={onChangeCampaign}>← All Campaigns</button>
          <button className="sidebar-close" onClick={onClose} aria-label="Close campaign drawer">✕</button>
        </div>
        <div className="sidebar-campaign">
          <span className="sidebar-icon">{campaign.icon}</span>
          <div>
            <div className="sidebar-campaign-name">{campaign.name}</div>
            <div className="sidebar-campaign-sub">{campaign.subtitle}</div>
          </div>
        </div>
      </div>

      {/* Active context files */}
      {contextFiles.length > 0 && (
        <div className="sidebar-context">
          <div className="sidebar-section-label">Active Context</div>
          {modules.length > 0 && (
            <div className="context-group">
              <span className="context-group-label">Modules</span>
              {modules.map(f => (
                <div key={f} className="context-file">📄 {fileLabel(f)}</div>
              ))}
            </div>
          )}
          {references.length > 0 && (
            <div className="context-group">
              <span className="context-group-label">References</span>
              {references.map(f => (
                <div key={f} className="context-file">📎 {fileLabel(f)}</div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="sidebar-sessions-header">
        <span>Sessions</span>
        <button
          className="btn-new-session"
          onClick={onNewSession}
          disabled={sessions.some(s => !s.ended_at)}
          title={sessions.some(s => !s.ended_at) ? 'End the current session before starting a new one' : undefined}
        >+ New</button>
      </div>

      <div className="session-list">
        {sessions.length === 0 && (
          <div className="session-empty">No sessions yet</div>
        )}
        {sessions.map(session => (
          <div
            key={session.id}
            className={`session-item ${activeSession?.id === session.id ? 'active' : ''} ${deletingId === session.id ? 'deleting' : ''} ${!session.ended_at ? 'in-progress' : 'ended'}`}
            onClick={() => onSelectSession(session)}
          >
            <div className="session-item-body">
              <span className="session-title">{session.title}</span>
              <div className="session-meta">
                <span className="session-date">{formatDate(session.updated_at)}</span>
                {session.context_files?.length > 0 && (
                  <span className="session-files-badge">{session.context_files.length} file{session.context_files.length !== 1 ? 's' : ''}</span>
                )}
              </div>
            </div>
            <button className="session-delete" onClick={e => handleDelete(e, session.id)} title="Delete">✕</button>
          </div>
        ))}
      </div>
    </aside>
  );
}
