import { useState, useEffect } from 'react';

interface MoveAnalysisData {
  move_number: number;
  color: string;
  point: { row: number; col: number } | null;
  winrate_before: number;
  winrate_after: number;
  score_delta: number;
  is_critical: boolean;
  mistake_type: string | null;
  explanation: string | null;
  alternatives: { row: number; col: number; score: number }[];
}

interface GameAnalysis {
  game_id: string;
  moves: MoveAnalysisData[];
  critical_moments: number[];
  summary: string | null;
}

interface StudyModeProps {
  gameId: string;
  onClose: () => void;
}

export function StudyMode({ gameId, onClose }: StudyModeProps) {
  const [analysis, setAnalysis] = useState<GameAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentMoveIdx, setCurrentMoveIdx] = useState(0);

  useEffect(() => {
    async function fetchAnalysis() {
      setLoading(true);
      setError(null);
      try {
        const apiBase = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';
        const res = await fetch(`${apiBase}/api/study/${gameId}/analyze`, {
          method: 'POST',
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.detail || 'Analysis failed');
        }
        const data = await res.json();
        setAnalysis(data);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    fetchAnalysis();
  }, [gameId]);

  const currentMove = analysis?.moves[currentMoveIdx];

  return (
    <div className="study-mode">
      <div className="study-header">
        <h2>Study Mode</h2>
        <button onClick={onClose} className="btn btn-secondary">Close</button>
      </div>

      {loading && <div className="study-loading">Analyzing game...</div>}

      {error && (
        <div className="study-error">
          Analysis unavailable: {error}
          <p className="study-hint">
            Study mode requires KataGo to be running. You can still review the game moves.
          </p>
        </div>
      )}

      {analysis && (
        <>
          {analysis.summary && (
            <div className="study-summary">{analysis.summary}</div>
          )}

          <div className="study-timeline">
            <div className="timeline-controls">
              <button
                onClick={() => setCurrentMoveIdx(Math.max(0, currentMoveIdx - 1))}
                disabled={currentMoveIdx === 0}
                className="btn btn-secondary"
              >
                Prev
              </button>
              <span className="move-label">
                Move {currentMove?.move_number ?? 0} / {analysis.moves.length}
              </span>
              <button
                onClick={() => setCurrentMoveIdx(Math.min(analysis.moves.length - 1, currentMoveIdx + 1))}
                disabled={currentMoveIdx >= analysis.moves.length - 1}
                className="btn btn-secondary"
              >
                Next
              </button>
            </div>

            <div className="timeline-bar">
              {analysis.moves.map((m, i) => (
                <div
                  key={i}
                  className={`timeline-dot ${m.is_critical ? 'critical' : ''} ${m.mistake_type ? `mistake-${m.mistake_type}` : ''} ${i === currentMoveIdx ? 'active' : ''}`}
                  onClick={() => setCurrentMoveIdx(i)}
                  title={`Move ${m.move_number}${m.mistake_type ? ` (${m.mistake_type})` : ''}`}
                />
              ))}
            </div>
          </div>

          {currentMove && (
            <div className="study-move-detail">
              <div className="move-eval">
                <div className="eval-bar">
                  <div className="eval-label">Win%</div>
                  <div className="eval-value">
                    {(currentMove.winrate_after * 100).toFixed(0)}%
                  </div>
                </div>
                <div className="eval-bar">
                  <div className="eval-label">Score</div>
                  <div className="eval-value">
                    {currentMove.score_delta > 0 ? '+' : ''}
                    {currentMove.score_delta.toFixed(1)}
                  </div>
                </div>
                {currentMove.mistake_type && (
                  <div className={`mistake-badge ${currentMove.mistake_type}`}>
                    {currentMove.mistake_type}
                  </div>
                )}
              </div>

              {currentMove.explanation && (
                <div className="move-explanation">
                  {currentMove.explanation}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
