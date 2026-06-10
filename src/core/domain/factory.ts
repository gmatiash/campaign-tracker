// src/core/domain/factory.ts
import type { Entity, Id } from "./domain";
import type { Ruleset } from "../ruleset/ruleset";

let counter = 0;
const newId = (): Id => `e-${Date.now().toString(36)}-${(counter++).toString(36)}`;

/**
 * Build a new Entity. Blank attributes come from the active ruleset, so this
 * stays system-agnostic (the combat module never hard-codes a stat shape).
 */
export function createEntity(opts: {
  campaignId: Id;
  ownerId: Id;
  ruleset: Ruleset;
  name: string;
  kind: "pc" | "npc";
  id?: Id;
  sizeId?: string;
  initiativeMod?: number;
}): Entity {
  const now = Date.now();
  return {
    collection: "entities",
    id: opts.id ?? newId(),
    campaignId: opts.campaignId,
    ownerId: opts.ownerId,
    visibility: { kind: "party" },
    createdAt: now,
    updatedAt: now,
    schemaVersion: 1,
    name: opts.name,
    kind: opts.kind,
    sizeId: opts.sizeId ?? "medium",
    attributes: { ...opts.ruleset.createBlankAttributes(), initiativeMod: opts.initiativeMod ?? 0 },
    conditions: [],
  };
}

/**
 * Duplicate an entity for "another one of these" workflows. Keeps static stats,
 * size, color and portrait, but resets per-encounter state (damage, rolled
 * initiative, conditions) and takes a fresh id/name.
 */
export function cloneEntity(src: Entity, name: string, id?: Id): Entity {
  const now = Date.now();
  return {
    ...src,
    id: id ?? newId(),
    name,
    createdAt: now,
    updatedAt: now,
    deletedAt: undefined,
    attributes: { ...src.attributes, damage: 0, initiative: 0 },
    conditions: [],
  };
}
