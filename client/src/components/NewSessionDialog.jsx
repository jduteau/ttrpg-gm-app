import React, { useState, useEffect } from 'react';
import { apiUrl, getAuthHeaders } from '../api.js';
import './NewSessionDialog.css';

export default function NewSessionDialog({ campaign, onConfirm, onCancel }) {
  const [files, setFiles] = useState({ modules: [], references: [] });
  const [selected, setSelected] = useState([]);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(apiUrl(`/api/campaigns/${campaign.id}/files`), {
      headers: getAuthHeaders()
    })
      .then(r => r.json())
      .then(data => {
        setFiles(data);
        setLoading(false);
      });
  }, [campaign.id]);

  const toggle = (path) => {
    setSelected(s =>
      s.includes(path) ? s.filter(p => p !== path) : [...s, path]
    );
  };

  const handleConfirm = () => {
    onConfirm({ title: title.trim() || undefined, context_files: selected });
  };

  const hasFiles = files.modules.length > 0 || files.references.length > 0;

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog" onClick={e => e.stopPropagation()} style={{ '--campaign-color': campaign.color }}>
        <div className="dialog-header">
          <span className="dialog-icon">{campaign.icon}</span>
          <div>
            <div className="dialog-title">New Session</div>
            <div className="dialog-subtitle">{campaign.name}</div>
          </div>
        </div>

        <div className="dialog-body">
          <div className="field">
            <label>Session title <span className="field-hint">(optional)</span></label>
            <input
              type="text"
              placeholder="Session 4 — Into the Caves of Chaos"
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleConfirm()}
              autoFocus
            />
          </div>

          {loading && <div className="dialog-loading">Loading files…</div>}

          {!loading && !hasFiles && (
            <div className="dialog-empty">
              No module or reference files found.<br />
              Add <code>.md</code> files to <code>campaigns/{campaign.id}/modules/</code> or <code>references/</code>.
            </div>
          )}

          {!loading && files.modules.length > 0 && (
            <FileGroup
              label="Modules"
              files={files.modules}
              selected={selected}
              onToggle={toggle}
            />
          )}

          {!loading && files.references.length > 0 && (
            <FileGroup
              label="References"
              files={files.references}
              selected={selected}
              onToggle={toggle}
            />
          )}
        </div>

        <div className="dialog-footer">
          <button className="btn-cancel" onClick={onCancel}>Cancel</button>
          <button className="btn-confirm" onClick={handleConfirm}>
            Begin Session
            {selected.length > 0 && (
              <span className="btn-badge">{selected.length} file{selected.length !== 1 ? 's' : ''}</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function FileGroup({ label, files, selected, onToggle }) {
  return (
    <div className="file-group">
      <div className="file-group-label">{label}</div>
      <div className="file-list">
        {files.map(f => (
          <label key={f.path} className={`file-item ${selected.includes(f.path) ? 'checked' : ''}`}>
            <input
              type="checkbox"
              checked={selected.includes(f.path)}
              onChange={() => onToggle(f.path)}
            />
            <span className="file-check">{selected.includes(f.path) ? '✓' : ''}</span>
            <span className="file-label">{f.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
