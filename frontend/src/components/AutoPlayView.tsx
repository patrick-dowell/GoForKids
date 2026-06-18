import { useAutoPlayStore } from '../store/autoPlayStore';
import { Avatar, BOT_AVATARS } from './Avatar';
import { ConceptLink } from './ConceptLink';
import {
  winsToPromote,
  nextRung,
  gameMatchup,
  hasLadder,
  type Matchup,
  type BoardSize,
} from '../autoplay/matchmaker';
import './AutoPlayView.css';

interface AutoPlayViewProps {
  onExit: () => void;
  /** Called when the player taps "Play" on the match-picker. App.tsx
   *  clears the auto-play view and starts the game via gameStore. */
  onStart: (matchup: Matchup) => void;
}

/** Board sizes shown as pills on the match-picker, in display order. */
const BOARD_OPTIONS: BoardSize[] = [9, 13, 19];

/**
 * Match-picker card shown when the player taps Play from the homepage.
 * Reads the current rung + board from the auto-play store, picks the matchup
 * deterministically (linear ladder), and starts the game when the player
 * confirms. Same view is shown between auto-play games — the player
 * returns here after each match.
 */
export function AutoPlayView({ onExit, onStart }: AutoPlayViewProps) {
  const boardSize = useAutoPlayStore((s) => s.boardSize);
  const setBoardSize = useAutoPlayStore((s) => s.setBoardSize);
  const rungState = useAutoPlayStore((s) => s.rungState);
  const history = useAutoPlayStore((s) => s.history);
  // Compute derived values outside the selector — selectors that return
  // freshly-allocated objects each render trigger React's "getSnapshot
  // should be cached" warning and infinite re-renders.
  // `history` only changes on recordResult, so the color-variety parity is
  // stable for the whole pick-play-record cycle of a game.
  const gamesAtRung = history.filter((h) => h.rung === rungState.currentRung).length;
  const matchup = gameMatchup(rungState.currentRung, rungState.lossStreak, gamesAtRung, boardSize);
  const winsNeeded = winsToPromote(rungState.currentRung, boardSize);
  const atWall = rungState.winsAtCurrentRung >= winsNeeded;

  const botInfo = BOT_AVATARS[matchup.bot] ?? BOT_AVATARS['15k'];
  const next = nextRung(rungState.currentRung, boardSize);
  const winsRemaining = Math.max(0, winsNeeded - rungState.winsAtCurrentRung);

  const colorLine = matchup.playerColor === 'white' ? 'You play ⚪ White' : 'You play ⚫ Black';
  const detailLine = (() => {
    if (matchup.handicap > 0) {
      const who = matchup.playerColor === 'white' ? 'Bot starts' : 'You start';
      return `${who} with ${matchup.handicap} stone${matchup.handicap === 1 ? '' : 's'}.`;
    }
    if (matchup.komi === 0) return 'No komi — you have the edge.';
    if (matchup.komi === undefined) return 'Even game.';
    return `Even game · ${matchup.komi} komi.`;
  })();
  const handicapLine = `${colorLine} · ${detailLine}`;
  // Link the rung's balancing mechanic to the glossary — kids don't know what
  // komi / handicap stones are when the ladder first hands them out.
  const detailConcept = matchup.handicap > 0 ? 'handicap' : matchup.komi !== undefined ? 'komi' : null;

  const promotionLine = atWall
    ? `You've reached the top of the calibrated ladder. The ${next ?? 'next'} bot isn't ready yet — keep playing for fun.`
    : winsRemaining === winsNeeded
      ? `Win ${winsNeeded} games to promote to ${next ?? 'the next rung'}.`
      : `Win ${winsRemaining} more to promote to ${next ?? 'the next rung'}.`;

  const handleStart = () => {
    onStart(matchup);
  };

  return (
    <div className="autoplay-view">
      <div className="autoplay-backdrop">
        <div className="autoplay-stars" />
      </div>

      <header className="autoplay-header">
        <button className="autoplay-back-btn" onClick={onExit} aria-label="Back to home">
          ← Home
        </button>
        <div className="autoplay-rank-chip" aria-label={`Current rank ${rungState.currentRung} on ${boardSize}×${boardSize}`}>
          <span className="autoplay-rank-chip-label">{boardSize}×{boardSize}</span>
          <span className="autoplay-rank-chip-rank">{rungState.currentRung}</span>
        </div>
      </header>

      <main className="autoplay-main">
        <div className="autoplay-card">
          <div className="autoplay-board-pills" role="tablist" aria-label="Board size">
            {BOARD_OPTIONS.map((size) => {
              const enabled = hasLadder(size);
              const selected = size === boardSize;
              return (
                <button
                  key={size}
                  role="tab"
                  aria-selected={selected}
                  className={
                    'autoplay-board-pill' +
                    (selected ? ' autoplay-board-pill-active' : '') +
                    (enabled ? '' : ' autoplay-board-pill-disabled')
                  }
                  disabled={!enabled}
                  title={enabled ? `${size}×${size}` : `${size}×${size} — coming soon`}
                  onClick={() => enabled && setBoardSize(size)}
                >
                  {size}×{size}
                  {!enabled && <span className="autoplay-board-pill-soon">soon</span>}
                </button>
              );
            })}
          </div>

          <div className="autoplay-eyebrow">Today's match</div>

          <div className="autoplay-bot">
            <Avatar type={botInfo.type} size={120} />
            <div className="autoplay-bot-text">
              <div className="autoplay-bot-name">{botInfo.name}</div>
              <div className="autoplay-bot-rank">{matchup.bot}</div>
            </div>
          </div>

          <div className="autoplay-handicap-line">
            {handicapLine}
            {detailConcept && <> · <ConceptLink id={detailConcept}>what's this?</ConceptLink></>}
          </div>

          <div className="autoplay-progress">
            <div className="autoplay-progress-label">{promotionLine}</div>
            <div className="autoplay-progress-bar" role="progressbar" aria-valuenow={rungState.winsAtCurrentRung} aria-valuemax={winsNeeded}>
              {Array.from({ length: winsNeeded }).map((_, i) => (
                <div
                  key={i}
                  className={'autoplay-progress-seg' + (i < rungState.winsAtCurrentRung ? ' autoplay-progress-seg-filled' : '')}
                />
              ))}
            </div>
          </div>

          <button
            className="autoplay-play-btn"
            onClick={handleStart}
            disabled={!matchup.validated}
          >
            <span className="autoplay-play-icon">▶</span>
            Play
          </button>
        </div>
      </main>
    </div>
  );
}
