import { useEffect, useRef, useState } from 'react';
import type { TreeData } from '../types';
import { fullName, lifespan } from '../types';
import { searchPersons } from '../model/queries';
import type { TreeMeta } from '../store/useTreeStore';

export type ViewMode = 'hourglass' | 'pedigree' | 'descendants' | 'fan' | 'timeline';

interface Props {
  data: TreeData;
  trees: TreeMeta[];
  currentTreeId: string;
  canUndo: boolean;
  canRedo: boolean;
  ancestorDepth: number;
  descendantDepth: number;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onUndo: () => void;
  onRedo: () => void;
  onRenameTree: (name: string) => void;
  onPickPerson: (id: string) => void;
  onDepthChange: (which: 'anc' | 'desc', value: number) => void;
  onOpenRelationship: () => void;
  onOpenStats: () => void;
  onSwitchTree: (id: string) => void;
  onNewTree: () => void;
  onDeleteTree: (id: string) => void;
  onLoadSample: () => void;
  onImportFile: (file: File) => void;
  onExportJson: () => void;
  onExportGedcom: () => void;
  onExportSvg: () => void;
  onExportPng: () => void;
}

const DEPTHS = [1, 2, 3, 4, 5, 99];
const depthLabel = (n: number) => (n === 99 ? 'All' : String(n));

const VIEW_MODES: { id: ViewMode; icon: string; label: string }[] = [
  { id: 'hourglass', icon: '⧖', label: 'Hourglass — ancestors & descendants' },
  { id: 'pedigree', icon: '△', label: 'Pedigree — ancestors only' },
  { id: 'descendants', icon: '▽', label: 'Descendants only' },
  { id: 'fan', icon: '◖', label: 'Fan chart — ancestors' },
  { id: 'timeline', icon: '☰', label: 'Timeline — lifespans over the years' },
];

export function Toolbar(props: Props) {
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [treeMenuOpen, setTreeMenuOpen] = useState(false);
  const [confirmDeleteTree, setConfirmDeleteTree] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const treeMenuRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const results = searchPersons(props.data, query);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
      if (treeMenuRef.current && !treeMenuRef.current.contains(e.target as Node)) {
        setTreeMenuOpen(false);
        setConfirmDeleteTree(false);
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
        <div className="menu" ref={treeMenuRef}>
          <button
            className="icon-btn"
            title="Switch / manage trees"
            onClick={() => setTreeMenuOpen((o) => !o)}
          >
            ▾
          </button>
          {treeMenuOpen && (
            <div className="menu-list tree-menu">
              {props.trees.map((t) => (
                <button
                  key={t.id}
                  className={t.id === props.currentTreeId ? 'current-tree' : ''}
                  onClick={() => {
                    setTreeMenuOpen(false);
                    props.onSwitchTree(t.id);
                  }}
                >
                  {t.id === props.currentTreeId ? '● ' : '○ '}
                  {t.name || 'Untitled'}
                </button>
              ))}
              <hr />
              <button
                onClick={() => {
                  setTreeMenuOpen(false);
                  props.onNewTree();
                }}
              >
                + New tree
              </button>
              <button
                className={confirmDeleteTree ? 'danger-item' : ''}
                onClick={() => {
                  if (confirmDeleteTree) {
                    setConfirmDeleteTree(false);
                    setTreeMenuOpen(false);
                    props.onDeleteTree(props.currentTreeId);
                  } else {
                    setConfirmDeleteTree(true);
                  }
                }}
              >
                {confirmDeleteTree ? 'Really delete this tree?' : 'Delete current tree'}
              </button>
            </div>
          )}
        </div>
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
        <div className="view-switch" role="group" aria-label="Chart view">
          {VIEW_MODES.map((m) => (
            <button
              key={m.id}
              className={props.viewMode === m.id ? 'active' : ''}
              title={m.label}
              onClick={() => props.onViewModeChange(m.id)}
            >
              {m.icon}
            </button>
          ))}
        </div>

        <span className="divider" />

        {props.viewMode !== 'descendants' && props.viewMode !== 'timeline' && (
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
        )}
        {(props.viewMode === 'hourglass' || props.viewMode === 'descendants') && (
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
        )}

        <button
          className="icon-btn"
          title="Relationship calculator"
          onClick={props.onOpenRelationship}
        >
          ⇄
        </button>
        <button className="icon-btn" title="Tree statistics" onClick={props.onOpenStats}>
          ◫
        </button>

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
                onClick={() => {
                  setMenuOpen(false);
                  props.onNewTree();
                }}
              >
                New tree
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
              <button
                onClick={() => {
                  setMenuOpen(false);
                  props.onExportPng();
                }}
              >
                Export chart as PNG
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
