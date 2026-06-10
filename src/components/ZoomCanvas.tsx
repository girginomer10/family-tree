import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ZoomCanvasHandle {
  fit: () => void;
  zoomBy: (factor: number) => void;
  getSvgElement: () => SVGSVGElement | null;
  getViewBounds: () => Bounds;
}

interface Props {
  bounds: Bounds;
  children: ReactNode;
  /** HTML rendered over the canvas (stats chips etc.). */
  overlay?: ReactNode;
  onBackgroundClick?: () => void;
}

interface Viewport {
  x: number;
  y: number;
  k: number;
}

const MIN_K = 0.1;
const MAX_K = 3;

export const ZoomCanvas = forwardRef<ZoomCanvasHandle, Props>(function ZoomCanvas(
  { bounds, children, overlay, onBackgroundClick },
  ref,
) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState<Viewport>({ x: 0, y: 0, k: 1 });
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;

  const drag = useRef<{
    startX: number;
    startY: number;
    vx: number;
    vy: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);

  const fit = () => {
    const el = containerRef.current;
    const b = boundsRef.current;
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
    getSvgElement: () => svgRef.current,
    getViewBounds: () => boundsRef.current,
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
      vx: vp.x,
      vy: vp.y,
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
  const onPointerUp = () => {
    if (drag.current?.moved) suppressClick.current = true;
    drag.current = null;
  };
  const onSvgClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    onBackgroundClick?.();
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
        <g transform={`translate(${vp.x}, ${vp.y}) scale(${vp.k})`}>{children}</g>
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

      {overlay}
    </div>
  );
});
