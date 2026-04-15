import { useReplayStore } from '../store/replayStore';

export function ReplayControls() {
  const currentMove = useReplayStore((s) => s.currentMove);
  const totalMoves = useReplayStore((s) => s.totalMoves);
  const gameResult = useReplayStore((s) => s.gameResult);
  const opponentRank = useReplayStore((s) => s.opponentRank);
  const nextMove = useReplayStore((s) => s.nextMove);
  const prevMove = useReplayStore((s) => s.prevMove);
  const firstMove = useReplayStore((s) => s.firstMove);
  const lastMovePos = useReplayStore((s) => s.lastMovePos);
  const goToMove = useReplayStore((s) => s.goToMove);
  const close = useReplayStore((s) => s.close);

  return (
    <div className="replay-controls">
      <div className="replay-header">
        <h3>Game Replay</h3>
        <button onClick={close} className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }}>
          Close
        </button>
      </div>

      {opponentRank && (
        <div className="replay-meta">vs {opponentRank}</div>
      )}
      {gameResult && (
        <div className="replay-result">{gameResult}</div>
      )}

      <div className="replay-position">
        Move {currentMove} / {totalMoves}
      </div>

      <div className="replay-slider">
        <input
          type="range"
          min={0}
          max={totalMoves}
          value={currentMove}
          onChange={(e) => goToMove(parseInt(e.target.value))}
        />
      </div>

      <div className="replay-buttons">
        <button onClick={firstMove} disabled={currentMove === 0} className="replay-btn">
          ⏮
        </button>
        <button onClick={prevMove} disabled={currentMove === 0} className="replay-btn">
          ◀
        </button>
        <button onClick={nextMove} disabled={currentMove >= totalMoves} className="replay-btn">
          ▶
        </button>
        <button onClick={lastMovePos} disabled={currentMove >= totalMoves} className="replay-btn">
          ⏭
        </button>
      </div>

      <div className="replay-hint">
        Use ← → arrow keys to step through moves
      </div>
    </div>
  );
}
