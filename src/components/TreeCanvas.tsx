import { forwardRef } from 'react';
import type { TreeData } from '../types';
import type { LayoutResult } from '../layout/layout';
import { GhostCard, PersonCard } from './PersonCard';
import { ZoomCanvas, type ZoomCanvasHandle } from './ZoomCanvas';

export type TreeCanvasHandle = ZoomCanvasHandle;

interface Props {
  data: TreeData;
  layout: LayoutResult;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
  onAddParents: () => void;
  onBackgroundClick: () => void;
}

export const TreeCanvas = forwardRef<TreeCanvasHandle, Props>(function TreeCanvas(
  { data, layout, selectedId, onSelect, onFocus, onAddParents, onBackgroundClick },
  ref,
) {
  const total = Object.keys(data.persons).length;
  return (
    <ZoomCanvas
      ref={ref}
      bounds={layout.bounds}
      onBackgroundClick={onBackgroundClick}
      overlay={
        <div className="canvas-stats">
          {layout.shownPersons} of {total} people shown
          {layout.shownPersons < total ? ' — use search or badges to navigate' : ''}
        </div>
      }
    >
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
    </ZoomCanvas>
  );
});
