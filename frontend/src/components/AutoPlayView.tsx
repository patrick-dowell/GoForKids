import { useAutoPlayStore } from '../store/autoPlayStore';
import { Avatar, BOT_AVATARS } from './Avatar';
import { WINS_TO_PROMOTE, nextRung, effectiveMatchup, type Matchup } from '../autoplay/matchmaker';
import './AutoPlayView.css';

interface AutoPlayViewProps {
  onExit: () => void;
  /** Called when the player taps "Play" on the match-picker. App.tsx
   *  clears the auto-play view and starts the game via gameStore. */
  onStart: (matchup: Matchup) => void;
}

/**
 * Match-picker card shown when the player taps Play from the homepage.
 * Reads the current rung from the auto-play store, picks the matchup
 * deterministically (linear ladder), and starts the game when the player
 * confirms. Same view is shown between auto-play games — the player
 * returns here after each match.
 */
export function AutoPlayView({ onExit, onStart }: AutoPlayViewProps) {
  const rungState = useAutoPlayStore((s) => s.rungState);
  // Compute derived values outside the selector — selectors that return
  // freshly-allocated objects each render trigger React's "getSnapshot
  // should be cached" warning and infinite re-renders.
  const matchup = effectiveMatchup(rungState.currentRung, rungState.lossStreak);
  const atWall = rungState.winsAtCurrentRung >= WINS_TO_PROMOTE;

  const botInfo = BOT_AVATARS[matchup.bot] ?? BOT_AVATARS['15k'];
  const next = nextRung(rungState.currentRung);
  const winsRemaining = Math.max(0, WINS_TO_PROMOTE - rungState.winsAtCurrentRung);

  const handicapLine = (() => {
    if (matchup.handicap === 0) return 'Even game — no handicap.';
    if (matchup.handicap === 1) return 'You take 1 stone (+1 advantage).';
    return `You take ${matchup.handicap} stones (+${matchup.handicap} advantage).`;
  })();

  const promotionLine = atWall
    ? `You've reached the top of the calibrated ladder. The ${next ?? 'next'} bot isn't ready yet — keep playing for fun.`
    : winsRemaining === WINS_TO_PROMOTE
      ? `Win ${WINS_TO_PROMOTE} games to promote to ${next ?? 'the next rung'}.`
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
        <div className="autoplay-rank-chip" aria-label={`Current rank ${rungState.currentRung}`}>
          <span className="autoplay-rank-chip-label">19×19</span>
          <span className="autoplay-rank-chip-rank">{rungState.currentRung}</span>
        </div>
      </header>

      <main className="autoplay-main">
        <div className="autoplay-card">
          <div className="autoplay-eyebrow">Today's match</div>

          <div className="autoplay-bot">
            <Avatar type={botInfo.type} size={120} />
            <div className="autoplay-bot-text">
              <div className="autoplay-bot-name">{botInfo.name}</div>
              <div className="autoplay-bot-rank">{matchup.bot}</div>
            </div>
          </div>

          <div className="autoplay-handicap-line">{handicapLine}</div>

          <div className="autoplay-progress">
            <div className="autoplay-progress-label">{promotionLine}</div>
            <div className="autoplay-progress-bar" role="progressbar" aria-valuenow={rungState.winsAtCurrentRung} aria-valuemax={WINS_TO_PROMOTE}>
              {Array.from({ length: WINS_TO_PROMOTE }).map((_, i) => (
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
            disabled={!botInfo.validated}
          >
            <span className="autoplay-play-icon">▶</span>
            Play
          </button>
        </div>
      </main>
    </div>
  );
}
