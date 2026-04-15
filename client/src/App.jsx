import React, { useState, useEffect } from 'react';
import CampaignSelector from './components/CampaignSelector.jsx';
import Sidebar from './components/Sidebar.jsx';
import ChatWindow from './components/ChatWindow.jsx';
import NewSessionDialog from './components/NewSessionDialog.jsx';
import './App.css';

export default function App() {
  const [campaigns, setCampaigns] = useState([]);
  const [activeCampaign, setActiveCampaign] = useState(null);
  const [activeSession, setActiveSession] = useState(null);
  const [showSelector, setShowSelector] = useState(true);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [hasActiveSession, setHasActiveSession] = useState(false);

  useEffect(() => {
    fetch('/api/campaigns')
      .then(r => r.json())
      .then(setCampaigns)
      .catch(console.error);
  }, []);

  const handleSelectCampaign = (campaign) => {
    setActiveCampaign(campaign);
    setActiveSession(null);
    setShowSelector(false);
    setSidebarOpen(false);
  };

  const handleNewSession = () => {
    setShowNewDialog(true);
  };

  const handleDialogConfirm = async ({ title, context_files }) => {
    setShowNewDialog(false);
    const res = await fetch(`/api/campaigns/${activeCampaign.id}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, context_files }),
    });
    const session = await res.json();
    setActiveSession(session);
    setSidebarOpen(false);
  };

  const handleChangeCampaign = () => {
    setShowSelector(true);
    setActiveSession(null);
    setSidebarOpen(false);
    setHasActiveSession(false);
  };

  const handleSelectSession = (session) => {
    setActiveSession(session);
    setSidebarOpen(false);
  };

  if (showSelector || !activeCampaign) {
    return (
      <CampaignSelector
        campaigns={campaigns}
        onSelect={handleSelectCampaign}
        activeCampaign={activeCampaign}
      />
    );
  }

  return (
    <div className="app-layout">
      <div
        className={`sidebar-scrim ${sidebarOpen ? 'open' : ''}`}
        onClick={() => setSidebarOpen(false)}
        aria-hidden={!sidebarOpen}
      />

      <Sidebar
        campaign={activeCampaign}
        activeSession={activeSession}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        onChangeCampaign={handleChangeCampaign}
        onHasActiveChange={setHasActiveSession}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <main className="app-main">
        <button
          className="mobile-sidebar-toggle"
          type="button"
          onClick={() => setSidebarOpen(open => !open)}
          aria-expanded={sidebarOpen}
          aria-label={sidebarOpen ? 'Close campaign drawer' : 'Open campaign drawer'}
        >
          <span className="mobile-sidebar-toggle-icon">☰</span>
          <span className="mobile-sidebar-toggle-text">Campaigns</span>
        </button>

        {activeSession ? (
          <ChatWindow
            session={activeSession}
            campaign={activeCampaign}
            onSessionTitleChange={title => setActiveSession(s => ({ ...s, title }))}
          />
        ) : (
          <div className="empty-state">
            <div className="empty-state-inner">
              <span className="empty-icon">{activeCampaign.icon}</span>
              <h2>{activeCampaign.name}</h2>
              <p>{activeCampaign.subtitle}</p>
              <button className="btn-primary" onClick={handleNewSession} disabled={hasActiveSession} title={hasActiveSession ? 'End the current session before starting a new one' : undefined}>
                Begin New Session
              </button>
            </div>
          </div>
        )}
      </main>

      {showNewDialog && (
        <NewSessionDialog
          campaign={activeCampaign}
          onConfirm={handleDialogConfirm}
          onCancel={() => setShowNewDialog(false)}
        />
      )}
    </div>
  );
}
