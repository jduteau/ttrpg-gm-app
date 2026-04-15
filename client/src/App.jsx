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
  };

  const handleChangeCampaign = () => {
    setShowSelector(true);
    setActiveSession(null);
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
      <Sidebar
        campaign={activeCampaign}
        activeSession={activeSession}
        onSelectSession={setActiveSession}
        onNewSession={handleNewSession}
        onChangeCampaign={handleChangeCampaign}
      />

      <main className="app-main">
        {activeSession ? (
          <ChatWindow session={activeSession} campaign={activeCampaign} />
        ) : (
          <div className="empty-state">
            <div className="empty-state-inner">
              <span className="empty-icon">{activeCampaign.icon}</span>
              <h2>{activeCampaign.name}</h2>
              <p>{activeCampaign.subtitle}</p>
              <button className="btn-primary" onClick={handleNewSession}>
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
