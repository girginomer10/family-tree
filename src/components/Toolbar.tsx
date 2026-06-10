import { useEffect, useRef, useState } from 'react';
import type { TreeData } from '../types';
import { fullName, lifespan } from '../types';
import { searchPersons } from '../model/queries';

interface Props {
  data: TreeData;
  canUndo: boolean;
  canRedo: boolean;
  ancestorDepth: number;
  descendantDepth: number;
  onUndo: () => void;
  onRedo: () => void;
  onRenameTree: (name: string) => void;
  onPickPerson: (id: string) => void;
  onDepthChange: (which: 'anc' | 'desc', value: number) => void;
  onNewTree: () => void;
  onLoadSample: () => void;
  onImportFile: (file: File) => void;
  onExportJson: () => void;
  onExportGedcom: () => void;
  onExportSvg: () => void;
}

const DEPTHS = [1, 2, 3, 4, 5, 99];
const depthLabel = (n: number) => (n === 99 ? 'All' : String(n));

export function Toolbar(props: Props) {
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const results = searchPersons(props.data, query);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setConfirmNew(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const pick = (id: string) => {
    props.onPickPerson(id);
    setQuery('');
    setSearchOpen(false);
  };

  return (
    <header className="toolbar">
      <div className="toolbar-left">
        <span className="logo">🌳</span>
        <input
          className="tree-name"
          value={props.data.name}
          onChange={(e) => props.onRenameTree(e.target.value)}
          title="Tree name"
        />
        <span className="person-count">{Object.keys(props.data.persons).length} people</span>
      </div>

      <div className="toolbar-search">
        <input
          type="text"
          placeholder="Search people…  (press / )"
          value={query}
          data-search-input
          onChange={(e) => {
            setQuery(e.target.value);
            setSearchOpen(true);
          }}
          onFocus={() => setSearchOpen(true)}
          onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results[0]) pick(results[0].id);
            if (e.key === 'Escape') {
              setQuery('');
              setSearchOpen(false);
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        {searchOpen && query.trim() && (
          <ul className="search-results">
            {results.map((p) => (
              <li key={p.id}>
                <button onMouseDown={(e) => e.preventDefault()} onClick={() => pick(p.id)}>
                  <strong>{fullName(p)}</strong>
                  <span>{lifespan(p)}</span>
                </button>
              </li>
            ))}
            {results.length === 0 && <li className="empty">No matches</li>}
          </ul>
        )}
      </div>

      <div className="toolbar-right">
        <label className="depth-select" title="Ancestor generations shown">
          ↑
          <select
            value={props.ancestorDepth}
            onChange={(e) => props.onDepthChange('anc', parseInt(e.target.value, 10))}
          >
            {DEPTHS.map((d) => (
              <option key={d} value={d}>
                {depthLabel(d)}
              </option>
            ))}
          </select>
        </label>
        <label className="depth-select" title="Descendant generations shown">
          ↓
          <select
            value={props.descendantDepth}
            onChange={(e) => props.onDepthChange('desc', parseInt(e.target.value, 10))}
          >
            {DEPTHS.map((d) => (
              <option key={d} value={d}>
                {depthLabel(d)}
              </option>
            ))}
          </select>
        </label>

        <span className="divider" />

        <button
          className="icon-btn"
          title="Undo (⌘Z)"
          disabled={!props.canUndo}
          onClick={props.onUndo}
        >
          ↩
        </button>
        <button
          className="icon-btn"
          title="Redo (⇧⌘Z)"
          disabled={!props.canRedo}
          onClick={props.onRedo}
        >
          ↪
        </button>

        <span className="divider" />

        <div className="menu" ref={menuRef}>
          <button className="btn small" onClick={() => setMenuOpen((o) => !o)}>
            File ▾
          </button>
          {menuOpen && (
            <div className="menu-list">
              <button
                className={confirmNew ? 'danger-item' : ''}
                onClick={() => {
                  if (confirmNew) {
                    setConfirmNew(false);
                    setMenuOpen(false);
                    props.onNewTree();
                  } else {
                    setConfirmNew(true);
                  }
                }}
              >
                {confirmNew ? 'Erase current tree?' : 'New empty tree'}
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  props.onLoadSample();
                }}
              >
                Load sample family
              </button>
              <hr />
              <button
                onClick={() => {
                  setMenuOpen(false);
                  fileRef.current?.click();
                }}
              >
                Import JSON / GEDCOM…
              </button>
              <hr />
              <button
                onClick={() => {
                  setMenuOpen(false);
                  props.onExportJson();
                }}
              >
                Export JSON
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  props.onExportGedcom();
                }}
              >
                Export GEDCOM (.ged)
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  props.onExportSvg();
                }}
              >
                Export chart as SVG
              </button>
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".json,.ged,.gedcom,application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) props.onImportFile(f);
              e.target.value = '';
            }}
          />
        </div>
      </div>
    </header>
  );
}
