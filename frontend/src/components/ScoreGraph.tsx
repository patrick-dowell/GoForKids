import { useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import { useReplayStore } from '../store/replayStore';
import { Color } from '../engine/types';
import { BOT_AVATARS } from './Avatar';
import type { ScorePoint } from '../learn/gameReview';

const W = 200;
const H = 70;
const PADDING_X = 8;
const PADDING_Y = 8;

/** Friendly name for whichever side owns each color, per game mode. */
function useSideNames(): { black: string; white: string } {
  const gameMode = useGameStore((s) => s.gameMode);
  const playerColor = useGameStore((s) => s.playerColor);
  const targetRank = useGameStore((s) => s.targetRank);
  const botName = useGameStore((s) => s.botName);
  const blackRank = useGameStore((s) => s.blackRank);
  const whiteRank = useGameStore((s) => s.whiteRank);

  if (gameMode === 'botvsbot') {
    const b = BOT_AVATARS[blackRank ?? '15k'] ?? BOT_AVATARS['15k'];
    const w = BOT_AVATARS[whiteRank ?? '15k'] ?? BOT_AVATARS['15k'];
    return { black: b.name, white: w.name };
  }
  if (gameMode === 'ai') {
    const ai = `${botName} (${targetRank})`;
    return playerColor === Color.Black
      ? { black: 'You', white: ai }
      : { black: ai, white: 'You' };
  }
  return { black: 'Black', white: 'White' };
}

/** Last history point at or before `move` (the score as of that position). */
function pointAt(history: ScorePoint[], move: number): ScorePoint {
  let best = history[0];
  for (const p of history) {
    if (p.move <= move) best = p;
    else break;
  }
  return best;
}

interface ChartMarker {
  move: number;
  kind: 'good' | 'bad';
  active: boolean;
  title?: string;
}

interface ScoreGraphChartProps {
  history: ScorePoint[];
  /** "Score (Black − White)"-style header label. */
  label: string;
  blackName: string;
  whiteName: string;
  /** Replay position: draws a cursor there and reads the lead at it.
   *  Omitted (live game) → the latest point is the current one. */
  cursorMove?: number;
  /** Scrub/tap-to-seek. The chart maps pointer x → move number. */
  onSeek?: (move: number) => void;
  /** Key-move dots drawn on the score line (replay's ★ markers). */
  markers?: ChartMarker[];
}

/**
 * Compact line chart of black's lead vs white over the course of the game.
 * Mid-game numbers are noisy because territory isn't settled — the trend
 * matters more than the precise value, especially for kids learning the game.
 * Presentational: the live game and the replay wrap it with their own data.
 */
export function ScoreGraphChart({ history, label, blackName, whiteName, cursorMove, onSeek, markers }: ScoreGraphChartProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  if (history.length < 2) {
    // Not enough data for a meaningful line yet.
    return (
      <div className="score-graph-empty">
        <div className="score-graph-label">{label}</div>
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

  // The "current" position: the cursor in a replay, the last point live.
  const atMove = cursorMove === undefined ? lastMove : Math.max(0, Math.min(cursorMove, lastMove));
  const current = pointAt(history, atMove);
  const currentLead = current.lead;
  const leadAbs = Math.abs(currentLead).toFixed(1);
  const leader = currentLead === 0 ? '—' : currentLead > 0 ? blackName : whiteName;
  const lineColor = currentLead >= 0 ? 'var(--graph-black, #4a6fff)' : 'var(--graph-white, #d8c898)';

  const seekFromPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!onSeek || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    const chartFrac = (frac * W - PADDING_X) / (W - PADDING_X * 2);
    onSeek(Math.round(Math.max(0, Math.min(1, chartFrac)) * lastMove));
  };

  return (
    <div className="score-graph">
      <div className="score-graph-header">
        <span className="score-graph-label">{label}</span>
        <span className="score-graph-value">
          {currentLead === 0 ? (
            'Even'
          ) : (
            <>
              <span className={`stone-icon ${currentLead > 0 ? 'black' : 'white'}`} />
              {leader} +{leadAbs}
            </>
          )}
        </span>
      </div>
      {/* preserveAspectRatio="none" stretches SVG geometry (circles become
          ellipses, 1px lines become 4px bars), so dots live as round HTML
          overlays positioned in %, and lines opt out via non-scaling-stroke. */}
      <div className="score-graph-plot">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          preserveAspectRatio="none"
          aria-hidden
          style={onSeek ? { cursor: 'pointer', touchAction: 'none', display: 'block' } : { display: 'block' }}
          onPointerDown={onSeek ? (e) => {
            // Capture keeps a drag scrubbing even when the finger leaves the
            // chart; guard it — an inactive pointerId throws (e.g. synthetic
            // events in tests) and would otherwise kill the seek itself.
            try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* seek still works */ }
            seekFromPointer(e);
          } : undefined}
          onPointerMove={onSeek ? (e) => { if (e.buttons > 0) seekFromPointer(e); } : undefined}
        >
          {/* Zero baseline */}
          <line x1={PADDING_X} y1={H / 2} x2={W - PADDING_X} y2={H / 2} stroke="rgba(120,120,150,0.4)" strokeDasharray="3,3" vectorEffect="non-scaling-stroke" />
          {/* Score line */}
          <polyline
            fill="none"
            stroke={lineColor}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            points={points}
            vectorEffect="non-scaling-stroke"
          />
          {/* Replay cursor: where you are in the game right now. */}
          {cursorMove !== undefined && (
            <line
              x1={xFor(atMove)}
              y1={2}
              x2={xFor(atMove)}
              y2={H - 2}
              stroke="rgba(255,255,255,0.55)"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {/* Key-move dots on the score line (tap to jump exactly there). */}
        {markers?.map((m) => (
          <button
            key={m.move}
            className={`score-graph-marker ${m.kind}${m.active ? ' active' : ''}`}
            title={m.title}
            aria-label={m.title ?? `Key move ${m.move}`}
            style={{
              left: `${(xFor(Math.min(m.move, lastMove)) / W) * 100}%`,
              top: `${(yFor(pointAt(history, m.move).lead) / H) * 100}%`,
            }}
            onPointerDown={onSeek ? (e) => { e.stopPropagation(); onSeek(m.move); } : undefined}
          />
        ))}
        {/* Current point */}
        <span
          className="score-graph-dot"
          style={{
            left: `${(xFor(cursorMove !== undefined ? atMove : lastMove) / W) * 100}%`,
            top: `${(yFor(currentLead) / H) * 100}%`,
            background: lineColor,
          }}
        />
      </div>
    </div>
  );
}

/** Live-game score graph (side panel) — reads the running game's history. */
export function ScoreGraph() {
  const history = useGameStore((s) => s.scoreHistory);
  const { black: blackName, white: whiteName } = useSideNames();
  return (
    <ScoreGraphChart
      history={history}
      label={`Score (${blackName} − ${whiteName})`}
      blackName={blackName}
      whiteName={whiteName}
    />
  );
}

/**
 * Replay score graph — the game's score arc as the replay's scrubber. It
 * REPLACES the plain range slider and the marker strip when score data
 * exists (the replay panel has zero spare vertical budget — the graph pays
 * for itself by absorbing both): "Move N / M" lives in its header, key-move
 * ★ dots sit on the score line, tap/drag seeks, cursor shows position.
 * Renders nothing when the save has no score history (older saves, stub-AI
 * games) — the caller falls back to the plain slider.
 */
export function ReplayScoreGraph() {
  const history = useReplayStore((s) => s.scoreHistory);
  const currentMove = useReplayStore((s) => s.currentMove);
  const totalMoves = useReplayStore((s) => s.totalMoves);
  const goToMove = useReplayStore((s) => s.goToMove);
  const playerColor = useReplayStore((s) => s.playerColor);
  const opponentRank = useReplayStore((s) => s.opponentRank);
  const highlights = useReplayStore((s) => s.highlights);

  // Drop the move-0 seed point: no moves have been played, and on handicap
  // saves its lead is a raw-board-count artifact (e.g. +356.5) that would
  // flatten the y-scale and greet the replay with a nonsense number.
  const plotted = history.filter((p) => p.move >= 1);

  if (plotted.length < 2) return null;

  // Observed bot-vs-bot saves store "18k vs 15k" as the opponent string —
  // no "You" side to speak of.
  const observed = opponentRank.includes(' vs ');
  const blackName = observed ? 'Black' : playerColor === 'black' ? 'You' : opponentRank;
  const whiteName = observed ? 'White' : playerColor === 'black' ? opponentRank : 'You';

  return (
    <div className="replay-score-graph">
      <ScoreGraphChart
        history={plotted}
        label={`Move ${currentMove} / ${totalMoves}`}
        blackName={blackName}
        whiteName={whiteName}
        cursorMove={currentMove}
        onSeek={(move) => goToMove(Math.min(move, totalMoves))}
        markers={highlights.map((h) => ({
          move: h.moveNumber,
          kind: h.kind === 'good' ? 'good' as const : 'bad' as const,
          active: h.moveNumber === currentMove,
          title: `Move ${h.moveNumber}: ${h.headline}`,
        }))}
      />
    </div>
  );
}
