// src/core/domain/domain.ts
// Rules-agnostic domain models. Nothing here knows about any specific game system.
import type { DistanceUnit } from "../units";

/** Stable unique id (UUID string in production). */
export type Id = string;

/**
 * Visibility drives fog-of-war and GM secrets. It is enforced SERVER-SIDE by
 * Supabase Row-Level Security once collaboration lands — never trust the client
 * to hide data it already received.
 */
export type Visibility =
  | { kind: "party" }
  | { kind: "gmOnly" }
  | { kind: "players"; userIds: Id[] };

/**
 * Every persisted record carries these fields from day one so that sync,
 * authorization and conflict-ordering work without a later migration.
 */
export interface BaseRecord {
  id: Id;
  campaignId: Id;
  ownerId: Id;
  visibility: Visibility;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number; // soft delete (needed for reliable sync)
  schemaVersion: number;
}

export type CampaignRole = "gm" | "player";

export interface CampaignMember {
  userId: Id;
  role: CampaignRole;
  displayName: string;
}

/** Per-campaign settings (display preferences, etc.). */
export interface CampaignSettings {
  distanceUnit?: DistanceUnit; // [future] ft <-> m unit switch; defaults to "ft"
}

export interface Campaign extends BaseRecord {
  collection: "campaigns";
  name: string;
  rulesetId: string; // which Ruleset plugin this campaign uses, e.g. "dnd35"
  members: CampaignMember[];
  settings?: CampaignSettings;
}

/**
 * Any actor: player character, NPC, monster, vehicle, mech. System-specific data
 * lives in `attributes`, shaped by the active ruleset's character schema.
 */
export interface Entity extends BaseRecord {
  collection: "entities";
  name: string;
  kind: "pc" | "npc";
  sizeId?: string; // references a Ruleset SizeDef.id
  portraitAssetId?: Id;
  color?: string;
  attributes: Record<string, unknown>;
  conditions: string[]; // references Ruleset ConditionDef.id
  notes?: string;
}

export interface Scene extends BaseRecord {
  collection: "scenes";
  name: string;
  mapId?: Id;
  participantEntityIds: Id[];
  round: number;
  activeEntityId?: Id;
}

export interface Note extends BaseRecord {
  collection: "notes";
  title: string;
  body: string;
  tags: string[];
}
