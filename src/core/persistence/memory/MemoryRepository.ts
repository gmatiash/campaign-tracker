// src/core/persistence/memory/MemoryRepository.ts
import type { BaseRecord, Id } from "../../domain/domain";
import type { CollectionName, Query, Repository, Unsubscribe } from "../repository";

interface Sub {
  query: Query;
  cb: (records: BaseRecord[]) => void;
}

/**
 * Non-persistent, reactive Repository for local development. Satisfies the full
 * interface (including realtime-style `subscribe`) so feature code is identical
 * to what it will use against IndexedDB/Supabase. Data resets on reload.
 */
export class MemoryRepository implements Repository {
  private store = new Map<CollectionName, Map<Id, BaseRecord>>();
  private subs = new Map<CollectionName, Set<Sub>>();

  private col(c: CollectionName): Map<Id, BaseRecord> {
    let m = this.store.get(c);
    if (!m) {
      m = new Map();
      this.store.set(c, m);
    }
    return m;
  }

  private query<T extends BaseRecord>(c: CollectionName, q: Query): T[] {
    const all = [...this.col(c).values()] as T[];
    return all.filter(
      (r) => r.campaignId === q.campaignId && (q.includeDeleted || !r.deletedAt)
    );
  }

  private notify(c: CollectionName): void {
    this.subs.get(c)?.forEach((s) => s.cb(this.query(c, s.query)));
  }

  async get<T extends BaseRecord = BaseRecord>(c: CollectionName, id: Id): Promise<T | null> {
    return (this.col(c).get(id) as T) ?? null;
  }

  async list<T extends BaseRecord = BaseRecord>(c: CollectionName, q: Query): Promise<T[]> {
    return this.query<T>(c, q);
  }

  async put<T extends BaseRecord = BaseRecord>(c: CollectionName, record: T): Promise<T> {
    const now = Date.now();
    const saved = {
      ...record,
      createdAt: record.createdAt ?? now,
      updatedAt: now,
      schemaVersion: record.schemaVersion ?? 1,
    } as T;
    this.col(c).set(saved.id, saved);
    this.notify(c);
    return saved;
  }

  async remove(c: CollectionName, id: Id): Promise<void> {
    const rec = this.col(c).get(id);
    if (rec) {
      rec.deletedAt = Date.now();
      rec.updatedAt = Date.now();
      this.notify(c);
    }
  }

  subscribe<T extends BaseRecord = BaseRecord>(
    c: CollectionName,
    q: Query,
    onChange: (records: T[]) => void
  ): Unsubscribe {
    const sub: Sub = { query: q, cb: onChange as (records: BaseRecord[]) => void };
    let set = this.subs.get(c);
    if (!set) {
      set = new Set();
      this.subs.set(c, set);
    }
    set.add(sub);
    onChange(this.query<T>(c, q)); // emit current state immediately
    return () => {
      set!.delete(sub);
    };
  }
}
