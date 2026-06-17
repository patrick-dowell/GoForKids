import { Color, type Point } from '../engine/types';
import './DiagramBoard.css';

interface DiagramBoardProps {
  size: number;
  stones: Array<{ row: number; col: number; color: Color }>;
  /** Intersections to glow (liberties, eyes, territory, the move-here point). */
  highlight?: Point[];
  /** Rendered pixel size (square). Defaults to 180. */
  px?: number;
}

/**
 * A small, static, prop-driven goban for glossary/diagram use — pure SVG, no
 * store coupling (unlike the live `GoBoard`, which is canvas + gameStore). Used
 * by concept pages (fp 29) to show a tiny illustrative position.
 */
export function DiagramBoard({ size, stones, highlight = [], px = 180 }: DiagramBoardProps) {
  // One cell of padding on every side so edge stones and labels aren't clipped.
  const cells = size - 1;
  const pad = px / (size + 1);
  const step = (px - 2 * pad) / cells;
  const at = (i: number) => pad + i * step;
  const r = step * 0.46;

  const highlightSet = new Set(highlight.map((p) => `${p.row},${p.col}`));

  const lines = [];
  for (let i = 0; i < size; i++) {
    lines.push(
      <line key={`h${i}`} x1={at(0)} y1={at(i)} x2={at(cells)} y2={at(i)} className="diagram-grid" />,
      <line key={`v${i}`} x1={at(i)} y1={at(0)} x2={at(i)} y2={at(cells)} className="diagram-grid" />,
    );
  }

  return (
    <svg
      viewBox={`0 0 ${px} ${px}`}
      className="diagram-board"
      role="img"
      aria-label={`Go position on a ${size} by ${size} board`}
      width={px}
      height={px}
    >
      <rect x={0} y={0} width={px} height={px} rx={6} className="diagram-bg" />
      {lines}
      {highlight.map((p) => (
        <circle key={`hl${p.row},${p.col}`} cx={at(p.col)} cy={at(p.row)} r={r * 0.92} className="diagram-highlight" />
      ))}
      {stones.map((s) => (
        <circle
          key={`s${s.row},${s.col}`}
          cx={at(s.col)}
          cy={at(s.row)}
          r={r}
          className={s.color === Color.Black ? 'diagram-stone-black' : 'diagram-stone-white'}
        />
      ))}
      {/* Re-draw highlight rings ON TOP of any stone sitting on a marked point
          (e.g. the captured/atari stone) so the mark stays visible. */}
      {stones
        .filter((s) => highlightSet.has(`${s.row},${s.col}`))
        .map((s) => (
          <circle key={`hlr${s.row},${s.col}`} cx={at(s.col)} cy={at(s.row)} r={r * 1.15} className="diagram-highlight-ring" />
        ))}
    </svg>
  );
}
