import { useGameStore } from '../store/gameStore';
import { Color } from '../engine/types';
import { BOT_AVATARS } from './Avatar';
// Shares the lesson-end-* styles. Same overlay/card/scoreboard look; nothing
// in the CSS is lesson-specific. If we split LessonGameEndModal out further
// later, factor the CSS into a generic GameEndModal.css and have both modals
// import it. For now, one stylesheet, two consumers.
import './LessonGameEndModal.css';

interface GameEndModalProps {
  /** Called when the user picks "Quit" — App returns them to the home screen. */
  onQuit: () => void;
}

/**
 * End-of-game modal for the regular (non-lesson) game flow. Mirrors the
 * lesson version's layout but uses adaptive framing:
 *   - AI game        → "You" vs "AI" (with bot avatar name)
 *   - Bot-vs-bot     → "[Bot1] (rank)" vs "[Bot2] (rank)"
 *   - Local hot-seat → "Black" vs "White"
 *
 * Replaces the inline `.game-result` block in `GameControls` that was
 * getting cut off below the viewport on iPhone (the side panel doesn't
 * scroll on narrow widths). The modal overlays the whole screen so the
 * full score breakdown is always visible regardless of layout.
 *
 * Dismiss → modal hides, `GameEndPanel` becomes the compact "See results"
 *           pill in the side panel so the user can reopen.
 * Quit    → App calls onQuit, which navigates back to the home screen.
 */
export function GameEndModal({ onQuit }: GameEndModalProps) {
  const phase = useGameStore((s) => s.phase);
  const result = useGameStore((s) => s.result);
  const playerColor = useGameStore((s) => s.playerColor);
  const gameId = useGameStore((s) => s.gameId);
  const gameMode = useGameStore((s) => s.gameMode);
  const blackRank = useGameStore((s) => s.blackRank);
  const whiteRank = useGameStore((s) => s.whiteRank);
  const botName = useGameStore((s) => s.botName);
  const targetRank = useGameStore((s) => s.targetRank);
  const lessonContext = useGameStore((s) => s.lessonContext);
  const autoplayContext = useGameStore((s) => s.autoplayContext);
  const dismissed = useGameStore((s) => s.gameEndDismissed);
  const dismiss = useGameStore((s) => s.dismissGameEnd);
  // We deliberately do NOT auto-popup the modal if the user has the
  // bot-passed handoff modal open (would stack); that's a separate flow.
  if (lessonContext) return null;  // Lesson games use LessonGameEndModal.
  if (autoplayContext) return null; // Auto-play games use AutoPlayGameEndModal.
  if (phase !== 'finished' || !result) return null;
  if (dismissed) return null;

  const isBotVsBot = gameMode === 'botvsbot';
  const isAIGame = !!gameId && !isBotVsBot;
  const isResignation = result.blackScore === 0 && result.whiteScore === 0;
  const margin = Math.abs(result.blackScore - result.whiteScore);

  // Framing: produces (winnerName, loserName, "you-perspective") for the
  // headline + scoreboard. AI games are framed from the player's POV;
  // local games and bot-vs-bot use neutral color/name framing.
  let titleText: string;
  let blackLabel: string;
  let whiteLabel: string;
  const userWonAIGame = isAIGame && result.winner === playerColor;
  if (isAIGame) {
    // Use the actual bot's name (e.g., "Seedling") rather than the generic
    // "AI". `botName` is populated by gameStore.newGame from BOT_AVATARS, so
    // it's always set when isAIGame is true. Title carries the rank for
    // context (mirrors PlayerCard's `${botName} (${targetRank})` framing);
    // scoreboard labels stay compact.
    const botDisplay = botName || 'AI';
    const botTitleDisplay = targetRank ? `${botDisplay} (${targetRank})` : botDisplay;
    titleText = userWonAIGame ? 'You won!' : `${botTitleDisplay} wins`;
    blackLabel = playerColor === Color.Black ? 'You' : botDisplay;
    whiteLabel = playerColor === Color.White ? 'You' : botDisplay;
  } else if (isBotVsBot) {
    const wb = BOT_AVATARS[blackRank || '15k'] || BOT_AVATARS['15k'];
    const ww = BOT_AVATARS[whiteRank || '15k'] || BOT_AVATARS['15k'];
    const winnerName =
      result.winner === Color.Black ? `${wb.name} (${blackRank})` : `${ww.name} (${whiteRank})`;
    titleText = `${winnerName} wins`;
    blackLabel = `${wb.name}`;
    whiteLabel = `${ww.name}`;
  } else {
    titleText = result.winner === Color.Black ? 'Black wins' : 'White wins';
    blackLabel = 'Black';
    whiteLabel = 'White';
  }

  return (
    <div className="lesson-end-overlay" role="dialog" aria-modal="true" onClick={dismiss}>
      <div
        className={
          'lesson-end-card ' +
          (isAIGame
            ? userWonAIGame
              ? 'lesson-end-win'
              : 'lesson-end-loss'
            : '')
        }
        onClick={(e) => e.stopPropagation()}
      >
        <button className="lesson-end-close" onClick={dismiss} aria-label="Close — see the board">
          ×
        </button>
        <div className="lesson-end-icon" aria-hidden>
          {isAIGame ? (userWonAIGame ? '🏆' : '🤖') : '🏁'}
        </div>
        <h2 className="lesson-end-title">{titleText}</h2>

        {isResignation ? (
          <p className="lesson-end-body">Game ended by resignation.</p>
        ) : (
          <>
            <div className="lesson-end-scoreboard">
              <ScoreSide
                label={blackLabel}
                total={result.blackScore}
                territory={result.blackTerritory}
                captures={result.blackCaptures}
                komi={0}
                accent="black"
                highlight={result.winner === Color.Black}
              />
              <div className="lesson-end-vs">vs</div>
              <ScoreSide
                label={whiteLabel}
                total={result.whiteScore}
                territory={result.whiteTerritory}
                captures={result.whiteCaptures}
                komi={result.komi}
                accent="white"
                highlight={result.winner === Color.White}
              />
            </div>
            <p className="lesson-end-body">
              Final margin: {margin.toFixed(margin % 1 === 0 ? 0 : 1)} points
            </p>
          </>
        )}

        <div className="lesson-end-actions">
          <button className="lesson-end-btn lesson-end-btn-secondary" onClick={dismiss}>
            Close
          </button>
          <button className="lesson-end-btn lesson-end-btn-primary" onClick={onQuit}>
            Quit
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Compact "Game over" pill rendered in the side panel after the player
 * dismisses the modal — gives them a way back to the full scoreboard
 * without having to start a new game. Mirrors LessonGameEndPanel.
 */
export function GameEndPanel() {
  const phase = useGameStore((s) => s.phase);
  const result = useGameStore((s) => s.result);
  const playerColor = useGameStore((s) => s.playerColor);
  const gameId = useGameStore((s) => s.gameId);
  const gameMode = useGameStore((s) => s.gameMode);
  const botName = useGameStore((s) => s.botName);
  const lessonContext = useGameStore((s) => s.lessonContext);
  const autoplayContext = useGameStore((s) => s.autoplayContext);
  const reopen = useGameStore((s) => s.reopenGameEnd);

  if (lessonContext) return null;
  if (autoplayContext) return null; // Auto-play games use AutoPlayGameEndModal.
  if (phase !== 'finished' || !result) return null;

  const isBotVsBot = gameMode === 'botvsbot';
  const isAIGame = !!gameId && !isBotVsBot;
  const isResignation = result.blackScore === 0 && result.whiteScore === 0;
  const margin = Math.abs(result.blackScore - result.whiteScore);
  const userWonAIGame = isAIGame && result.winner === playerColor;

  let title: string;
  if (isAIGame) {
    // The compact pill is space-constrained; show just the bot's name
    // ("Seedling wins") rather than the full "Seedling (30k) wins" we use
    // in the modal title.
    title = userWonAIGame ? 'You won!' : `${botName || 'AI'} wins`;
  } else {
    title = result.winner === Color.Black ? 'Black wins' : 'White wins';
  }

  return (
    <div
      className={
        'lesson-end-panel ' + (isAIGame && userWonAIGame ? 'lesson-end-panel-win' : '')
      }
    >
      <div className="lesson-end-panel-icon">
        {isAIGame ? (userWonAIGame ? '🏆' : '🤖') : '🏁'}
      </div>
      <div className="lesson-end-panel-text">
        <div className="lesson-end-panel-title">{title}</div>
        <div className="lesson-end-panel-margin">
          {isResignation ? 'by resignation' : `by ${margin.toFixed(margin % 1 === 0 ? 0 : 1)} pts`}
        </div>
      </div>
      <button className="lesson-end-panel-btn" onClick={reopen}>
        See results
      </button>
    </div>
  );
}

interface ScoreSideProps {
  label: string;
  total: number;
  territory: number;
  captures: number;
  komi: number;
  accent: 'black' | 'white';
  highlight: boolean;
}

function ScoreSide({ label, total, territory, captures, komi, accent, highlight }: ScoreSideProps) {
  return (
    <div className={'lesson-end-side' + (highlight ? ' lesson-end-side-winner' : '')}>
      <div className="lesson-end-side-header">
        <span className={'stone-icon ' + accent} />
        <span className="lesson-end-side-label">{label}</span>
      </div>
      <div className="lesson-end-side-total">{total}</div>
      <div className="lesson-end-side-detail">
        <div>
          <span className="lesson-end-side-num">{territory}</span> territory
        </div>
        <div>
          + <span className="lesson-end-side-num">{captures}</span> captures
        </div>
        {komi > 0 && (
          <div className="lesson-end-side-komi">
            + <span className="lesson-end-side-num">{komi}</span> komi
          </div>
        )}
      </div>
    </div>
  );
}
