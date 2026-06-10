// src/core/persistence/io.ts
import type { BaseRecord, Id } from "../domain/domain";
import type { CollectionName, Repository } from "./repository";

const COLLECTIONS: CollectionName[] = ["campaigns", "entities", "scenes", "notes", "maps", "assets"];

export interface CampaignBackup {
  version: number;
  campaignId: Id;
  exportedAt: number;
  data: Partial<Record<CollectionName, BaseRecord[]>>;
}

/** Snapshot every collection for one campaign (including soft-deleted tombstones). */
export async function exportCampaign(repo: Repository, campaignId: Id): Promise<CampaignBackup> {
  const data: Partial<Record<CollectionName, BaseRecord[]>> = {};
  for (const c of COLLECTIONS) {
    data[c] = await repo.list(c, { campaignId, includeDeleted: true });
  }
  return { version: 1, campaignId, exportedAt: Date.now(), data };
}

/** Restore a backup. put() is last-write-wins by id, so this merges/overwrites. */
export async function importCampaign(repo: Repository, backup: CampaignBackup): Promise<void> {
  for (const c of COLLECTIONS) {
    for (const rec of backup.data[c] ?? []) {
      await repo.put(c, rec);
    }
  }
}

/** Trigger a browser download of a backup as a .json file. */
export function downloadBackup(backup: CampaignBackup, filename = "campaign-backup.json"): void {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
