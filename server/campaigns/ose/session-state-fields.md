# OSE Campaign State Fields

Append these fields inside the SESSION STATE block, after the universal fields:

```
## Dungeon State
level: [current dungeon level, or "surface"]
area: [room number or area name if known]
torch_time: [approximate torches/light remaining]
mapping_notes: [any unmapped exits or areas noted]

## Exploration
wandering_check_due: [yes/no — whether a wandering monster check is pending]
noise_level: [quiet/moderate/loud — based on recent actions]
last_encounter: [brief note on last combat or encounter]

## Resources
rations: [days remaining per PC]
encumbrance_notes: [any PCs heavily loaded or at limit]

## Campaign Tracking
xp_this_session: [XP awarded this session per PC]
hommlet_reputation: [how the party stands with key Hommlet factions if relevant]
```
