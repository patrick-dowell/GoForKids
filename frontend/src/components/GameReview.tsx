import { useMemo } from 'react';
import { useGameStore } from '../store/gameStore';
import { useGameReviewStore } from '../store/gameReviewStore';
import { buildReview, DEMO_REVIEW_GAME, type ReviewHighlight } from '../learn/gameReview';
import { DiagramBoard } from './DiagramBoard';
import { ConceptLink } from './ConceptLink';
import { getConcept } from '../learn/concepts';
import { useReplayStore } from '../store/replayStore';
import { Color, type Stone } from '../engine/types';
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
  const demo = useGameReviewStore((s) => s.demo);
  const close = useGameReviewStore((s) => s.close);

  // Pull the finished game once when the overlay is open.
  const game = useGameStore((s) => s._game);
  const playerColor = useGameStore((s) => s.playerColor);
  const boardSize = useGameStore((s) => s.boardSize);
  const scoreHistory = useGameStore((s) => s.scoreHistory);

  const highlights = useMemo<ReviewHighlight[]>(() => {
    if (!isOpen) return [];
    if (demo) {
      return buildReview(
        DEMO_REVIEW_GAME.moves,
        DEMO_REVIEW_GAME.scoreHistory,
        DEMO_REVIEW_GAME.playerColor,
        DEMO_REVIEW_GAME.size,
      );
    }
    // playerColor is Black/White in any real game (never Empty). Pass handicap
    // stones so the snapshots aren't missing Black's setup in handicap games.
    return buildReview(game.moveHistory, scoreHistory, playerColor as Stone, boardSize, game.handicapStones);
  }, [isOpen, demo, game, scoreHistory, playerColor, boardSize]);

  // "Step through the game" → close the review and open this game in the
  // replay, where the same highlights appear as markers on the timeline.
  const openReplay = () => {
    const gs = useGameStore.getState();
    const sgf = gs._game.toSGF();
    close();
    gs.dismissGameEnd();
    useReplayStore.getState().loadGame(sgf, {
      playerColor: gs.playerColor === Color.Black ? 'black' : 'white',
      scoreHistory: gs.scoreHistory,
      opponentRank: gs.targetRank,
    });
  };

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
            A steady game — no big swings this time. Play another and watch for the moments that tip the score!
          </p>
        ) : (
          <div className="review-list">
            {highlights.map((h, i) => (
              <HighlightCard key={`${h.moveNumber}-${i}`} h={h} />
            ))}
          </div>
        )}

        {!demo && (
          <button className="review-replay-btn" onClick={openReplay}>
            Step through the game →
          </button>
        )}
        <button className="review-done" onClick={close}>
          Done
        </button>
      </div>
    </div>
  );
}

function HighlightCard({ h }: { h: ReviewHighlight }) {
  const concept = h.conceptId ? getConcept(h.conceptId) : undefined;
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
            Learn: <ConceptLink id={concept.id} />
          </div>
        )}
      </div>
    </div>
  );
}
