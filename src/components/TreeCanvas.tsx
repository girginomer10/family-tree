import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import type { TreeData } from '../types';
import type { LayoutResult } from '../layout/layout';
import { GhostCard, PersonCard } from './PersonCard';

export interface TreeCanvasHandle {
  fit: () => void;
  zoomBy: (factor: number) => void;
  resetZoom: () => void;
  getSvgElement: () => SVGSVGElement | null;
  getViewBounds: () => LayoutResult['bounds'];
}

interface Props {
  data: TreeData;
  layout: LayoutResult;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
  onAddParents: () => void;
  onBackgroundClick: () => void;
}

interface Viewport {
  x: number;
  y: number;
  k: number;
}

const MIN_K = 0.12;
const MAX_K = 3;

export const TreeCanvas = forwardRef<TreeCanvasHandle, Props>(function TreeCanvas(
  { data, layout, selectedId, onSelect, onFocus, onAddParents, onBackgroundClick },
  ref,
) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState<Viewport>({ x: 0, y: 0, k: 1 });
  const vpRef = useRef(vp);
  vpRef.current = vp;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const drag = useRef<{ startX: number; startY: number; vx: number; vy: number; moved: boolean } | null>(
    null,
  );

  const fit = () => {
    const el = containerRef.current;
    const b = layoutRef.current.bounds;
    if (!el) return;
    const pad = 60;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const bw = b.maxX - b.minX + pad * 2;
    const bh = b.maxY - b.minY + pad * 2;
    if (bw <= pad * 2 || bh <= pad * 2) return;
    const k = Math.min(Math.min(w / bw, h / bh), 1.15);
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    setVp({ k, x: w / 2 - cx * k, y: h / 2 - cy * k });
  };

  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    setVp((v) => {
      const k = Math.min(MAX_K, Math.max(MIN_K, v.k * factor));
      const scale = k / v.k;
      return { k, x: px - (px - v.x) * scale, y: py - (py - v.y) * scale };
    });
  };

  const zoomCenter = (factor: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  };

  useImperativeHandle(ref, () => ({
    fit,
    zoomBy: zoomCenter,
    resetZoom: () => setVp((v) => ({ ...v, k: 1 })),
    getSvgElement: () => svgRef.current,
    getViewBounds: () => layoutRef.current.bounds,
  }));

  // non-passive wheel handler (React's onWheel can't preventDefault reliably)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.002));
      } else {
        setVp((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = {
      startX: e.clientX,
      startY: e.clientY,
      vx: vpRef.current.x,
      vy: vpRef.current.y,
      moved: false,
    };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (d.moved) setVp((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
  };
  const suppressClick = useRef(false);
  const onPointerUp = () => {
    if (drag.current?.moved) suppressClick.current = true;
    drag.current = null;
  };
  const onSvgClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    onBackgroundClick();
  };

  return (
    <div className="canvas-wrap" ref={containerRef}>
      <svg
        ref={svgRef}
        className="tree-svg"
        width="100%"
        height="100%"
        fontFamily="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => (drag.current = null)}
        onClick={onSvgClick}
      >
        <g transform={`translate(${vp.x}, ${vp.y}) scale(${vp.k})`}>
          {layout.links.map((l) => (
            <path
              key={l.key}
              d={l.d}
              fill="none"
              stroke={l.kind === 'spouse' ? '#a59d8e' : '#b9b29f'}
              strokeWidth={l.kind === 'spouse' ? 2 : 1.5}
              strokeDasharray={l.dashed ? '5 4' : undefined}
              strokeLinecap="round"
            />
          ))}
          {layout.cards.map((c) =>
            c.isGhost ? (
              <GhostCard key={c.key} placed={c} onClick={onAddParents} />
            ) : (
              <PersonCard
                key={c.key}
                placed={c}
                person={data.persons[c.personId]}
                isSelected={selectedId === c.personId}
                onSelect={onSelect}
                onFocus={onFocus}
              />
            ),
          )}
        </g>
      </svg>

      <div className="canvas-controls">
        <button title="Zoom in" onClick={() => zoomCenter(1.25)}>
          +
        </button>
        <button title="Zoom out" onClick={() => zoomCenter(0.8)}>
          −
        </button>
        <button title="Fit to screen" onClick={fit}>
          ⛶
        </button>
      </div>

      <div className="canvas-stats">
        {layout.shownPersons} of {Object.keys(data.persons).length} people shown
        {layout.shownPersons < Object.keys(data.persons).length
          ? ' — use search or badges to navigate'
          : ''}
      </div>
    </div>
  );
});
