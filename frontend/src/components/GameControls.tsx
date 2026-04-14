import { useGameStore } from '../store/gameStore';
import { Color } from '../engine/types';

export function GameControls() {
  const phase = useGameStore((s) => s.phase);
  const currentColor = useGameStore((s) => s.currentColor);
  const playerColor = useGameStore((s) => s.playerColor);
  const moveCount = useGameStore((s) => s.moveCount);
  const result = useGameStore((s) => s.result);
  const isRanked = useGameStore((s) => s.isRanked);
  const blackCaptures = useGameStore((s) => s.blackCaptures);
  const whiteCaptures = useGameStore((s) => s.whiteCaptures);
  const aiThinking = useGameStore((s) => s.aiThinking);
  const gameId = useGameStore((s) => s.gameId);
  const targetRank = useGameStore((s) => s.targetRank);
  const pass = useGameStore((s) => s.pass);
  const resign = useGameStore((s) => s.resign);
  const undo = useGameStore((s) => s.undo);

  const isAIGame = !!gameId;
  const isPlayerTurn = !isAIGame || currentColor === playerColor;
  const playerLabel = playerColor === Color.Black ? 'Black' : 'White';
  const aiLabel = playerColor === Color.Black ? 'White' : 'Black';

  function getTurnText() {
    if (phase !== 'playing') {
      if (phase === 'finished' && result) {
        const winner = result.winner === Color.Black ? 'Black' : 'White';
        if (isAIGame) {
          return result.winner === playerColor ? 'You win!' : 'AI wins';
        }
        return `${winner} wins`;
      }
      return phase === 'scoring' ? 'Scoring' : 'Game over';
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
      </div>

      {phase === 'playing' && (
        <div className="control-buttons">
          <button
            onClick={pass}
            className="btn btn-secondary"
            disabled={aiThinking}
          >
            Pass
          </button>
          {!isRanked && moveCount > 0 && (
            <button
              onClick={undo}
              className="btn btn-secondary"
              disabled={aiThinking}
            >
              Undo
            </button>
          )}
          <button onClick={resign} className="btn btn-danger">
            Resign
          </button>
        </div>
      )}

      {phase === 'finished' && result && (
        <div className="game-result">
          <div className="result-detail">
            {result.blackScore === 0 && result.whiteScore === 0 ? (
              // Resignation — no score to show
              <div className="result-headline">
                {isAIGame
                  ? result.winner === playerColor ? 'You win by resignation!' : 'AI wins by resignation'
                  : `${result.winner === Color.Black ? 'Black' : 'White'} wins by resignation`}
              </div>
            ) : (
              // Scored game — show territory breakdown
              <>
                <div className="result-headline">
                  {isAIGame
                    ? result.winner === playerColor ? 'You win!' : 'AI wins'
                    : `${result.winner === Color.Black ? 'Black' : 'White'} wins`}
                  {' by '}
                  {Math.abs(result.blackScore - result.whiteScore).toFixed(1)} points
                </div>
                <div className="score-breakdown">
                  <div className="score-row">
                    <div className="score-label"><div className="stone-icon black" /> Black</div>
                    <div className="score-values">
                      <span>{result.blackTerritory} territory</span>
                      <span>{result.blackCaptures} captures</span>
                    </div>
                  </div>
                  <div className="score-row">
                    <div className="score-label"><div className="stone-icon white" /> White</div>
                    <div className="score-values">
                      <span>{result.whiteTerritory} territory</span>
                      <span>{result.whiteCaptures} captures</span>
                      <span>{result.komi} komi</span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
