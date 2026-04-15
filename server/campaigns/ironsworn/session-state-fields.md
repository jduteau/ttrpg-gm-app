# Ironsworn: Badlands State Fields

Append these fields inside the SESSION STATE block, after the universal fields:

```
## Vows
[For each active vow:]
- vow: [the sworn vow text]
  rank: [troublesome/dangerous/formidable/extreme/epic]
  progress: [progress track value, 0-10]
  notes: [complications or progress made this session]

## Character Stats
momentum: [current momentum value, -6 to +10]
health: [current health, 0-5]
spirit: [current spirit, 0-5]
supply: [current supply, 0-5]
conditions: [any active conditions: wounded/shaken/unprepared/encumbered]

## Assets
[Note any asset ability boxes marked or unmarked since last session]

## Oracle Queue
[Any oracle questions asked but whose answers are still in play / unresolved]

## Journey State
destination: [current destination if on a journey]
journey_progress: [progress track value if mid-journey]
waypoints: [notable waypoints passed]
```
