import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { TreeData } from '../types';
import { emptyTree, newId } from '../types';
import { validate } from '../model/queries';
import { sampleTree } from '../data/sample';

/**
 * Multi-tree persistence:
 *  - 'family-tree-index-v1' lists all trees and the current one.
 *  - Each tree lives under 'family-tree-data-v1:<id>'. The pre-multi-tree
 *    single tree key 'family-tree-data-v1' doubles as the storage of the
 *    'default' tree, so older data is picked up without migration.
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
  // latest values, readable from the stable callbacks below
  const presentRef = useRef(state.present);
  presentRef.current = state.present;
  const indexRef = useRef(index);
  indexRef.current = index;

  // persist current tree (lightly debounced) + keep index name in sync
  useEffect(() => {
    const t = setTimeout(() => {
      writeJson(treeKey(index.currentId), state.present);
      setIndex((idx) => {
        const entry = idx.trees.find((x) => x.id === idx.currentId);
        if (entry && entry.name !== state.present.name) {
          const next = {
            ...idx,
            trees: idx.trees.map((x) =>
              x.id === idx.currentId ? { ...x, name: state.present.name } : x,
            ),
          };
          return next;
        }
        return idx;
      });
    }, 250);
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
    dispatch({ type: 'replace', data: loadTreeData(id) ?? emptyTree() });
    setIndex({ ...idx, currentId: id });
  }, []);

  const createTree = useCallback((data?: TreeData) => {
    const idx = indexRef.current;
    const tree = data ?? emptyTree('New Tree');
    const id = newId('T');
    writeJson(treeKey(idx.currentId), presentRef.current);
    writeJson(treeKey(id), tree);
    dispatch({ type: 'replace', data: tree });
    setIndex({ trees: [...idx.trees, { id, name: tree.name }], currentId: id });
  }, []);

  const deleteTree = useCallback((id: string) => {
    const idx = indexRef.current;
    if (!idx.trees.some((t) => t.id === id)) return;
    try {
      localStorage.removeItem(treeKey(id));
    } catch {
      /* non-fatal */
    }
    let trees = idx.trees.filter((t) => t.id !== id);
    let currentId = idx.currentId;
    if (currentId === id) {
      if (trees.length === 0) {
        const fresh = emptyTree();
        const freshId = newId('T');
        writeJson(treeKey(freshId), fresh);
        trees = [{ id: freshId, name: fresh.name }];
        currentId = freshId;
        dispatch({ type: 'replace', data: fresh });
      } else {
        currentId = trees[0].id;
        dispatch({ type: 'replace', data: loadTreeData(currentId) ?? emptyTree() });
      }
    }
    setIndex({ trees, currentId });
  }, []);

  return useMemo(
    () => ({
      data: state.present,
      trees: index.trees,
      currentTreeId: index.currentId,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
      apply,
      applyTransient,
      replace,
      undo,
      redo,
      switchTree,
      createTree,
      deleteTree,
    }),
    [state, index, apply, applyTransient, replace, undo, redo, switchTree, createTree, deleteTree],
  );
}
