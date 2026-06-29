import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { TreeData } from '../types';
import { emptyTree, newId } from '../types';
import { validate } from '../model/queries';
import { sampleTree } from '../data/sample';
import {
  pingBackend,
  listTrees as remoteList,
  fetchTree as remoteGet,
  createTree as remoteCreate,
  putTree as remotePut,
  deleteTreeRemote as remoteDelete,
} from './backend';

/**
 * Persistence:
 *  - The local SQLite backend (server/) is the source of truth when reachable.
 *  - localStorage doubles as an offline cache and the "which tree is open" pref,
 *    so the app renders instantly and still works if the server is down.
 *  - On first connect to an empty DB, any existing localStorage trees are
 *    migrated into SQLite (nothing is lost), otherwise the sample is seeded.
 * Undo/redo history is per-session and resets when switching trees.
 */

const LEGACY_KEY = 'family-tree-data-v1';
const INDEX_KEY = 'family-tree-index-v1';
const HISTORY_LIMIT = 100;

export interface TreeMeta {
  id: string;
  name: string;
}

interface TreeIndex {
  trees: TreeMeta[];
  currentId: string;
}

/** Which store is authoritative this session. */
export type Backend = 'connecting' | 'sqlite' | 'local';

const treeKey = (id: string) => (id === 'default' ? LEGACY_KEY : `${LEGACY_KEY}:${id}`);

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn(`Could not persist ${key}:`, e);
  }
}

function loadTreeData(id: string): TreeData | null {
  const data = readJson<TreeData>(treeKey(id));
  if (!data || !data.persons || !data.unions) return null;
  const problems = validate(data);
  if (problems.length) console.warn(`Tree ${id} has consistency issues:`, problems);
  return data;
}

function loadIndex(): TreeIndex {
  const idx = readJson<TreeIndex>(INDEX_KEY);
  if (idx && Array.isArray(idx.trees) && idx.trees.length > 0) {
    if (!idx.trees.some((t) => t.id === idx.currentId)) idx.currentId = idx.trees[0].id;
    return idx;
  }
  // first run: adopt the legacy single tree, else start with the sample
  const legacy = loadTreeData('default');
  const data = legacy ?? sampleTree();
  if (!legacy) writeJson(treeKey('default'), data);
  const fresh: TreeIndex = {
    trees: [{ id: 'default', name: data.name }],
    currentId: 'default',
  };
  writeJson(INDEX_KEY, fresh);
  return fresh;
}

// --- history reducer ---------------------------------------------------------

interface HistoryState {
  past: TreeData[];
  present: TreeData;
  future: TreeData[];
}

type Action =
  | { type: 'apply'; data: TreeData } // undoable edit
  | { type: 'transient'; data: TreeData } // not undoable (focus change)
  | { type: 'replace'; data: TreeData } // import / switch tree, clears history
  | { type: 'undo' }
  | { type: 'redo' };

function reducer(state: HistoryState, action: Action): HistoryState {
  switch (action.type) {
    case 'apply':
      if (action.data === state.present) return state;
      return {
        past: [...state.past.slice(-HISTORY_LIMIT), state.present],
        present: action.data,
        future: [],
      };
    case 'transient':
      if (action.data === state.present) return state;
      return { ...state, present: action.data };
    case 'replace':
      return { past: [], present: action.data, future: [] };
    case 'undo': {
      const prev = state.past[state.past.length - 1];
      if (!prev) return state;
      return {
        past: state.past.slice(0, -1),
        present: prev,
        future: [state.present, ...state.future],
      };
    }
    case 'redo': {
      const next = state.future[0];
      if (!next) return state;
      return {
        past: [...state.past, state.present],
        present: next,
        future: state.future.slice(1),
      };
    }
  }
}

// --- public hook ---------------------------------------------------------------

export interface TreeStore {
  data: TreeData;
  trees: TreeMeta[];
  currentTreeId: string;
  canUndo: boolean;
  canRedo: boolean;
  /** Where data is being stored this session. */
  backend: Backend;
  /** True while a save to the DB is in flight. */
  saving: boolean;
  /** Set when the DB is unreachable / a save failed (else null). */
  dbError: string | null;
  /** Apply an undoable edit. */
  apply: (next: TreeData) => void;
  /** Apply a non-undoable change (e.g. focus navigation). */
  applyTransient: (next: TreeData) => void;
  /** Replace the current tree's content (import); clears history. */
  replace: (next: TreeData) => void;
  undo: () => void;
  redo: () => void;
  switchTree: (id: string) => void;
  /** Create a new tree (empty or with given data) and switch to it. */
  createTree: (data?: TreeData) => void;
  /** Delete a tree; switches away if it is the current one. */
  deleteTree: (id: string) => void;
}

const OFFLINE_MSG =
  'Veritabanı sunucusu kapalı — değişiklikler şimdilik tarayıcıda saklanıyor. Kalıcı kayıt için: npm run server';

export function useTreeStore(): TreeStore {
  const [index, setIndex] = useState<TreeIndex>(loadIndex);
  const [state, dispatch] = useReducer(
    reducer,
    undefined,
    (): HistoryState => ({
      past: [],
      present: loadTreeData(loadIndex().currentId) ?? sampleTree(),
      future: [],
    }),
  );
  const [backend, setBackend] = useState<Backend>('connecting');
  const [saving, setSaving] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);

  // latest values, readable from the stable callbacks below
  const presentRef = useRef(state.present);
  presentRef.current = state.present;
  const indexRef = useRef(index);
  indexRef.current = index;
  const backendRef = useRef(backend);
  const readyRef = useRef(false); // gate persistence until initial hydrate settles

  // keep backendRef current (effect-synced; it only changes once after connect)
  useEffect(() => {
    backendRef.current = backend;
  }, [backend]);

  // one-time hydrate from the SQLite backend (or fall back to localStorage)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const up = await pingBackend();
      if (cancelled) return;
      if (!up) {
        setBackend('local');
        setDbError(OFFLINE_MSG);
        readyRef.current = true;
        return;
      }
      try {
        let serverTrees = await remoteList();
        if (serverTrees.length === 0) {
          // empty DB: migrate existing localStorage trees, else seed the sample
          const local = loadIndex();
          const migratable = local.trees
            .map((t) => ({ meta: t, data: loadTreeData(t.id) }))
            .filter((x) => x.data && Object.keys(x.data.persons).length > 0) as {
            meta: TreeMeta;
            data: TreeData;
          }[];
          const created: TreeMeta[] = [];
          let currentId = '';
          if (migratable.length === 0) {
            const s = sampleTree();
            const id = await remoteCreate(s);
            created.push({ id, name: s.name });
            currentId = id;
          } else {
            for (const m of migratable) {
              const id = await remoteCreate(m.data);
              created.push({ id, name: m.data.name });
              if (m.meta.id === local.currentId) currentId = id;
            }
            if (!currentId) currentId = created[0].id;
          }
          serverTrees = created;
          writeJson(INDEX_KEY, { trees: created, currentId });
          setIndex({ trees: created, currentId });
        }

        const cachedCurrent = loadIndex().currentId;
        const currentId = serverTrees.some((t) => t.id === cachedCurrent)
          ? cachedCurrent
          : serverTrees[0].id;
        const data = await remoteGet(currentId);
        if (cancelled) return;
        writeJson(treeKey(currentId), data);
        writeJson(INDEX_KEY, { trees: serverTrees, currentId });
        setIndex({ trees: serverTrees, currentId });
        dispatch({ type: 'replace', data });
        setBackend('sqlite');
        setDbError(null);
      } catch (e) {
        if (cancelled) return;
        setBackend('local');
        setDbError('Veritabanına bağlanılamadı — tarayıcı belleği kullanılıyor.');
        console.warn('DB hydrate failed:', e);
      } finally {
        readyRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // persist current tree (debounced): localStorage cache + DB when online
  useEffect(() => {
    if (!readyRef.current) return;
    const id = index.currentId;
    const data = state.present;
    const t = setTimeout(() => {
      writeJson(treeKey(id), data);
      setIndex((idx) => {
        const entry = idx.trees.find((x) => x.id === idx.currentId);
        if (entry && entry.name !== data.name) {
          return {
            ...idx,
            trees: idx.trees.map((x) =>
              x.id === idx.currentId ? { ...x, name: data.name } : x,
            ),
          };
        }
        return idx;
      });
      if (backendRef.current === 'sqlite') {
        setSaving(true);
        remotePut(id, data)
          .then(() => setDbError(null))
          .catch((e) => {
            setDbError('Kaydetme başarısız — sunucu kapalı olabilir.');
            console.warn('DB save failed:', e);
          })
          .finally(() => setSaving(false));
      }
    }, 350);
    return () => clearTimeout(t);
  }, [state.present, index.currentId]);

  useEffect(() => {
    writeJson(INDEX_KEY, index);
  }, [index]);

  const apply = useCallback((next: TreeData) => dispatch({ type: 'apply', data: next }), []);
  const applyTransient = useCallback(
    (next: TreeData) => dispatch({ type: 'transient', data: next }),
    [],
  );
  const replace = useCallback((next: TreeData) => dispatch({ type: 'replace', data: next }), []);
  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);

  const switchTree = useCallback((id: string) => {
    const idx = indexRef.current;
    if (!idx.trees.some((t) => t.id === id) || idx.currentId === id) return;
    // save the outgoing tree immediately (the debounce may not have fired)
    writeJson(treeKey(idx.currentId), presentRef.current);
    if (backendRef.current === 'sqlite') {
      remotePut(idx.currentId, presentRef.current).catch((e) => console.warn(e));
      remoteGet(id)
        .then((data) => {
          writeJson(treeKey(id), data);
          dispatch({ type: 'replace', data });
          setIndex({ ...indexRef.current, currentId: id });
        })
        .catch((e) => {
          setDbError('Ağaç yüklenemedi.');
          console.warn(e);
        });
    } else {
      dispatch({ type: 'replace', data: loadTreeData(id) ?? emptyTree() });
      setIndex({ ...idx, currentId: id });
    }
  }, []);

  const createTree = useCallback((data?: TreeData) => {
    const idx = indexRef.current;
    const tree = data ?? emptyTree('New Tree');
    if (backendRef.current === 'sqlite') {
      remotePut(idx.currentId, presentRef.current).catch((e) => console.warn(e));
      remoteCreate(tree)
        .then((id) => {
          writeJson(treeKey(id), tree);
          dispatch({ type: 'replace', data: tree });
          setIndex({
            trees: [...indexRef.current.trees, { id, name: tree.name }],
            currentId: id,
          });
        })
        .catch((e) => {
          setDbError('Ağaç oluşturulamadı.');
          console.warn(e);
        });
    } else {
      const id = newId('T');
      writeJson(treeKey(idx.currentId), presentRef.current);
      writeJson(treeKey(id), tree);
      dispatch({ type: 'replace', data: tree });
      setIndex({ trees: [...idx.trees, { id, name: tree.name }], currentId: id });
    }
  }, []);

  const deleteTree = useCallback((id: string) => {
    const idx = indexRef.current;
    if (!idx.trees.some((t) => t.id === id)) return;
    const sqlite = backendRef.current === 'sqlite';
    if (sqlite) remoteDelete(id).catch((e) => console.warn('DB delete failed:', e));
    try {
      localStorage.removeItem(treeKey(id));
    } catch {
      /* non-fatal */
    }
    const trees = idx.trees.filter((t) => t.id !== id);

    if (idx.currentId !== id) {
      setIndex({ trees, currentId: idx.currentId });
      return;
    }
    // deleting the open tree → switch to another, or start fresh
    if (trees.length === 0) {
      const fresh = emptyTree();
      if (sqlite) {
        remoteCreate(fresh)
          .then((freshId) => {
            writeJson(treeKey(freshId), fresh);
            dispatch({ type: 'replace', data: fresh });
            setIndex({ trees: [{ id: freshId, name: fresh.name }], currentId: freshId });
          })
          .catch((e) => console.warn(e));
      } else {
        const freshId = newId('T');
        writeJson(treeKey(freshId), fresh);
        dispatch({ type: 'replace', data: fresh });
        setIndex({ trees: [{ id: freshId, name: fresh.name }], currentId: freshId });
      }
      return;
    }
    const currentId = trees[0].id;
    if (sqlite) {
      remoteGet(currentId)
        .then((data) => {
          writeJson(treeKey(currentId), data);
          dispatch({ type: 'replace', data });
          setIndex({ trees, currentId });
        })
        .catch((e) => console.warn(e));
    } else {
      dispatch({ type: 'replace', data: loadTreeData(currentId) ?? emptyTree() });
      setIndex({ trees, currentId });
    }
  }, []);

  return useMemo(
    () => ({
      data: state.present,
      trees: index.trees,
      currentTreeId: index.currentId,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
      backend,
      saving,
      dbError,
      apply,
      applyTransient,
      replace,
      undo,
      redo,
      switchTree,
      createTree,
      deleteTree,
    }),
    [
      state,
      index,
      backend,
      saving,
      dbError,
      apply,
      applyTransient,
      replace,
      undo,
      redo,
      switchTree,
      createTree,
      deleteTree,
    ],
  );
}
