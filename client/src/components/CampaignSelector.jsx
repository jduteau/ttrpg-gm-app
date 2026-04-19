import React, { useState } from 'react';
import './CampaignSelector.css';

export default function CampaignSelector({ rulesets, onSelect, activeCampaign }) {
  const [selectedRuleset, setSelectedRuleset] = useState(null);

  const handleRulesetSelect = (rulesetId, rulesetData) => {
    setSelectedRuleset({ id: rulesetId, ...rulesetData });
  };

  const handleCampaignSelect = (campaign) => {
    // Create full campaign object with ruleset info for compatibility
    const fullCampaign = {
      id: `${selectedRuleset.id}.${campaign.id}`,
      name: campaign.name,
      subtitle: campaign.description,
      icon: selectedRuleset.icon,
      color: selectedRuleset.color
    };
    onSelect(fullCampaign);
  };

  const handleBack = () => {
    setSelectedRuleset(null);
  };

  // Stage 1: Show rulesets
  if (!selectedRuleset) {
    return (
      <div className="selector-screen">
        <div className="selector-bg" />
        <div className="selector-content">
          <header className="selector-header">
            <div className="selector-rule" />
            <h1>GM Screen</h1>
            <div className="selector-rule" />
          </header>
          <p className="selector-subtitle">Choose your rules system</p>
          <div className="campaign-grid">
            {Object.entries(rulesets).map(([rulesetId, ruleset]) => (
              <button
                key={rulesetId}
                className="campaign-card"
                onClick={() => handleRulesetSelect(rulesetId, ruleset)}
                style={{ '--campaign-color': ruleset.color }}
              >
                <div className="card-glow" />
                <span className="card-icon">{ruleset.icon}</span>
                <div className="card-text">
                  <span className="card-name">{ruleset.name}</span>
                  <span className="card-sub">
                    {ruleset.campaigns.length} campaign{ruleset.campaigns.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="card-arrow">→</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Stage 2: Show campaigns for selected ruleset
  return (
    <div className="selector-screen">
      <div className="selector-bg" />
      <div className="selector-content">
        <header className="selector-header">
          <div className="selector-rule" />
          <h1>GM Screen</h1>
          <div className="selector-rule" />
        </header>
        <div className="ruleset-breadcrumb">
          <button 
            className="back-button"
            onClick={handleBack}
            style={{ '--campaign-color': selectedRuleset.color }}
          >
            ← Back to rules systems
          </button>
          <div className="current-ruleset">
            <span className="ruleset-icon">{selectedRuleset.icon}</span>
            <span className="ruleset-name">{selectedRuleset.name}</span>
          </div>
        </div>
        <p className="selector-subtitle">Choose your campaign</p>
        <div className="campaign-grid">
          {selectedRuleset.campaigns.map((campaign) => {
            const fullCampaignId = `${selectedRuleset.id}.${campaign.id}`;
            const isActive = activeCampaign?.id === fullCampaignId;
            
            return (
              <button
                key={campaign.id}
                className={`campaign-card ${isActive ? 'active' : ''}`}
                onClick={() => handleCampaignSelect(campaign)}
                style={{ '--campaign-color': selectedRuleset.color }}
              >
                <div className="card-glow" />
                <span className="card-icon">{selectedRuleset.icon}</span>
                <div className="card-text">
                  <span className="card-name">{campaign.name}</span>
                  <span className="card-sub">{campaign.description}</span>
                </div>
                <div className="card-arrow">→</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
