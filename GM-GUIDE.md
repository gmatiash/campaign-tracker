# Game Master Guide

This is the full toolset for running an encounter: build a map, manage combatants, run
turns, and control fog, walls, lighting, and vision. Local mode makes you GM automatically;
in cloud mode the **first member to join** a campaign is its GM. Open the in-app **Guide**
button any time for a quick version of this.

## 1. Set up a map
- **Upload map** — drop in an image. The grid is **auto-detected**; fine-tune with the
  **Cell** size, **Color**, and **Off X / Y** sliders until the overlay matches the art.
- **Units** — toggle **ft ↔ m**; the choice is shared by the whole campaign.
- **Navigate** — drag to pan, wheel to zoom, **Fit** to recentre.

## 2. Combatants & tokens
- **Add** PCs and NPCs in the **combat tracker** below the map. **Clone** duplicates an NPC
  with automatic numbering (Goblin 1, Goblin 2…).
- **Place & move** — under **Place**, click a name to drop the token, then **drag** it on
  the map. Movement traces the shortest path **around walls** (through open doors) and shows
  the distance; a **red** path means the destination is walled off.
- **Customise** — per token set **color**, **portrait**, and **size**; toggle **Reach ×2**
  for reach weapons (shows the doubled threatened ring).

## 3. Run combat
- **Start / Order** sorts by initiative. **Roll NPCs** rolls NPC initiative. **Next turn**
  advances and tracks the **round**.
- **Undo turn** steps back to the start of the previous turn.
- **Conditions** — toggle any of the 20 conditions per combatant. Set a **Duration** in
  rounds and it counts down at the **start of that creature's turn**, clearing itself at 0.
- **New combat** clears NPCs, the board, damage, conditions, lights and the round —
  keeping your PCs.

## 4. Fog of war
- **Fog On/Off**, then **Reveal/Hide** by dragging a box, or **Room** to flood-fill a whole
  area bounded by walls. **Reveal all / Hide all** reset everything.
- **LoS fog** auto-reveals what the **party** (all PC tokens) can see — their light and
  vision, blocked by walls. Reveals are **kept** as an explored map; pair it with Lighting
  to dim explored-but-unlit areas.
- **View as player** previews exactly what players see — no walls, hidden tokens, or
  unexplored areas. Use it before streaming.

## 5. Walls, doors & secret doors
- **Wall** — drag along grid lines to build walls; they block **movement, light and sight**.
- **Door** — click an edge to add a door; click it again to **open/close** it. Closed doors
  block everything; **open** doors let movement, light and sight through (shown hollow).
- **Secret** — a door that reads as a **wall to players** until you open it (purple to you).
- **Erase** — click any wall or door to delete it (or double-click with the Wall/Door tool).

## 6. Lighting & vision
- **Light On/Off** shows wall-occluded illumination. **Ambient** sets the base level:
  **dark** (sources only), **dim**, or **bright** (daylight).
- **+ Light** drops an independent source; select it to choose a radius (5/15/20/30 ft) or a
  60 ft **Cone** with an aim, and a **Color**. Lit areas **flicker** gently.
- **Token light & vision** — select a token to give it a light (radius or cone + color),
  **Low-light** vision (doubles every light's range for it), or **Darkvision 60**.
- **Perspective** — selecting a token shows the scene from **its** point of view: lit areas
  it can't actually see (e.g. a lit room across a wall) go dark, and tokens it can't see are
  hidden. Click empty space to return to the full GM view.

## 7. Movement & measuring
- **Range** — select a token and toggle Range to see **move / double / run** tiers around
  walls; set the token's **Speed** in the panel (default 30 ft).
- **Measure** — drag anywhere for a quick distance with no token involved.
- **Reach** — highlights the threatened squares for the selected creature.

## 8. Spell areas (AoE)
- **+ Burst / + Cone / + Line** drop a template; drag its **origin dot** to position it.
- In the editor set **size, aim, opacity and color**, and an **Effect**: a preset
  (fire, water, mud, mist, ice, acid) or an **uploaded image** tiled across the area.

## 9. Sharing & data
- **Invite** (cloud) shares the campaign link; **Members** manages player/GM **roles**.
- **Export / Import** backs up and restores the whole campaign as JSON, in any mode.
- **Reset to demo** wipes the campaign back to the sample content (GM only in cloud).
- **Streaming** — share only the map area to keep your toolbars off-screen, and confirm the
  player view with **View as player**.
