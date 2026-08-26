/**
 * IndexedDB blob store for imported assets (splat scans, GLB models,
 * custom floor/wall textures) so scenes survive reloads: bytes live here
 * keyed by entry id; entry metadata persists in localStorage via the
 * zustand store; rehydration re-imports each blob at boot (see
 * rehydrateAssets.ts; textures re-apply via the environment sync).
 */

const DB_NAME = 'sds-pc-assets';
// v2 adds the custom floor/wall texture store.
const DB_VERSION = 2;
export const SPLAT_STORE = 'splats';
export const MODEL_STORE = 'models';
/** Custom floor/wall textures, keyed by fixed slot ('floor' | 'wall')
 * rather than random uuid — replacing one is just a write to its slot. */
export const TEXTURE_STORE = 'textures';

export type TextureKind = 'floor' | 'wall';

type StoreName = typeof SPLAT_STORE | typeof MODEL_STORE | typeof TEXTURE_STORE;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SPLAT_STORE)) db.createObjectStore(SPLAT_STORE);
      if (!db.objectStoreNames.contains(MODEL_STORE)) db.createObjectStore(MODEL_STORE);
      if (!db.objectStoreNames.contains(TEXTURE_STORE))
        db.createObjectStore(TEXTURE_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
  return dbPromise;
}

function tx(
  db: IDBDatabase,
  store: string,
  mode: IDBTransactionMode
): IDBObjectStore {
  return db.transaction(store, mode).objectStore(store);
}

export async function putAssetBlob(
  store: StoreName,
  id: string,
  blob: Blob
): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const req = tx(db, store, 'readwrite').put(blob, id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('IndexedDB put failed'));
  });
}

export async function getAssetBlob(
  store: StoreName,
  id: string
): Promise<Blob | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = tx(db, store, 'readonly').get(id);
    req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB get failed'));
  });
}

export async function deleteAssetBlob(
  store: StoreName,
  id: string
): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const req = tx(db, store, 'readwrite').delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('IndexedDB delete failed'));
  });
}
