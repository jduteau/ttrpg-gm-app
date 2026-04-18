# World State Format

This template demonstrates the format for world state files. The world state captures established facts, locations, NPCs, and events that have emerged during play.

## Structure

Each entry should be formatted as:
```
- **[CATEGORY]** Description of fact [S#] (OPTIONAL FLAGS)
```

### Categories:
- **LOCATIONS** - Named places, areas, or geographic features
- **NPCS** - Any notable characters, named or unnamed
- **FACTIONS** - Groups, organizations, or political entities  
- **PARTY** - Actions taken or reputation earned by the party
- **LORE** - Historical facts, legends, or world background
- **OPEN THREADS** - Unresolved plot hooks or mysteries

### Flags:
- **(UNVERIFIED)** - Rumors or secondhand information
- **(DEAD)** - Deceased NPCs (keep for reference)
- **(RESOLVED)** - Completed plot threads (keep for continuity)

### Session References:
- **[S1]** - Session 1
- **[S2]** - Session 2
- etc.

## Examples

- **[LOCATIONS]** The Red Dragon Inn has a stable behind it run by Old Henrik [S1]
- **[NPCS]** Captain Marlowe of the city watch, gruff but fair, has a scar across his left cheek [S2]
- **[FACTIONS]** The Merchant's Guild controls most trade through the eastern districts [S1]
- **[PARTY]** The party is known as "the heroes who saved the baker's daughter" in Millhaven [S3]
- **[LORE]** The ancient dwarven kingdom of Kazak-Dum fell to shadow creatures 200 years ago [S2] (UNVERIFIED)
- **[OPEN THREADS]** Strange lights seen in the Whispering Woods at night [S1]
- **[NPCS]** Grimjaw the orc bandit leader [S4] (DEAD)

## Guidelines

1. **Err on the side of inclusion** - Capture even small details that might matter later
2. **One fact per line** - Don't summarize or combine entries  
3. **Include prices, distances, timeframes** mentioned casually
4. **Flag uncertain information** as (UNVERIFIED)
5. **Keep dead NPCs and resolved threads** for continuity and consequences
6. **Record party actions** that others might remember or react to