import { useGameStore } from '../store/gameStore';

const W = 200;
const H = 70;
const PADDING_X = 8;
const PADDING_Y = 8;

/**
 * Compact line chart of black's lead vs white over the course of the game.
 * Mid-game numbers are noisy because territory isn't settled — the trend
 * matters more than the precise value, especially for kids learning the game.
 */
export function ScoreGraph() {
  const history = useGameStore((s) => s.scoreHistory);

  if (history.length < 2) {
    // Not enough data for a meaningful line yet.
    return (
      <div className="score-graph-empty">
        <div className="score-graph-label">Score (B − W)</div>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="none" aria-hidden>
          <line x1={PADDING_X} y1={H / 2} x2={W - PADDING_X} y2={H / 2} stroke="rgba(120,120,150,0.4)" strokeDasharray="3,3" />
        </svg>
      </div>
    );
  }

  const lastMove = history[history.length - 1].move;
  const maxAbs = Math.max(2, ...history.map((p) => Math.abs(p.lead)));

  const xFor = (move: number) =>
    lastMove === 0 ? PADDING_X : PADDING_X + (move / lastMove) * (W - PADDING_X * 2);
  const yFor = (lead: number) =>
    H / 2 - (lead / maxAbs) * (H / 2 - PADDING_Y);

  const points = history.map((p) => `${xFor(p.move).toFixed(2)},${yFor(p.lead).toFixed(2)}`).join(' ');
  const currentLead = history[history.length - 1].lead;
  const leadAbs = Math.abs(currentLead).toFixed(1);
  const leader = currentLead === 0 ? '—' : currentLead > 0 ? 'Black' : 'White';
  const lineColor = currentLead >= 0 ? 'var(--graph-black, #4a6fff)' : 'var(--graph-white, #d8c898)';

  return (
    <div className="score-graph">
      <div className="score-graph-header">
        <span className="score-graph-label">Score (B − W)</span>
        <span className="score-graph-value">
          {currentLead === 0 ? 'Even' : `${leader} +${leadAbs}`}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="none" aria-hidden>
        {/* Zero baseline */}
        <line x1={PADDING_X} y1={H / 2} x2={W - PADDING_X} y2={H / 2} stroke="rgba(120,120,150,0.4)" strokeDasharray="3,3" />
        {/* Score line */}
        <polyline
          fill="none"
          stroke={lineColor}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          points={points}
        />
        {/* Current point */}
        <circle
          cx={xFor(lastMove)}
          cy={yFor(currentLead)}
          r={2.5}
          fill={lineColor}
        />
      </svg>
    </div>
  );
}
