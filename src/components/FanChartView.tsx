import { forwardRef, useMemo } from 'react';
import type { TreeData } from '../types';
import { fullName, lifespan } from '../types';
import { computeFan } from '../layout/fan';
import { ZoomCanvas, type ZoomCanvasHandle } from './ZoomCanvas';

interface Props {
  data: TreeData;
  focusId: string;
  rings: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
  onAddParent: (childId: string) => void;
  onBackgroundClick: () => void;
}

export const FanChartView = forwardRef<ZoomCanvasHandle, Props>(function FanChartView(
  { data, focusId, rings, selectedId, onSelect, onFocus, onAddParent, onBackgroundClick },
  ref,
) {
  const fan = useMemo(() => computeFan(data, focusId, rings), [data, focusId, rings]);
  const focus = data.persons[focusId];
  const total = Object.keys(data.persons).length;

  return (
    <ZoomCanvas
      ref={ref}
      bounds={fan.bounds}
      onBackgroundClick={onBackgroundClick}
      overlay={
        <div className="canvas-stats">
          Fan chart — {fan.shownPersons} of {total} people · {rings} generations of ancestors
        </div>
      }
    >
      {fan.sectors.map((s) => (
        <g
          key={s.key}
          style={{ cursor: 'pointer' }}
          onClick={(e) => {
            e.stopPropagation();
            if (s.personId) onSelect(s.personId);
            else if (s.childId) onAddParent(s.childId);
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (s.personId) onFocus(s.personId);
          }}
        >
          <title>
            {s.personId
              ? `${fullName(data.persons[s.personId])}${
                  lifespan(data.persons[s.personId])
                    ? ` (${lifespan(data.persons[s.personId])})`
                    : ''
                } — double-click to center`
              : `Add parent of ${s.childId ? fullName(data.persons[s.childId]) : ''}`}
          </title>
          <path
            d={s.d}
            fill={s.fill}
            stroke={s.personId && selectedId === s.personId ? '#5b54a0' : s.stroke}
            strokeWidth={s.personId && selectedId === s.personId ? 2.5 : 1}
            strokeDasharray={s.personId ? undefined : '5 4'}
          />
          {s.label && (
            <text
              transform={`translate(${s.label.x}, ${s.label.y}) rotate(${s.label.rotate})`}
              textAnchor={s.label.anchor}
              fill={s.textFill}
            >
              {s.label.lines.map((l, i) => (
                <tspan
                  key={i}
                  x={0}
                  dy={i === 0 ? l.dy : l.dy - (s.label!.lines[i - 1]?.dy ?? 0)}
                  fontSize={l.size}
                  fontWeight={l.weight}
                >
                  {l.text}
                </tspan>
              ))}
            </text>
          )}
        </g>
      ))}

      {/* center disc: the focus person */}
      {focus && (
        <g
          style={{ cursor: 'pointer' }}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(focus.id);
          }}
        >
          <circle
            r={fan.centerR - 4}
            fill={selectedId === focus.id ? '#fbfaff' : '#ffffff'}
            stroke="#5b54a0"
            strokeWidth={selectedId === focus.id ? 3 : 2}
          />
          <text textAnchor="middle" fill="#2a2722">
            <tspan x={0} y={-8} fontSize={14} fontWeight={700}>
              {focus.givenName.length > 12 ? focus.givenName.slice(0, 11) + '…' : focus.givenName}
            </tspan>
            <tspan x={0} y={9} fontSize={13}>
              {focus.surname.length > 12 ? focus.surname.slice(0, 11) + '…' : focus.surname}
            </tspan>
            <tspan x={0} y={27} fontSize={10.5} fill="#8a847a">
              {lifespan(focus)}
            </tspan>
          </text>
        </g>
      )}
    </ZoomCanvas>
  );
});
