// src/modules/combat/turnHistory.ts
//
// A small in-memory stack of combat snapshots so the GM can step back to the
// start of a previous turn. A snapshot captures the records that change during
// play — entities (damage/conditions/initiative), maps (token positions, AoE
// templates, background) and scenes (round / active turn). Assets are not
// snapshotted (images rarely change mid-turn) to keep snapshots small.
//
// History is in-memory only and intentionally bounded (MAX_HISTORY). It is
// cleared on "New combat" and "Reset to demo" so it never grows without limit.

import type { BaseRecord, Id } from "../../core/domain/domain";
import type { CollectionName, Repository } from "../../core/persistence/repository";

const COLLECTIONS: CollectionName[] = ["entities", "maps", "scenes"];
const MAX_HISTORY = 20;

type Snapshot = Partial<Record<CollectionName, BaseRecord[]>>;

let stack: Snapshot[] = [];

/** Number of snapshots currently available to undo. */
export function historyDepth(): number {
  return stack.length;
}

/** Drop all history (called on combat reset / reset to demo). */
export function clearHistory(): void {
  stack = [];
}

/** Capture the current combat state. Call at the start of every turn. */
export async function pushSnapshot(repo: Repository, campaignId: Id): Promise<void> {
  const snap: Snapshot = {};
  for (const c of COLLECTIONS) {
    snap[c] = await repo.list(c, { campaignId, includeDeleted: true });
  }
  stack.push(snap);
  if (stack.length > MAX_HISTORY) stack.shift();
}

/**
 * Restore the most recent snapshot and remove it from history.
 * Returns false if there was nothing to undo.
 *
 * Faithful restore: records created since the snapshot are removed, records
 * present in the snapshot are written back (which also un-deletes anything
 * deleted during the turn, since tombstones are captured too).
 */
export async function undoSnapshot(repo: Repository, campaignId: Id): Promise<boolean> {
  const snap = stack.pop();
  if (!snap) return false;
  for (const c of COLLECTIONS) {
    const saved = snap[c] ?? [];
    const savedIds = new Set(saved.map((r) => r.id));
    const current = await repo.list(c, { campaignId, includeDeleted: true });
    for (const r of current) {
      if (!savedIds.has(r.id)) await repo.remove(c, r.id);
    }
    for (const r of saved) {
      await repo.put(c, r);
    }
  }
  return true;
}
