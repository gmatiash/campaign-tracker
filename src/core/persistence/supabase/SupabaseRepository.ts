// src/core/persistence/supabase/SupabaseRepository.ts
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { BaseRecord, Id } from "../../domain/domain";
import type { CollectionName, Query, Repository, Unsubscribe } from "../repository";

const TABLE = "records";

/**
 * Cloud Repository backed by Supabase (Postgres + Realtime + RLS).
 *
 * Storage model: one `records` table holding each document in a `doc` JSONB
 * column, with a few promoted columns (id, collection, campaign_id, owner_id,
 * visibility, deleted_at) used for indexing and Row-Level Security. RLS — not
 * this client — is what enforces who may read/write, including GM-only secrecy.
 *
 * Same interface as MemoryRepository / IndexedDbRepository, so it is a drop-in
 * swap. Realtime: a Postgres-changes channel per subscription re-reads through
 * RLS on any change in the campaign and re-emits (simple and correct at hobby
 * scale; the re-read guarantees players never receive rows RLS would hide).
 */
export class SupabaseRepository implements Repository {
  constructor(private sb: SupabaseClient) {}

  async get<T extends BaseRecord = BaseRecord>(c: CollectionName, id: Id): Promise<T | null> {
    const { data, error } = await this.sb
      .from(TABLE).select("doc").eq("id", id).eq("collection", c).maybeSingle();
    if (error) throw error;
    return (data?.doc as T) ?? null;
  }

  async list<T extends BaseRecord = BaseRecord>(c: CollectionName, q: Query): Promise<T[]> {
    let query = this.sb.from(TABLE).select("doc").eq("collection", c).eq("campaign_id", q.campaignId);
    if (!q.includeDeleted) query = query.is("deleted_at", null);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map((r) => (r as { doc: T }).doc);
  }

  async put<T extends BaseRecord = BaseRecord>(c: CollectionName, record: T): Promise<T> {
    const now = Date.now();
    const saved = {
      ...record, collection: c,
      createdAt: record.createdAt ?? now, updatedAt: now,
      schemaVersion: record.schemaVersion ?? 1,
    } as T;
    const row = {
      id: saved.id, collection: c, campaign_id: saved.campaignId, owner_id: saved.ownerId,
      visibility: saved.visibility, deleted_at: saved.deletedAt ?? null,
      updated_at: saved.updatedAt, schema_version: saved.schemaVersion, doc: saved,
    };
    const { error } = await this.sb.from(TABLE).upsert(row);
    if (error) throw error;
    return saved;
  }

  async remove(c: CollectionName, id: Id): Promise<void> {
    const existing = await this.get(c, id);
    if (!existing) return;
    await this.put(c, { ...existing, deletedAt: Date.now() });
  }

  subscribe<T extends BaseRecord = BaseRecord>(
    c: CollectionName,
    q: Query,
    onChange: (records: T[]) => void
  ): Unsubscribe {
    let active = true;
    const emit = () => {
      this.list<T>(c, q)
        .then((rows) => { if (active) onChange(rows); })
        .catch((err) => console.error("[SupabaseRepository] list failed", err));
    };
    emit(); // initial state

    const channel: RealtimeChannel = this.sb
      .channel(`records-${c}-${q.campaignId}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: TABLE, filter: `campaign_id=eq.${q.campaignId}` },
        (payload) => {
          const coll =
            (payload.new as { collection?: string } | null)?.collection ??
            (payload.old as { collection?: string } | null)?.collection;
          if (!coll || coll === c) emit();
        }
      )
      .subscribe();

    return () => { active = false; void this.sb.removeChannel(channel); };
  }
}
