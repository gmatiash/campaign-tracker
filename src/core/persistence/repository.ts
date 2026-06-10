// src/core/persistence/repository.ts
import type { BaseRecord, Id } from "../domain/domain";

export type CollectionName =
  | "campaigns"
  | "entities"
  | "scenes"
  | "notes"
  | "maps"
  | "assets";

export interface Query {
  campaignId: Id;
  includeDeleted?: boolean;
}

export type Unsubscribe = () => void;

/**
 * The single seam between feature code and storage. Feature modules depend ONLY
 * on this interface — never on IndexedDB or Supabase directly. That is what makes
 * "local-first now, collaborative cloud later" a swap rather than a rewrite.
 *
 * Implementations:
 *   - MemoryRepository    — non-persistent, for tests / quick demos
 *   - IndexedDbRepository — native IndexedDB, local-first / offline    [step 4 ✓]
 *   - SupabaseRepository  — Postgres + Realtime + RLS                  [step 5]
 *
 * `subscribe` is how realtime collaboration surfaces. The Supabase impl emits
 * server changes filtered by RLS, so a player only receives records they may see
 * — this is how fog of war and GM secrets are enforced.
 */
export interface Repository {
  get<T extends BaseRecord = BaseRecord>(c: CollectionName, id: Id): Promise<T | null>;
  list<T extends BaseRecord = BaseRecord>(c: CollectionName, q: Query): Promise<T[]>;
  put<T extends BaseRecord = BaseRecord>(c: CollectionName, record: T): Promise<T>;
  remove(c: CollectionName, id: Id): Promise<void>;
  subscribe<T extends BaseRecord = BaseRecord>(
    c: CollectionName,
    q: Query,
    onChange: (records: T[]) => void
  ): Unsubscribe;
}

/** Auth seam (Supabase Auth later; a "local user" stub works offline today). */
export interface AuthProvider {
  currentUserId(): Id | null;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
}
