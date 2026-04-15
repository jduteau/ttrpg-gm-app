import React from 'react';
import './CampaignSelector.css';

export default function CampaignSelector({ campaigns, onSelect, activeCampaign }) {
  return (
    <div className="selector-screen">
      <div className="selector-bg" />
      <div className="selector-content">
        <header className="selector-header">
          <div className="selector-rule" />
          <h1>GM Screen</h1>
          <div className="selector-rule" />
        </header>
        <p className="selector-subtitle">Choose your campaign</p>
        <div className="campaign-grid">
          {campaigns.map((campaign) => (
            <button
              key={campaign.id}
              className={`campaign-card ${activeCampaign?.id === campaign.id ? 'active' : ''}`}
              onClick={() => onSelect(campaign)}
              style={{ '--campaign-color': campaign.color }}
            >
              <div className="card-glow" />
              <span className="card-icon">{campaign.icon}</span>
              <div className="card-text">
                <span className="card-name">{campaign.name}</span>
                <span className="card-sub">{campaign.subtitle}</span>
              </div>
              <div className="card-arrow">→</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
