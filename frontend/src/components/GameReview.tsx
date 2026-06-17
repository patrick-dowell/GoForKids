import { useMemo } from 'react';
import { useGameStore } from '../store/gameStore';
import { useGameReviewStore } from '../store/gameReviewStore';
import { buildReview, type ReviewHighlight } from '../learn/gameReview';
import { DiagramBoard } from './DiagramBoard';
import { ConceptLink } from './ConceptLink';
import { getConcept } from '../learn/concepts';
import './GameReview.css';

/**
 * "Play of the Game" review (fp 28). After a game, an opt-in highlights reel of
 * the few moments that mattered — good ones first (lead with glory), each tagged
 * with a concept that links into the glossary. Glanceable by default, deep on
 * demand: tap a concept to learn it, or just move on.
 *
 * Mounted once at App top level; shows when gameReviewStore.isOpen. Reads the
 * finished game straight from gameStore.
 */
export function GameReview() {
  const isOpen = useGameReviewStore((s) => s.isOpen);
  const close = useGameReviewStore((s) => s.close);

  // Pull the finished game once when the overlay is open.
  const game = useGameStore((s) => s._game);
  const playerColor = useGameStore((s) => s.playerColor);
  const boardSize = useGameStore((s) => s.boardSize);

  const highlights = useMemo<ReviewHighlight[]>(() => {
    if (!isOpen) return [];
    return buildReview(game.moveHistory, playerColor, boardSize);
  }, [isOpen, game, playerColor, boardSize]);

  if (!isOpen) return null;

  return (
    <div className="review-overlay" role="dialog" aria-modal="true" onClick={close}>
      <div className="review-panel" onClick={(e) => e.stopPropagation()}>
        <button className="review-close" onClick={close} aria-label="Close review">
          ×
        </button>
        <h1 className="review-title">Play of the Game</h1>

        {highlights.length === 0 ? (
          <p className="review-empty">
            A calm game — no big captures this time. Play another and watch for chances to put the bot in atari!
          </p>
        ) : (
          <div className="review-list">
            {highlights.map((h, i) => (
              <HighlightCard key={`${h.moveNumber}-${i}`} h={h} />
            ))}
          </div>
        )}

        <button className="review-done" onClick={close}>
          Done
        </button>
      </div>
    </div>
  );
}

function HighlightCard({ h }: { h: ReviewHighlight }) {
  const concept = getConcept(h.conceptId);
  return (
    <div className={'review-card review-card-' + h.kind}>
      <div className="review-card-board">
        <DiagramBoard size={h.position.size} stones={h.position.stones} highlight={h.position.highlight} px={150} />
      </div>
      <div className="review-card-text">
        <div className="review-card-move">Move {h.moveNumber}</div>
        <div className="review-card-headline">{h.headline}</div>
        {concept && (
          <div className="review-card-concept">
            Learn: <ConceptLink id={h.conceptId} />
          </div>
        )}
      </div>
    </div>
  );
}
