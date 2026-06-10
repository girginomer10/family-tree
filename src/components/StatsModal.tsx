import { useEffect, useMemo } from 'react';
import type { TreeData } from '../types';
import { computeStats } from '../model/stats';

interface Props {
  data: TreeData;
  onSelect: (id: string) => void;
  onClose: () => void;
}

function Bar({ value, max }: { value: number; max: number }) {
  return (
    <div className="stat-bar">
      <div className="stat-bar-fill" style={{ width: `${max ? (value / max) * 100 : 0}%` }} />
    </div>
  );
}

export function StatsModal({ data, onSelect, onClose }: Props) {
  const currentYear = new Date().getFullYear();
  const s = useMemo(() => computeStats(data, currentYear), [data, currentYear]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const maxDecade = Math.max(1, ...s.birthsPerDecade.map((d) => d.count));
  const namedRow = (
    entry: { name: string; personId: string } | null,
    text: string,
  ) =>
    entry && (
      <div>
        <dt>{text}</dt>
        <dd>
          <button
            className="link-btn"
            onClick={() => {
              onSelect(entry.personId);
              onClose();
            }}
          >
            {entry.name}
          </button>
        </dd>
      </div>
    );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h2>Tree statistics — {data.name}</h2>

        <div className="stat-grid">
          <div className="stat-card">
            <span className="stat-num">{s.total}</span>
            <span className="stat-label">people</span>
          </div>
          <div className="stat-card">
            <span className="stat-num">
              {s.male}&thinsp;♂ / {s.female}&thinsp;♀{s.unknownGender ? ` / ${s.unknownGender}?` : ''}
            </span>
            <span className="stat-label">gender</span>
          </div>
          <div className="stat-card">
            <span className="stat-num">
              {s.living} / {s.deceased}
            </span>
            <span className="stat-label">living / deceased</span>
          </div>
          <div className="stat-card">
            <span className="stat-num">{s.unions}</span>
            <span className="stat-label">
              unions ({s.marriedUnions} married{s.divorcedUnions ? `, ${s.divorcedUnions} div.` : ''})
            </span>
          </div>
          {s.avgLifespan != null && (
            <div className="stat-card">
              <span className="stat-num">{s.avgLifespan}</span>
              <span className="stat-label">avg. lifespan (yrs)</span>
            </div>
          )}
          <div className="stat-card">
            <span className="stat-num">
              {s.withBirthDates}/{s.total}
            </span>
            <span className="stat-label">with birth dates</span>
          </div>
        </div>

        <dl className="facts stats-facts">
          {namedRow(s.longestLife, `Longest life (${s.longestLife?.years} yrs)`)}
          {namedRow(s.oldestLiving, `Oldest living (${s.oldestLiving?.age})`)}
          {namedRow(s.earliestBirth, `Earliest birth (${s.earliestBirth?.year})`)}
        </dl>

        {s.birthsPerDecade.length > 0 && (
          <section>
            <h3>Births per decade</h3>
            <div className="decade-chart">
              {s.birthsPerDecade.map((d) => (
                <div key={d.decade} className="decade-row">
                  <span className="decade-label">{d.decade}s</span>
                  <Bar value={d.count} max={maxDecade} />
                  <span className="decade-count">{d.count}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="stats-columns">
          {s.topSurnames.length > 0 && (
            <section>
              <h3>Top surnames</h3>
              <ul className="top-list">
                {s.topSurnames.map((t) => (
                  <li key={t.name}>
                    {t.name} <span>{t.count}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {s.topGivenNames.length > 0 && (
            <section>
              <h3>Top given names</h3>
              <ul className="top-list">
                {s.topGivenNames.map((t) => (
                  <li key={t.name}>
                    {t.name} <span>{t.count}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {s.topBirthPlaces.length > 0 && (
            <section>
              <h3>Top birth places</h3>
              <ul className="top-list">
                {s.topBirthPlaces.map((t) => (
                  <li key={t.name}>
                    {t.name} <span>{t.count}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
