import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TreeData, Union } from './types';
import { emptyTree, fullName } from './types';
import { useTreeStore } from './store/useTreeStore';
import { computeLayout } from './layout/layout';
import * as M from './model/mutations';
import { getUnionsOf, validate } from './model/queries';
import { sampleTree } from './data/sample';
import { exportGedcom, importGedcom } from './gedcom/gedcom';
import { downloadBlob, downloadText, exportSvg, readFileAsText, svgToPng } from './utils/files';
import { Toolbar, type ViewMode } from './components/Toolbar';
import { TreeCanvas, type TreeCanvasHandle } from './components/TreeCanvas';
import { FanChartView } from './components/FanChartView';
import { Sidebar } from './components/Sidebar';
import { PersonFormModal, type UnionOption } from './components/PersonFormModal';
import { UnionModal } from './components/UnionModal';
import { RelationshipModal } from './components/RelationshipModal';

type ModalState =
  | { kind: 'none' }
  | { kind: 'add-first' }
  | { kind: 'edit'; personId: string }
  | { kind: 'add-spouse'; personId: string }
  | { kind: 'add-child'; personId: string }
  | { kind: 'add-parent'; personId: string }
  | { kind: 'add-sibling'; personId: string }
  | { kind: 'edit-union'; union: Union }
  | { kind: 'relationship' };

interface ViewSettings {
  anc: number;
  desc: number;
  mode: ViewMode;
}

const DEPTH_KEY = 'family-tree-depths-v1';

export default function App() {
  const store = useTreeStore();
  const { data } = store;
  const [selectedId, setSelectedId] = useState<string | null>(data.focusId);
  const [modal, setModal] = useState<ModalState>({ kind: 'none' });
  const [banner, setBanner] = useState<string | null>(null);
  const [view, setView] = useState<ViewSettings>(() => {
    const fallback: ViewSettings = { anc: 2, desc: 2, mode: 'hourglass' };
    try {
      const raw = localStorage.getItem(DEPTH_KEY);
      if (raw) return { ...fallback, ...(JSON.parse(raw) as Partial<ViewSettings>) };
    } catch {
      /* default below */
    }
    return fallback;
  });
  const canvasRef = useRef<TreeCanvasHandle>(null);

  const layout = useMemo(
    () =>
      computeLayout(data, {
        ancestorDepth: view.anc,
        descendantDepth: view.desc,
        mode: view.mode === 'fan' ? 'hourglass' : view.mode,
      }),
    [data, view],
  );
  const fanRings = Math.max(1, Math.min(view.anc, 6));

  // keep selection valid
  const selected = selectedId ? data.persons[selectedId] : undefined;
  useEffect(() => {
    if (selectedId && !data.persons[selectedId]) setSelectedId(data.focusId);
  }, [data, selectedId]);

  useEffect(() => {
    try {
      localStorage.setItem(DEPTH_KEY, JSON.stringify(view));
    } catch {
      /* non-fatal */
    }
  }, [view]);

  // fit view when the focus person or view settings change
  const focusId = data.focusId;
  useEffect(() => {
    const t = requestAnimationFrame(() => canvasRef.current?.fit());
    return () => cancelAnimationFrame(t);
  }, [focusId, view]);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
      } else if (e.key === '/' && !typing) {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('[data-search-input]')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store]);

  const showBanner = useCallback((msg: string) => {
    setBanner(msg);
    window.setTimeout(() => setBanner(null), 6000);
  }, []);

  // ----- navigation -----

  const centerOn = useCallback(
    (id: string) => {
      store.applyTransient(M.setFocus(data, id));
      setSelectedId(id);
    },
    [data, store],
  );

  // ----- mutation helpers -----

  const applyAndSelect = (result: { data: TreeData; id: string }) => {
    store.apply(result.data);
    if (result.id) setSelectedId(result.id);
    setModal({ kind: 'none' });
  };

  const modalPerson =
    modal.kind !== 'none' &&
    modal.kind !== 'add-first' &&
    modal.kind !== 'edit-union' &&
    modal.kind !== 'relationship'
      ? data.persons[modal.personId]
      : undefined;

  const childUnionOptions: UnionOption[] = useMemo(() => {
    if (modal.kind !== 'add-child' || !modalPerson) return [];
    const opts: UnionOption[] = getUnionsOf(data, modalPerson.id).map((u) => {
      const other = u.partners.find((p) => p !== modalPerson.id);
      return {
        id: u.id,
        label: other ? `with ${fullName(data.persons[other])}` : 'with unknown partner',
      };
    });
    opts.push({ id: null, label: 'Other parent unknown (new)' });
    return opts;
  }, [modal.kind, modalPerson, data]);

  // ----- import / export -----

  const handleImportFile = async (file: File) => {
    try {
      const text = await readFileAsText(file);
      if (/\.ged(com)?$/i.test(file.name) || text.trimStart().startsWith('0 HEAD')) {
        const { data: imported, warnings } = importGedcom(
          text,
          file.name.replace(/\.[^.]+$/, ''),
        );
        if (Object.keys(imported.persons).length === 0) {
          showBanner('Import failed: no individuals found in the GEDCOM file.');
          return;
        }
        store.replace(imported);
        setSelectedId(imported.focusId);
        showBanner(
          `Imported ${Object.keys(imported.persons).length} people` +
            (warnings.length ? ` — ${warnings.length} warning(s), see console.` : '.'),
        );
        if (warnings.length) console.warn('GEDCOM import warnings:', warnings);
      } else {
        const parsed = JSON.parse(text) as TreeData;
        if (!parsed.persons || !parsed.unions) throw new Error('Not a family tree JSON file');
        const problems = validate(parsed);
        if (problems.length) console.warn('Imported JSON has issues:', problems);
        if (!parsed.focusId || !parsed.persons[parsed.focusId]) {
          parsed.focusId = Object.keys(parsed.persons)[0] ?? null;
        }
        store.replace(parsed);
        setSelectedId(parsed.focusId);
        showBanner(`Imported ${Object.keys(parsed.persons).length} people from JSON.`);
      }
    } catch (err) {
      showBanner(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const safeName = data.name.replace(/[^\w-]+/g, '_') || 'family_tree';

  const handleExportPng = async () => {
    const svg = canvasRef.current?.getSvgElement();
    const bounds = canvasRef.current?.getViewBounds();
    if (!svg || !bounds) return;
    try {
      const pad = 40;
      const w = bounds.maxX - bounds.minX + pad * 2;
      const h = bounds.maxY - bounds.minY + pad * 2;
      const blob = await svgToPng(exportSvg(svg, bounds), w, h, 2);
      downloadBlob(`${safeName}.png`, blob);
    } catch {
      showBanner(
        'PNG export failed — photos from external URLs block rasterization. Use SVG export, or upload photos as files instead.',
      );
    }
  };

  return (
    <div className="app">
      <Toolbar
        data={data}
        canUndo={store.canUndo}
        canRedo={store.canRedo}
        ancestorDepth={view.anc}
        descendantDepth={view.desc}
        viewMode={view.mode}
        onViewModeChange={(mode) => setView((v) => ({ ...v, mode }))}
        onUndo={store.undo}
        onRedo={store.redo}
        onRenameTree={(name) => store.applyTransient(M.renameTree(data, name))}
        onPickPerson={centerOn}
        onDepthChange={(which, value) =>
          setView((v) => ({ ...v, [which]: value }))
        }
        onOpenRelationship={() => setModal({ kind: 'relationship' })}
        onNewTree={() => {
          store.replace(emptyTree());
          setSelectedId(null);
        }}
        onLoadSample={() => {
          const s = sampleTree();
          store.replace(s);
          setSelectedId(s.focusId);
        }}
        onImportFile={handleImportFile}
        onExportJson={() =>
          downloadText(`${safeName}.json`, JSON.stringify(data, null, 2), 'application/json')
        }
        onExportGedcom={() => downloadText(`${safeName}.ged`, exportGedcom(data))}
        onExportSvg={() => {
          const svg = canvasRef.current?.getSvgElement();
          const bounds = canvasRef.current?.getViewBounds();
          if (svg && bounds) downloadText(`${safeName}.svg`, exportSvg(svg, bounds), 'image/svg+xml');
        }}
        onExportPng={() => void handleExportPng()}
      />

      {banner && <div className="banner">{banner}</div>}

      <div className="main">
        {Object.keys(data.persons).length === 0 ? (
          <div className="empty-state">
            <h1>🌳</h1>
            <h2>Start your family tree</h2>
            <p>Add the first person, or explore with the sample family.</p>
            <div>
              <button className="btn primary" onClick={() => setModal({ kind: 'add-first' })}>
                + Add first person
              </button>
              <button
                className="btn"
                onClick={() => {
                  const s = sampleTree();
                  store.replace(s);
                  setSelectedId(s.focusId);
                }}
              >
                Load sample family
              </button>
            </div>
          </div>
        ) : view.mode === 'fan' && data.focusId ? (
          <FanChartView
            ref={canvasRef}
            data={data}
            focusId={data.focusId}
            rings={fanRings}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onFocus={centerOn}
            onAddParent={(childId) => setModal({ kind: 'add-parent', personId: childId })}
            onBackgroundClick={() => setSelectedId(null)}
          />
        ) : (
          <TreeCanvas
            ref={canvasRef}
            data={data}
            layout={layout}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onFocus={centerOn}
            onAddParents={() => {
              if (data.focusId) setModal({ kind: 'add-parent', personId: data.focusId });
            }}
            onBackgroundClick={() => setSelectedId(null)}
          />
        )}

        {selected && (
          <Sidebar
            data={data}
            person={selected}
            onSelect={setSelectedId}
            onCenter={centerOn}
            onEdit={() => setModal({ kind: 'edit', personId: selected.id })}
            onAddParent={() => setModal({ kind: 'add-parent', personId: selected.id })}
            onAddSpouse={() => setModal({ kind: 'add-spouse', personId: selected.id })}
            onAddChild={() => setModal({ kind: 'add-child', personId: selected.id })}
            onAddSibling={() => setModal({ kind: 'add-sibling', personId: selected.id })}
            onEditUnion={(u) => setModal({ kind: 'edit-union', union: u })}
            onUnlinkPartner={(unionId, personId) =>
              store.apply(M.unlinkPartner(data, unionId, personId))
            }
            onUnlinkChild={(childId) => store.apply(M.unlinkChild(data, childId))}
            onReorderChild={(childId, dir) => store.apply(M.reorderChild(data, childId, dir))}
            onOpenRelationship={() => setModal({ kind: 'relationship' })}
            onDelete={() => {
              store.apply(M.deletePerson(data, selected.id));
              setSelectedId(null);
            }}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>

      {/* ----- modals ----- */}

      {modal.kind === 'add-first' && (
        <PersonFormModal
          title="Add first person"
          submitLabel="Add"
          onSubmit={({ draft }) => applyAndSelect(M.addUnconnectedPerson(data, draft))}
          onCancel={() => setModal({ kind: 'none' })}
        />
      )}

      {modal.kind === 'edit' && modalPerson && (
        <PersonFormModal
          title={`Edit ${fullName(modalPerson)}`}
          submitLabel="Save"
          initial={modalPerson}
          onSubmit={({ draft }) => {
            store.apply(M.updatePerson(data, modalPerson.id, draft));
            setModal({ kind: 'none' });
          }}
          onCancel={() => setModal({ kind: 'none' })}
        />
      )}

      {modal.kind === 'add-spouse' && modalPerson && (
        <PersonFormModal
          title={`Add spouse of ${fullName(modalPerson)}`}
          submitLabel="Add spouse"
          defaultGender={
            modalPerson.gender === 'M' ? 'F' : modalPerson.gender === 'F' ? 'M' : 'U'
          }
          allowExisting={{
            data,
            excludeIds: [
              modalPerson.id,
              ...getUnionsOf(data, modalPerson.id).flatMap((u) => u.partners),
            ],
          }}
          onSubmit={({ draft }) => applyAndSelect(M.addSpouse(data, modalPerson.id, draft))}
          onLinkExisting={(otherId) => {
            store.apply(M.linkSpouses(data, modalPerson.id, otherId).data);
            setModal({ kind: 'none' });
          }}
          onCancel={() => setModal({ kind: 'none' })}
        />
      )}

      {modal.kind === 'add-child' && modalPerson && (
        <PersonFormModal
          title={`Add child of ${fullName(modalPerson)}`}
          submitLabel="Add child"
          defaultSurname={modalPerson.surname}
          unionOptions={childUnionOptions}
          onSubmit={({ draft, unionChoice }) =>
            applyAndSelect(M.addChild(data, modalPerson.id, unionChoice ?? null, draft))
          }
          onCancel={() => setModal({ kind: 'none' })}
        />
      )}

      {modal.kind === 'add-parent' && modalPerson && (
        <PersonFormModal
          title={`Add parent of ${fullName(modalPerson)}`}
          submitLabel="Add parent"
          defaultSurname={modalPerson.surname}
          onSubmit={({ draft }) => applyAndSelect(M.addParent(data, modalPerson.id, draft))}
          onCancel={() => setModal({ kind: 'none' })}
        />
      )}

      {modal.kind === 'add-sibling' && modalPerson && (
        <PersonFormModal
          title={`Add sibling of ${fullName(modalPerson)}`}
          submitLabel="Add sibling"
          defaultSurname={modalPerson.surname}
          onSubmit={({ draft }) => applyAndSelect(M.addSibling(data, modalPerson.id, draft))}
          onCancel={() => setModal({ kind: 'none' })}
        />
      )}

      {modal.kind === 'edit-union' && (
        <UnionModal
          data={data}
          union={modal.union}
          onSave={(fields) => {
            store.apply(M.updateUnion(data, modal.union.id, fields));
            setModal({ kind: 'none' });
          }}
          onCancel={() => setModal({ kind: 'none' })}
        />
      )}

      {modal.kind === 'relationship' && (
        <RelationshipModal
          data={data}
          initialA={selectedId && selectedId !== data.focusId ? selectedId : null}
          initialB={data.focusId}
          onSelect={(id) => setSelectedId(id)}
          onClose={() => setModal({ kind: 'none' })}
        />
      )}
    </div>
  );
}
