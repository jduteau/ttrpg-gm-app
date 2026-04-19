import React, { useState, useEffect } from 'react';
import AuthScreen from './components/AuthScreen.jsx';
import CampaignSelector from './components/CampaignSelector.jsx';
import Sidebar from './components/Sidebar.jsx';
import ChatWindow from './components/ChatWindow.jsx';
import NewSessionDialog from './components/NewSessionDialog.jsx';
import { apiUrl } from './api.js';
import './App.css';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [rulesets, setRulesets] = useState({});
  const [activeCampaign, setActiveCampaign] = useState(null);
  const [activeSession, setActiveSession] = useState(null);
  const [showSelector, setShowSelector] = useState(true);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [hasActiveSession, setHasActiveSession] = useState(false);

  // Check if user is already authenticated on app load
  useEffect(() => {
    const token = localStorage.getItem('auth-token');
    if (token) {
      // Verify token is still valid by making a test request
      fetch(apiUrl('/api/rulesets'), {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      .then(response => {
        if (response.ok) {
          setIsAuthenticated(true);
          return response.json();
        } else {
          // Token is invalid, remove it
          localStorage.removeItem('auth-token');
          throw new Error('Invalid token');
        }
      })
      .then(setRulesets)
      .catch(console.error)
      .finally(() => setAuthChecked(true));
    } else {
      setAuthChecked(true);
    }
  }, []);

  // Load rulesets after authentication
  useEffect(() => {
    if (isAuthenticated && Object.keys(rulesets).length === 0) {
      fetch(apiUrl('/api/rulesets'), {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth-token')}` }
      })
        .then(r => r.json())
        .then(setRulesets)
        .catch(console.error);
    }
  }, [isAuthenticated, rulesets]);

  const handleAuthenticated = () => {
    setIsAuthenticated(true);
  };

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
    const res = await fetch(apiUrl(`/api/campaigns/${activeCampaign.id}/sessions`), {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('auth-token')}`
      },
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

  // Show loading while checking authentication
  if (!authChecked) {
    return (
      <div className="auth-screen">
        <div className="auth-container">
          <div className="auth-header">
            <span className="auth-icon">🎲</span>
            <h1>TTRPG Game Master</h1>
            <p>Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  // Show auth screen if not authenticated
  if (!isAuthenticated) {
    return <AuthScreen onAuthenticated={handleAuthenticated} />;
  }

  if (showSelector || !activeCampaign) {
    return (
      <CampaignSelector
        rulesets={rulesets}
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
        {activeSession ? (
          <ChatWindow
            session={activeSession}
            campaign={activeCampaign}
            onSessionTitleChange={title => setActiveSession(s => ({ ...s, title }))}
            onOpenSidebar={() => setSidebarOpen(true)}
          />
        ) : (
          <div className="empty-state">
            <button
              className="mobile-sidebar-toggle"
              type="button"
              onClick={() => setSidebarOpen(open => !open)}
              aria-expanded={sidebarOpen}
              aria-label={sidebarOpen ? 'Close campaign drawer' : 'Open campaign drawer'}
            >
              <span className="mobile-sidebar-toggle-icon">☰</span>
              <span className="mobile-sidebar-toggle-text">Sessions</span>
            </button>
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
