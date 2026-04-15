# Session State Template

When writing the session state snapshot, populate all fields below. Leave a field as `none` if it does not apply. Do not omit fields.

```
<!-- SESSION STATE -->
## Location
current: [where the party/character is right now, specific area and sub-location]
last_safe_rest: [where they last rested or camped]
known_exits: [notable exits or paths from current location]

## NPCs
[For each significant NPC encountered or active:]
- name: [NPC name]
  status: [alive/dead/unknown]
  disposition: [friendly/neutral/hostile/unknown]
  last_seen: [where/when]
  notes: [any relevant state — hired, quest-giver, threatened, etc.]

## Quests & Threads
[For each active quest or plot thread:]
- title: [short name]
  status: [active/completed/failed/dormant]
  summary: [one sentence]
  next_step: [what the party/character intends to do]

## Party / Character Status
[List each PC with current HP, any conditions, notable inventory changes since last session]

## Pending & Unresolved
[Anything mid-scene: interrupted actions, unresolved rolls, cliffhangers, oracle questions asked but not answered]

## Session Notes
[2-4 bullet points summarising the most important things that happened this session, for future reference]
<!-- /SESSION STATE -->
```
