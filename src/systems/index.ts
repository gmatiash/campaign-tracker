// src/systems/index.ts
// Registers every available rule system. Import this once at app startup; it is
// the single place that references concrete systems. Adding a new system here
// makes it resolvable via getRuleset(rulesetId) everywhere else.
import "./dnd35/dnd35";
// [future] import "./wod/wod";
// [future] import "./battletech/battletech";
// [future] import "./cyberpunk/cyberpunk";
