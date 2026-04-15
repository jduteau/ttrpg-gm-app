/**
 * Migration: Restructure campaigns to ruleset.campaign format
 * 
 * Changes campaign_id from 'ose' to 'ose.lolth-conspiracy' format
 * to support multiple campaigns per ruleset.
 */

export function runMigration(db) {
  console.log('Running migration: Restructure campaigns to ruleset.campaign format');
  
  // Campaign ID mapping from old to new format
  const campaignMigrationMap = {
    'ose': 'ose.lolth-conspiracy',
    'masks': 'masks.halcyon-city', 
    'dragonbane': 'dragonbane.mercy-row',
    'ironsworn': 'ironsworn-badlands.jake-powell'
  };
  
  // Check if migration already applied
  const existingIds = db.prepare('SELECT DISTINCT campaign_id FROM sessions').all();
  const hasCompositeIds = existingIds.some(row => row.campaign_id.includes('.'));
  
  if (hasCompositeIds) {
    console.log('Migration already applied - skipping');
    return;
  }
  
  // Update campaign_ids to new format
  for (const [oldId, newId] of Object.entries(campaignMigrationMap)) {
    const result = db.prepare('UPDATE sessions SET campaign_id = ? WHERE campaign_id = ?').run(newId, oldId);
    if (result.changes > 0) {
      console.log(`Migrated ${result.changes} sessions from '${oldId}' to '${newId}'`);
    }
  }
  
  console.log('Campaign restructure migration completed');
}

/**
 * Helper function to parse composite campaign ID
 * @param {string} campaignId - Format: 'ruleset.campaign'
 * @returns {{rulesetId: string, campaignId: string}}
 */
export function parseCampaignId(campaignId) {
  const [rulesetId, ...campaignParts] = campaignId.split('.');
  return {
    rulesetId,
    campaignId: campaignParts.join('.') // Handle campaign names with dots
  };
}

/**
 * Helper function to build composite campaign ID
 * @param {string} rulesetId 
 * @param {string} campaignId 
 * @returns {string} - Format: 'ruleset.campaign'
 */
export function buildCampaignId(rulesetId, campaignId) {
  return `${rulesetId}.${campaignId}`;
}