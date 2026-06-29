import type { HealthMark } from '../model/health';
import { HEALTH_COLORS } from '../model/health';

interface Props {
  label?: string | null;
  marks: Map<string, HealthMark>;
}

/** Floating key for the hereditary overlay: condition name + carrier / at-risk tallies. */
export function HealthLegend({ label, marks }: Props) {
  let has = 0;
  let risk = 0;
  for (const m of marks.values()) {
    if (m === 'has') has++;
    else risk++;
  }
  return (
    <div className="health-legend">
      <span className="hl-title">⚕ {label || 'Hereditary'}</span>
      <span className="hl-item">
        <span className="hl-swatch" style={{ background: HEALTH_COLORS.has.stroke }} />
        {has} carrier{has === 1 ? '' : 's'}
      </span>
      <span className="hl-item">
        <span
          className="hl-swatch risk"
          style={{ borderColor: HEALTH_COLORS.risk.stroke }}
        />
        {risk} at-risk
      </span>
    </div>
  );
}
