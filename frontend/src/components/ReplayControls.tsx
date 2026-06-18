import { useReplayStore } from '../store/replayStore';
import { ConceptLink } from './ConceptLink';
import { getConcept } from '../learn/concepts';

interface ReplayControlsProps {
  /** Called when the user taps Close. Lets the parent route back to home
   *  in addition to closing the replay store (replay-store close alone left
   *  the user on the live-game layout — bug #4 from TestFlight 2026-05-14). */
  onClose: () => void;
}

export function ReplayControls({ onClose }: ReplayControlsProps) {
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
  const highlights = useReplayStore((s) => s.highlights);
  const nextHighlight = useReplayStore((s) => s.nextHighlight);
  const prevHighlight = useReplayStore((s) => s.prevHighlight);

  const hasHighlights = highlights.length > 0;
  const currentHighlight = highlights.find((h) => h.moveNumber === currentMove);
  const concept = currentHighlight?.conceptId ? getConcept(currentHighlight.conceptId) : undefined;

  return (
    <div className="replay-controls">
      <div className="replay-header">
        <h3>Game Replay</h3>
        <button onClick={onClose} className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }}>
          Close
        </button>
      </div>

      {opponentRank && <div className="replay-meta">vs {opponentRank}</div>}
      {gameResult && <div className="replay-result">{gameResult}</div>}

      <div className="replay-position">
        Move {currentMove} / {totalMoves}
        {currentHighlight && <span style={{ color: currentHighlight.kind === 'good' ? '#ffd36e' : '#9bd1ff' }}> ★ key move</span>}
      </div>

      {/* Timeline with Play-of-the-Game markers above the scrubber. */}
      <div className="replay-slider" style={{ position: 'relative' }}>
        {hasHighlights && totalMoves > 0 && (
          <div style={{ position: 'relative', height: 12, margin: '0 6px 2px' }}>
            {highlights.map((h) => (
              <button
                key={h.moveNumber}
                onClick={() => goToMove(h.moveNumber)}
                title={`Move ${h.moveNumber}: ${h.headline}`}
                aria-label={`Key move ${h.moveNumber}`}
                style={{
                  position: 'absolute',
                  left: `calc(${(h.moveNumber / totalMoves) * 100}% - 4px)`,
                  top: 0,
                  width: 8,
                  height: 12,
                  padding: 0,
                  border: 'none',
                  borderRadius: 2,
                  cursor: 'pointer',
                  background: h.kind === 'good' ? '#ffd36e' : '#9bd1ff',
                  opacity: h.moveNumber === currentMove ? 1 : 0.7,
                  outline: h.moveNumber === currentMove ? '2px solid #fff' : 'none',
                }}
              />
            ))}
          </div>
        )}
        <input
          type="range"
          min={0}
          max={totalMoves}
          value={currentMove}
          onChange={(e) => goToMove(parseInt(e.target.value))}
        />
      </div>

      {/* Explanation for the key move you're currently on. */}
      {currentHighlight && (
        <div
          className="replay-highlight-note"
          style={{
            margin: '6px 0 4px',
            padding: '10px 12px',
            borderRadius: 8,
            background: 'rgba(255,255,255,0.05)',
            borderLeft: `3px solid ${currentHighlight.kind === 'good' ? '#ffd36e' : '#9bd1ff'}`,
            fontSize: 14,
          }}
        >
          <div style={{ fontWeight: 600 }}>{currentHighlight.headline}</div>
          {concept && (
            <div style={{ marginTop: 4, fontSize: 13, opacity: 0.9 }}>
              Learn: <ConceptLink id={concept.id} />
            </div>
          )}
        </div>
      )}

      <div className="replay-buttons">
        <button onClick={firstMove} disabled={currentMove === 0} className="replay-btn">⏮</button>
        {hasHighlights && (
          <button onClick={prevHighlight} className="replay-btn" title="Previous key move" aria-label="Previous key move">★◀</button>
        )}
        <button onClick={prevMove} disabled={currentMove === 0} className="replay-btn">◀</button>
        <button onClick={toggleAutoPlay} className="replay-btn replay-btn-play">
          {autoPlaying ? '⏸' : '▶'}
        </button>
        <button onClick={nextMove} disabled={currentMove >= totalMoves} className="replay-btn">▶</button>
        {hasHighlights && (
          <button onClick={nextHighlight} className="replay-btn" title="Next key move" aria-label="Next key move">★▶</button>
        )}
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
        {hasHighlights ? '★ markers are the key moves — tap to jump there' : '← → arrow keys to step through moves'}
      </div>
    </div>
  );
}
