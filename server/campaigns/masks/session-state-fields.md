# Masks Campaign State Fields

Append these fields inside the SESSION STATE block, after the universal fields:

```
## Influence & Labels
[For each PC, current label array and who holds influence over them:]
- name: [PC name]
  labels: [Danger X / Freak X / Savior X / Superior X / Mundane X]
  influenced_by: [NPCs or PCs who hold influence]
  conditions: [any marked conditions: afraid/angry/guilty/hopeless/insecure]

## Team Moves
potential: [current team potential]
last_team_move: [most recent team move triggered]

## Villains & Threats
[Active villains or threats with their current plan/status]

## Adult/NPC Pressure
[Key adult NPCs and what they currently want from the team]

## Advancements
[Any advancements taken this session]
```
