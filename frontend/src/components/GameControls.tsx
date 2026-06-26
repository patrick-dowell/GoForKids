import { useGameStore } from '../store/gameStore';
import { useAutoPlayStore } from '../store/autoPlayStore';
import { useSettingsStore } from '../store/settingsStore';
import { BOT_AVATARS } from './Avatar';
import { Color } from '../engine/types';
import { ScoreGraph } from './ScoreGraph';
import { WhoIsWinning } from './WhoIsWinning';
import { LessonGameEndPanel } from './LessonGameEndModal';
import { GameEndPanel } from './GameEndModal';
import { AutoPlayGameEndPanel } from './AutoPlayGameEndModal';

export function GameControls() {
  const phase = useGameStore((s) => s.phase);
  const currentColor = useGameStore((s) => s.currentColor);
  const playerColor = useGameStore((s) => s.playerColor);
  const moveCount = useGameStore((s) => s.moveCount);
  const result = useGameStore((s) => s.result);
  // Custom Match's "Ranked" checkbox (NOT the auto-play ladder, which uses
  // autoplayContext + leaves isRanked false). Preserved: a custom ranked game
  // hides undo entirely, as it did before banked undos.
  const isRanked = useGameStore((s) => s.isRanked);
  const blackCaptures = useGameStore((s) => s.blackCaptures);
  const whiteCaptures = useGameStore((s) => s.whiteCaptures);
  const aiThinking = useGameStore((s) => s.aiThinking);
  const gameId = useGameStore((s) => s.gameId);
  const targetRank = useGameStore((s) => s.targetRank);
  const gameMode = useGameStore((s) => s.gameMode);
  const blackRank = useGameStore((s) => s.blackRank);
  const whiteRank = useGameStore((s) => s.whiteRank);
  const autoCompleting = useGameStore((s) => s.autoCompleting);
  const pass = useGameStore((s) => s.pass);
  const resign = useGameStore((s) => s.resign);
  const undo = useGameStore((s) => s.undo);
  const finishGame = useGameStore((s) => s.finishGame);
  const lessonContext = useGameStore((s) => s.lessonContext);
  const autoplayContext = useGameStore((s) => s.autoplayContext);
  const undoBank = useAutoPlayStore((s) => s.undoBank);
  const showScoreGraph = useSettingsStore((s) => s.showScoreGraph);

  const isBotVsBot = gameMode === 'botvsbot';
  const isAIGame = !!gameId && !isBotVsBot;
  const playerLabel = playerColor === Color.Black ? 'Black' : 'White';
  const aiLabel = playerColor === Color.Black ? 'White' : 'Black';

  function getWinnerName(winnerColor: Color): string {
    if (isBotVsBot) {
      const rank = winnerColor === Color.Black ? blackRank : whiteRank;
      const info = BOT_AVATARS[rank || '15k'] || BOT_AVATARS['15k'];
      return `${info.name} (${rank})`;
    }
    if (isAIGame) {
      return winnerColor === playerColor ? 'You' : 'AI';
    }
    return winnerColor === Color.Black ? 'Black' : 'White';
  }

  // "You win" reads naturally; everything else is third-person ("Black wins").
  function winsVerb(name: string): string {
    return name === 'You' ? 'win' : 'wins';
  }

  function getTurnText() {
    if (phase !== 'playing') {
      if (phase === 'finished' && result) {
        const name = getWinnerName(result.winner);
        return `${name} ${winsVerb(name)}`;
      }
      return phase === 'scoring' ? 'Scoring' : 'Game over';
    }
    if (isBotVsBot) {
      const rank = currentColor === Color.Black ? blackRank : whiteRank;
      const info = BOT_AVATARS[rank || '15k'] || BOT_AVATARS['15k'];
      return `${info.name}'s turn`;
    }
    if (aiThinking) return 'AI is thinking...';
    if (isAIGame) return 'Your turn';
    return `${currentColor === Color.Black ? 'Black' : 'White'} to play`;
  }

  return (
    <div className="game-controls">
      <div className="game-info">
        <div className="turn-indicator">
          <div className={`stone-icon ${currentColor === Color.Black ? 'black' : 'white'}`} />
          <span className={aiThinking ? 'ai-thinking' : ''}>{getTurnText()}</span>
        </div>

        {isAIGame && (
          <div className="matchup">
            You ({playerLabel}) vs AI {targetRank} ({aiLabel})
          </div>
        )}

        <div className="captures-display">
          <div className="capture-count">
            <div className="stone-icon black" />
            <span>Captures: {blackCaptures}</span>
          </div>
          <div className="capture-count">
            <div className="stone-icon white" />
            <span>Captures: {whiteCaptures}</span>
          </div>
        </div>

        <div className="move-counter">Move {moveCount}</div>

        {lessonContext ? <WhoIsWinning /> : showScoreGraph && <ScoreGraph />}
      </div>

      {phase === 'playing' && !isBotVsBot && (
        <div className="control-buttons">
          <button
            onClick={pass}
            className="btn btn-secondary"
            disabled={aiThinking}
          >
            Pass
          </button>
          {!isRanked && moveCount > 0 && (
            autoplayContext ? (
              // Auto-play ladder: undo is metered by the player-level bank (banked-3).
              <button
                onClick={undo}
                className="btn btn-secondary"
                disabled={aiThinking || autoCompleting || undoBank <= 0}
                title={undoBank > 0
                  ? `${undoBank} undo${undoBank === 1 ? '' : 's'} left — refills +1 each game`
                  : 'No undos left — finish a game to earn one'}
              >
                Undo ({undoBank})
              </button>
            ) : (
              // Casual / custom-unranked / lesson: unlimited undo.
              <button
                onClick={undo}
                className="btn btn-secondary"
                disabled={aiThinking || autoCompleting}
              >
                Undo
              </button>
            )
          )}
          {!!gameId && !isBotVsBot && moveCount >= 20 && (
            <button
              onClick={finishGame}
              className="btn btn-accent"
              disabled={aiThinking || autoCompleting}
            >
              {autoCompleting ? 'Finishing...' : 'Finish Game'}
            </button>
          )}
          <button onClick={resign} className="btn btn-danger" disabled={autoCompleting || aiThinking}>
            Resign
          </button>
        </div>
      )}

      {phase === 'finished' && result && (
        // Lesson 5 game uses its own kid-friendly modal + compact panel pair.
        // Auto-play (ranked Play) games use AutoPlayGameEndPanel which reopens
        // the AutoPlayGameEndModal. Everything else uses GameEndPanel (compact
        // "See results" pill) plus GameEndModal (mounted at App level).
        lessonContext
          ? <LessonGameEndPanel />
          : autoplayContext
            ? <AutoPlayGameEndPanel />
            : <GameEndPanel />
      )}
    </div>
  );
}
