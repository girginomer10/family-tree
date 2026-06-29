import { forwardRef, useMemo } from 'react';
import type { TreeData } from '../types';
import { computeTimeline, BAR_H, ROW_H } from '../layout/timeline';
import type { HealthMark } from '../model/health';
import { HEALTH_COLORS, HEALTH_DIM_OPACITY } from '../model/health';
import { HealthLegend } from './HealthLegend';
import { ZoomCanvas, type ZoomCanvasHandle } from './ZoomCanvas';

const BAR_COLORS = {
  M: { fill: '#9dbdd8', stroke: '#4d7fae' },
  F: { fill: '#e3b7c4', stroke: '#bd6880' },
  U: { fill: '#cdc8bc', stroke: '#9a948a' },
};

interface Props {
  data: TreeData;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
  onBackgroundClick: () => void;
  healthMarks?: Map<string, HealthMark> | null;
  healthLabel?: string | null;
}

export const TimelineView = forwardRef<ZoomCanvasHandle, Props>(function TimelineView(
  { data, selectedId, onSelect, onFocus, onBackgroundClick, healthMarks, healthLabel },
  ref,
) {
  const currentYear = new Date().getFullYear();
  const tl = useMemo(() => computeTimeline(data, currentYear), [data, currentYear]);
  const height = tl.rows.length * ROW_H;

  return (
    <ZoomCanvas
      ref={ref}
      bounds={tl.bounds}
      onBackgroundClick={onBackgroundClick}
      overlay={
        <>
          <div className="canvas-stats">
            Timeline — {tl.shownPersons} people with dates
            {tl.omittedPersons > 0 ? ` (${tl.omittedPersons} without dates omitted)` : ''}
          </div>
          {healthMarks && <HealthLegend label={healthLabel} marks={healthMarks} />}
        </>
      }
    >
      {/* decade grid */}
      {tl.ticks.map((t) => (
        <g key={t.year}>
          <line x1={t.x} y1={-6} x2={t.x} y2={height} stroke="#e3ddd0" strokeWidth={1} />
          <text x={t.x} y={-14} textAnchor="middle" fontSize={11} fill="#8a847a">
            {t.year}
          </text>
        </g>
      ))}

      {tl.rows.map((r) => {
        const p = data.persons[r.personId];
        if (!p) return null;
        const c = BAR_COLORS[p.gender];
        const isSel = selectedId === r.personId;
        const isFocus = data.focusId === r.personId;
        const barY = r.y + (ROW_H - BAR_H) / 2;
        const mark = healthMarks?.get(r.personId) ?? null;
        const dimmed = !!healthMarks && !mark;
        return (
          <g
            key={r.personId}
            style={{ cursor: 'pointer' }}
            opacity={dimmed ? HEALTH_DIM_OPACITY : 1}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(r.personId);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onFocus(r.personId);
            }}
          >
            <title>
              {r.label} ({r.years})
            </title>
            {/* row hover/selection backdrop */}
            {isSel && (
              <rect
                x={tl.bounds.minX + 4}
                y={r.y + 1}
                width={tl.bounds.maxX - tl.bounds.minX - 8}
                height={ROW_H - 2}
                fill="#5b54a0"
                opacity={0.07}
                rx={6}
              />
            )}
            <rect
              x={r.x1}
              y={barY}
              width={Math.max(r.x2 - r.x1, 4)}
              height={BAR_H}
              rx={5}
              fill={mark ? HEALTH_COLORS[mark].fill : c.fill}
              stroke={
                isSel || isFocus ? '#5b54a0' : mark ? HEALTH_COLORS[mark].stroke : c.stroke
              }
              strokeWidth={isSel || isFocus || mark === 'has' ? 2 : 1}
              strokeDasharray={mark === 'risk' ? '5 4' : r.approxStart ? '4 3' : undefined}
              opacity={r.living ? 0.75 : 1}
            />
            {r.living && (
              <text
                x={r.x2 + 4}
                y={barY + BAR_H / 2 + 4}
                fontSize={11}
                fill={c.stroke}
              >
                ➤
              </text>
            )}
            {r.markers.map((m, i) => (
              <circle
                key={i}
                cx={m.x}
                cy={barY + BAR_H / 2}
                r={3.5}
                fill="#fff"
                stroke={c.stroke}
                strokeWidth={1.5}
              >
                <title>Married {m.year}</title>
              </circle>
            ))}
            <text
              x={r.x1 - 8}
              y={barY + BAR_H / 2 + 4}
              textAnchor="end"
              fontSize={12}
              fontWeight={isSel || isFocus ? 700 : 500}
              fill="#2a2722"
            >
              {r.label}
            </text>
            <text
              x={r.x2 + (r.living ? 16 : 6)}
              y={barY + BAR_H / 2 + 4}
              fontSize={10.5}
              fill="#8a847a"
            >
              {r.years}
            </text>
          </g>
        );
      })}
    </ZoomCanvas>
  );
});
