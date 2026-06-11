// src/app/GuidePanel.tsx
import { useState } from "react";
import type { CSSProperties } from "react";

const C = {
  bg: "#0a0c11", panel: "#12151d", row: "#1a1e29", border: "#2b3142",
  text: "#e9e3d4", dim: "#99a0b0", gold: "#d4af37", blue: "#5b8def",
};

interface Section { h: string; items: string[] }

// Each item may use "Term — explanation"; the term before " — " is emphasised.
const PLAYER: Section[] = [
  {
    h: "What this is",
    items: [
      "A shared battle map and combat tracker your GM runs. You mostly watch and read it; your character appears as a token on the map.",
      "If you opened a link and it asks you to sign in, enter your email and click the magic link it sends. Otherwise you're already in.",
    ],
  },
  {
    h: "Reading the map",
    items: [
      "Move around — drag to pan, scroll/pinch to zoom, and press Fit to recentre.",
      "Fog of war — you only see areas your party has discovered and that are lit. Dark or undiscovered areas are hidden on purpose.",
      "Whose turn — the active combatant's token has a glowing gold ring, and the round number shows in the tracker.",
      "Units — distances show in ft or m depending on the campaign setting.",
    ],
  },
  {
    h: "Handy tools (top toolbar)",
    items: [
      "Reach — highlights the squares a creature threatens in melee.",
      "Range — click your token first, then turn this on to see how far it can move (green = single move, gold = double, orange = run), routed around walls.",
      "Measure — drag anywhere to measure a distance without moving anyone (great for ranged attacks and spells).",
    ],
  },
  {
    h: "The combat tracker (below the map)",
    items: [
      "Initiative order — combatants are listed top to bottom in turn order; the active one is highlighted.",
      "Your status — your conditions show as chips, with a rounds counter when they're timed.",
      "Damage — the red number on a token is accumulated damage the GM is tracking.",
    ],
  },
  {
    h: "Tips",
    items: [
      "Can't see something you think you should? Ask the GM — it may simply be outside your character's light or line of sight.",
      "The map and tracker update live as the GM makes changes; you don't need to refresh.",
    ],
  },
];

const GM: Section[] = [
  {
    h: "Set up a map",
    items: [
      "Upload map — drop in an image; the grid is auto-detected. Fine-tune with Cell size, Color, and the Off X/Y sliders to line the grid up with the art.",
      "Units — toggle ft ↔ m; it's shared by the whole campaign.",
      "Navigate — drag to pan, wheel to zoom, Fit to recentre.",
    ],
  },
  {
    h: "Combatants & tokens",
    items: [
      "Add — use the tracker below the map to add PCs and NPCs; Clone duplicates an NPC with auto-numbering.",
      "Place & move — click a token's name under Place to drop it, then drag it on the map. Movement traces the shortest path around walls and shows the distance; a red path means it's walled off.",
      "Customise — set each token's color, portrait, and size in the tracker; toggle Reach ×2 for reach weapons.",
    ],
  },
  {
    h: "Run combat",
    items: [
      "Start / Order sorts by initiative; Roll NPCs rolls their initiative; Next turn advances and tracks the round.",
      "Undo turn steps back to the start of the previous turn.",
      "Conditions — toggle the 20 conditions per combatant; set a Duration (rounds) and it ticks down at the start of that creature's turn and clears itself.",
      "New combat clears NPCs, the board, damage, conditions and the round, keeping your PCs.",
    ],
  },
  {
    h: "Fog of war",
    items: [
      "Fog On/Off, then Reveal/Hide by dragging a box, or Room to flood-fill a whole area bounded by walls. Reveal all / Hide all reset everything.",
      "LoS fog auto-reveals what the party (all PC tokens) can see — their light and vision, blocked by walls. Reveals are kept as an explored map.",
      "View as player previews exactly what players see — no walls, hidden tokens, or unexplored areas.",
    ],
  },
  {
    h: "Walls, doors & secret doors",
    items: [
      "Wall — drag along grid lines to build walls; they block movement, light and sight.",
      "Door — click an edge to add a door, click it again to open/close it. Closed doors block everything; open doors let movement, light and sight through.",
      "Secret — a door that looks like a wall to players until you open it.",
      "Erase — click any wall or door to delete it (or double-click while the Wall/Door tool is active).",
    ],
  },
  {
    h: "Lighting & vision",
    items: [
      "Light On/Off shows wall-occluded illumination. Ambient sets the base level: dark, dim, or bright (daylight).",
      "+ Light drops an independent source; select it to set radius (5/15/20/30 ft) or a 60 ft Cone, its aim, and its Color. Lit areas flicker gently.",
      "Token light & vision — select a token to give it a light, Low-light vision (doubles light ranges for it), or Darkvision 60.",
      "Selecting a token shows the scene from ITS point of view: areas it can't see (lit rooms behind a wall) go dark and out-of-sight tokens hide. Click empty space for the full GM view.",
    ],
  },
  {
    h: "Movement & measuring",
    items: [
      "Range — select a token and toggle Range to see move / double / run tiers around walls; set its Speed in the panel.",
      "Measure — drag anywhere for a quick distance with no token.",
      "Reach — highlights threatened squares for the selected creature.",
    ],
  },
  {
    h: "Spell areas (AoE)",
    items: [
      "+ Burst / + Cone / + Line drop a template; drag its origin dot to position it.",
      "In the editor set size, aim, opacity and color, and an Effect: a preset (fire, water, mud, mist, ice, acid) or an uploaded image tiled across the area.",
    ],
  },
  {
    h: "Sharing & data",
    items: [
      "The header badge shows CLOUD (synced, multiplayer) or LOCAL (this browser only).",
      "Invite (cloud) shares the campaign link; Members manages player/GM roles.",
      "Export / Import backs up and restores the whole campaign as JSON, in any mode.",
      "Streaming — hide the toolbars from players by sharing only the map area, and use View as player to confirm what they'll see.",
    ],
  },
];

function SectionList({ sections }: { sections: Section[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {sections.map((s) => (
        <div key={s.h}>
          <h3 style={{ color: C.gold, fontSize: 14, margin: "0 0 6px", fontWeight: 800 }}>{s.h}</h3>
          <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 5 }}>
            {s.items.map((it, i) => {
              const dash = it.indexOf(" — ");
              const term = dash > -1 ? it.slice(0, dash) : null;
              const rest = dash > -1 ? it.slice(dash + 3) : it;
              return (
                <li key={i} style={{ fontSize: 13, lineHeight: 1.45, color: C.text }}>
                  {term && <strong style={{ color: C.text }}>{term}</strong>}
                  {term ? <span style={{ color: C.dim }}> — {rest}</span> : <span>{rest}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

export default function GuidePanel({ isGm, onClose }: { isGm: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<"player" | "gm">(isGm ? "gm" : "player");
  const tabBtn = (active: boolean): CSSProperties => ({
    background: active ? "rgba(212,175,55,0.18)" : C.row,
    border: `1px solid ${active ? C.gold : C.border}`, color: active ? C.gold : C.text,
    borderRadius: 6, padding: "6px 12px", fontSize: 13, fontWeight: 800, cursor: "pointer",
  });
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 24, overflow: "auto" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, maxWidth: 680, width: "100%", boxShadow: "0 16px 48px rgba(0,0,0,0.6)", overflow: "hidden" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: `1px solid ${C.border}` }}>
          <strong style={{ color: C.gold, fontSize: 15, flex: 1 }}>How to use Campaign Tracker</strong>
          <button style={tabBtn(tab === "player")} onClick={() => setTab("player")}>Player</button>
          <button style={tabBtn(tab === "gm")} onClick={() => setTab("gm")}>Game Master</button>
          <button onClick={onClose} title="Close" style={{ background: C.row, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, width: 28, height: 28, fontSize: 16, fontWeight: 800, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: 16, maxHeight: "72vh", overflow: "auto" }}>
          <SectionList sections={tab === "gm" ? GM : PLAYER} />
        </div>
      </div>
    </div>
  );
}
