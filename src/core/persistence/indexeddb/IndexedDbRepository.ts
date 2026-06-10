// src/core/persistence/indexeddb/IndexedDbRepository.ts
import type { BaseRecord, Id } from "../../domain/domain";
import type { CollectionName, Query, Repository, Unsubscribe } from "../repository";

const DB_NAME = "campaign-tracker";
const DB_VERSION = 1;
const COLLECTIONS: CollectionName[] = ["campaigns", "entities", "scenes", "notes", "maps", "assets"];

interface Sub {
  query: Query;
  cb: (records: BaseRecord[]) => void;
}

/**
 * Local-first Repository backed by the browser's IndexedDB. Same interface as
 * MemoryRepository, so it is a drop-in swap. Data persists across reloads.
 *
 * Reactivity: IndexedDB has no native change feed, so writes notify in-process
 * subscribers directly, and a BroadcastChannel mirrors changes to other tabs of
 * the same origin (a stepping stone toward the Supabase Realtime impl in step 5,
 * which will additionally enforce per-user visibility via RLS).
 */
export class IndexedDbRepository implements Repository {
  private dbp: Promise<IDBDatabase>;
  private subs = new Map<CollectionName, Set<Sub>>();
  private channel: BroadcastChannel | null = null;

  constructor() {
    this.dbp = this.open();
    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(`${DB_NAME}-sync`);
      this.channel.onmessage = (ev: MessageEvent) => {
        const c = (ev.data as { collection?: CollectionName })?.collection;
        if (c) this.notifyLocal(c);
      };
    }
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const c of COLLECTIONS) {
          if (!db.objectStoreNames.contains(c)) {
            const store = db.createObjectStore(c, { keyPath: "id" });
            store.createIndex("campaignId", "campaignId", { unique: false });
          }
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async get<T extends BaseRecord = BaseRecord>(c: CollectionName, id: Id): Promise<T | null> {
    const db = await this.dbp;
    return new Promise((resolve, reject) => {
      const r = db.transaction(c, "readonly").objectStore(c).get(id);
      r.onsuccess = () => resolve((r.result as T) ?? null);
      r.onerror = () => reject(r.error);
    });
  }

  async list<T extends BaseRecord = BaseRecord>(c: CollectionName, q: Query): Promise<T[]> {
    const db = await this.dbp;
    return new Promise((resolve, reject) => {
      const idx = db.transaction(c, "readonly").objectStore(c).index("campaignId");
      const r = idx.getAll(IDBKeyRange.only(q.campaignId));
      r.onsuccess = () => {
        const all = (r.result as T[]) ?? [];
        resolve(all.filter((rec) => q.includeDeleted || !rec.deletedAt));
      };
      r.onerror = () => reject(r.error);
    });
  }

  async put<T extends BaseRecord = BaseRecord>(c: CollectionName, record: T): Promise<T> {
    const db = await this.dbp;
    const now = Date.now();
    const saved = {
      ...record,
      createdAt: record.createdAt ?? now,
      updatedAt: now,
      schemaVersion: record.schemaVersion ?? 1,
    } as T;
    await this.write(db, c, saved);
    this.notify(c);
    return saved;
  }

  async remove(c: CollectionName, id: Id): Promise<void> {
    const existing = await this.get(c, id);
    if (!existing) return;
    const tombstone = { ...existing, deletedAt: Date.now(), updatedAt: Date.now() };
    const db = await this.dbp;
    await this.write(db, c, tombstone);
    this.notify(c);
  }

  private write(db: IDBDatabase, c: CollectionName, value: BaseRecord): Promise<void> {
    return new Promise((resolve, reject) => {
      const t = db.transaction(c, "readwrite");
      t.objectStore(c).put(value);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
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
    void this.emit(c, sub); // emit current state asynchronously
    return () => { set!.delete(sub); };
  }

  private async emit(c: CollectionName, sub: Sub): Promise<void> {
    const records = await this.list(c, sub.query);
    if (this.subs.get(c)?.has(sub)) sub.cb(records); // skip if unsubscribed meanwhile
  }

  private notifyLocal(c: CollectionName): void {
    this.subs.get(c)?.forEach((s) => void this.emit(c, s));
  }

  private notify(c: CollectionName): void {
    this.notifyLocal(c);
    this.channel?.postMessage({ collection: c });
  }
}
