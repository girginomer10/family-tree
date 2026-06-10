import type { Person } from '../types';
import { fullName, lifespan } from '../types';
import type { PlacedCard } from '../layout/layout';
import { CARD_H, CARD_W } from '../layout/layout';

const COLORS = {
  M: { stroke: '#4d7fae', fill: '#e3eef7', text: '#2f5a82' },
  F: { stroke: '#bd6880', fill: '#f8e7ec', text: '#94455c' },
  U: { stroke: '#9a948a', fill: '#eeece6', text: '#6c675e' },
};
const FOCUS = '#5b54a0';

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function initials(p: Person): string {
  const a = p.givenName.trim().charAt(0);
  const b = p.surname.trim().charAt(0);
  return (a + b).toUpperCase() || '?';
}

interface Props {
  placed: PlacedCard;
  person: Person;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
}

export function PersonCard({ placed, person, isSelected, onSelect, onFocus }: Props) {
  const c = COLORS[person.gender];
  const { x, y } = placed;
  const cx = CARD_W / 2;
  const focus = placed.isFocus;
  const stub = placed.isStub;
  const dead = !!person.isDeceased || !!person.death;

  const border = focus ? FOCUS : isSelected ? '#8a82c4' : c.stroke;
  const borderW = focus ? 2.5 : isSelected ? 2 : 1.25;
  const clipId = `clip-${placed.key}`;

  return (
    <g
      transform={`translate(${x}, ${y})`}
      style={{ cursor: 'pointer' }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(person.id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onFocus(person.id);
      }}
    >
      <title>
        {fullName(person)}
        {lifespan(person) ? ` (${lifespan(person)})` : ''}
        {stub ? ' — appears elsewhere in the chart; double-click to center' : ''}
      </title>

      {focus && (
        <rect
          x={-4}
          y={-4}
          width={CARD_W + 8}
          height={CARD_H + 8}
          rx={16}
          fill="none"
          stroke={FOCUS}
          strokeOpacity={0.22}
          strokeWidth={6}
        />
      )}
      <rect
        width={CARD_W}
        height={CARD_H}
        rx={12}
        fill={focus ? '#fbfaff' : '#ffffff'}
        stroke={border}
        strokeWidth={borderW}
        strokeDasharray={stub ? '5 4' : undefined}
        opacity={stub ? 0.8 : 1}
      />

      {/* avatar */}
      {person.photoUrl ? (
        <>
          <clipPath id={clipId}>
            <circle cx={cx} cy={42} r={25} />
          </clipPath>
          <image
            href={person.photoUrl}
            x={cx - 25}
            y={17}
            width={50}
            height={50}
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#${clipId})`}
          />
          <circle cx={cx} cy={42} r={25} fill="none" stroke={c.stroke} strokeWidth={1.25} />
        </>
      ) : (
        <>
          <circle cx={cx} cy={42} r={25} fill={c.fill} stroke={c.stroke} strokeWidth={1.25} />
          <text
            x={cx}
            y={47}
            textAnchor="middle"
            fontSize={15}
            fontWeight={700}
            fill={c.text}
          >
            {initials(person)}
          </text>
        </>
      )}
      {dead && (
        <circle cx={cx + 19} cy={24} r={5.5} fill="#736e64">
          <title>Deceased</title>
        </circle>
      )}

      {/* name */}
      <text
        x={cx}
        y={89}
        textAnchor="middle"
        fontSize={12.5}
        fontWeight={650}
        fill="#2a2722"
        fontStyle={stub ? 'italic' : undefined}
      >
        {truncate(person.givenName || '—', 16)}
      </text>
      <text
        x={cx}
        y={105}
        textAnchor="middle"
        fontSize={12}
        fill="#4d483f"
        fontStyle={stub ? 'italic' : undefined}
      >
        {truncate(person.surname, 16)}
      </text>

      {/* lifespan */}
      <text x={cx} y={127} textAnchor="middle" fontSize={11} fill="#8a847a">
        {stub ? 'see elsewhere ↗' : lifespan(person)}
      </text>

      {/* badges: more relatives beyond the rendered depth */}
      {placed.hasMoreAncestors && (
        <g
          onClick={(e) => {
            e.stopPropagation();
            onFocus(person.id);
          }}
        >
          <title>Has parents not shown — click to center on this person</title>
          <rect x={cx - 13} y={-9} width={26} height={16} rx={8} fill={c.stroke} />
          <text x={cx} y={3} textAnchor="middle" fontSize={10} fontWeight={700} fill="#fff">
            ▲
          </text>
        </g>
      )}
      {placed.hasMoreDescendants && (
        <g
          onClick={(e) => {
            e.stopPropagation();
            onFocus(person.id);
          }}
        >
          <title>Has family not shown — click to center on this person</title>
          <rect
            x={cx - 13}
            y={CARD_H - 7}
            width={26}
            height={16}
            rx={8}
            fill={c.stroke}
          />
          <text
            x={cx}
            y={CARD_H + 5}
            textAnchor="middle"
            fontSize={10}
            fontWeight={700}
            fill="#fff"
          >
            ▼
          </text>
        </g>
      )}
    </g>
  );
}

export function GhostCard({
  placed,
  onClick,
}: {
  placed: PlacedCard;
  onClick: () => void;
}) {
  const cx = CARD_W / 2;
  return (
    <g
      transform={`translate(${placed.x}, ${placed.y})`}
      style={{ cursor: 'pointer' }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      opacity={0.75}
    >
      <title>Add parents</title>
      <rect
        width={CARD_W}
        height={CARD_H}
        rx={12}
        fill="#f4f1ea"
        stroke="#a8a294"
        strokeWidth={1.25}
        strokeDasharray="6 5"
      />
      <circle cx={cx} cy={56} r={20} fill="none" stroke="#a8a294" strokeWidth={1.5} />
      <text x={cx} y={63} textAnchor="middle" fontSize={20} fill="#8a847a">
        +
      </text>
      <text x={cx} y={102} textAnchor="middle" fontSize={12} fontWeight={600} fill="#8a847a">
        Add parents
      </text>
    </g>
  );
}
