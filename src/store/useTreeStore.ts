import { useCallback, useEffect, useMemo, useReducer } from 'react';
import type { TreeData } from '../types';
import { emptyTree } from '../types';
import { validate } from '../model/queries';
import { sampleTree } from '../data/sample';

const STORAGE_KEY = 'family-tree-data-v1';
const HISTORY_LIMIT = 100;

interface HistoryState {
  past: TreeData[];
  present: TreeData;
  future: TreeData[];
}

type Action =
  | { type: 'apply'; data: TreeData } // undoable edit
  | { type: 'transient'; data: TreeData } // not undoable (focus change)
  | { type: 'replace'; data: TreeData } // import / new tree, clears history
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

function loadInitial(): TreeData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw) as TreeData;
      if (data && data.persons && data.unions && validate(data).length === 0) return data;
      if (data && data.persons && data.unions) {
        console.warn('Stored tree failed validation, loading anyway:', validate(data));
        return data;
      }
    }
  } catch {
    // corrupted storage -> fall through to sample
  }
  return sampleTree();
}

export interface TreeStore {
  data: TreeData;
  canUndo: boolean;
  canRedo: boolean;
  /** Apply an undoable edit. */
  apply: (next: TreeData) => void;
  /** Apply a non-undoable change (e.g. focus navigation). */
  applyTransient: (next: TreeData) => void;
  /** Replace everything (import / new tree); clears history. */
  replace: (next: TreeData) => void;
  undo: () => void;
  redo: () => void;
}

export function useTreeStore(): TreeStore {
  const [state, dispatch] = useReducer(
    reducer,
    undefined,
    (): HistoryState => ({ past: [], present: loadInitial(), future: [] }),
  );

  // persist (lightly debounced)
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state.present));
      } catch (e) {
        console.warn('Could not persist tree:', e);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [state.present]);

  const apply = useCallback((next: TreeData) => dispatch({ type: 'apply', data: next }), []);
  const applyTransient = useCallback(
    (next: TreeData) => dispatch({ type: 'transient', data: next }),
    [],
  );
  const replace = useCallback((next: TreeData) => dispatch({ type: 'replace', data: next }), []);
  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);

  return useMemo(
    () => ({
      data: state.present,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
      apply,
      applyTransient,
      replace,
      undo,
      redo,
    }),
    [state, apply, applyTransient, replace, undo, redo],
  );
}

export function blankTree(name?: string): TreeData {
  return emptyTree(name);
}
