import { useReplayStore } from '../store/replayStore';

export function ReplayControls() {
  const currentMove = useReplayStore((s) => s.currentMove);
  const totalMoves = useReplayStore((s) => s.totalMoves);
  const gameResult = useReplayStore((s) => s.gameResult);
  const opponentRank = useReplayStore((s) => s.opponentRank);
  const autoPlaying = useReplayStore((s) => s.autoPlaying);
  const autoPlaySpeed = useReplayStore((s) => s.autoPlaySpeed);
  const nextMove = useReplayStore((s) => s.nextMove);
  const prevMove = useReplayStore((s) => s.prevMove);
  const firstMove = useReplayStore((s) => s.firstMove);
  const lastMovePos = useReplayStore((s) => s.lastMovePos);
  const goToMove = useReplayStore((s) => s.goToMove);
  const toggleAutoPlay = useReplayStore((s) => s.toggleAutoPlay);
  const setAutoPlaySpeed = useReplayStore((s) => s.setAutoPlaySpeed);
  const downloadSGF = useReplayStore((s) => s.downloadSGF);
  const close = useReplayStore((s) => s.close);

  return (
    <div className="replay-controls">
      <div className="replay-header">
        <h3>Game Replay</h3>
        <button onClick={close} className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }}>
          Close
        </button>
      </div>

      {opponentRank && <div className="replay-meta">vs {opponentRank}</div>}
      {gameResult && <div className="replay-result">{gameResult}</div>}

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
        <button onClick={firstMove} disabled={currentMove === 0} className="replay-btn">⏮</button>
        <button onClick={prevMove} disabled={currentMove === 0} className="replay-btn">◀</button>
        <button onClick={toggleAutoPlay} className="replay-btn replay-btn-play">
          {autoPlaying ? '⏸' : '▶'}
        </button>
        <button onClick={nextMove} disabled={currentMove >= totalMoves} className="replay-btn">▶</button>
        <button onClick={lastMovePos} disabled={currentMove >= totalMoves} className="replay-btn">⏭</button>
      </div>

      {/* Autoplay speed */}
      <div className="speed-control">
        <label>Playback speed</label>
        <div className="speed-buttons">
          <button
            className={`speed-btn ${autoPlaySpeed === 1200 ? 'active' : ''}`}
            onClick={() => setAutoPlaySpeed(1200)}
          >Slow</button>
          <button
            className={`speed-btn ${autoPlaySpeed === 600 ? 'active' : ''}`}
            onClick={() => setAutoPlaySpeed(600)}
          >Normal</button>
          <button
            className={`speed-btn ${autoPlaySpeed === 200 ? 'active' : ''}`}
            onClick={() => setAutoPlaySpeed(200)}
          >Fast</button>
        </div>
      </div>

      <div className="replay-actions">
        <button onClick={downloadSGF} className="btn btn-secondary" style={{ fontSize: 12 }}>
          Download SGF
        </button>
      </div>

      <div className="replay-hint">
        ← → arrow keys to step through moves
      </div>
    </div>
  );
}
