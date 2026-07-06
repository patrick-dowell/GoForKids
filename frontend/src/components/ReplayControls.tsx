import { useState } from 'react';
import { useReplayStore } from '../store/replayStore';
import { getKataGoBridge } from '../api/nativeKataGo';
import { api } from '../api/client';
import { useLibraryStore } from '../store/libraryStore';
import { useProfileStore } from '../store/profileStore';
import { useGameReviewStore } from '../store/gameReviewStore';
import { ConceptLink } from './ConceptLink';
import { getConcept } from '../learn/concepts';
import { ReplayScoreGraph } from './ScoreGraph';

/** Web app origin for share links. Inside the native app (app:// scheme) the
 *  page origin is useless to a friend — fall back to the deployed web URL. */
const WEB_BASE = import.meta.env.VITE_WEB_BASE_URL
  ?? (window.location.origin.startsWith('http')
    ? window.location.origin + window.location.pathname.replace(/\/$/, '')
    : 'https://goforkids-web.onrender.com');

function shareLinkFor(sharedId: string): string {
  return `${WEB_BASE}/?shared=${sharedId}`;
}

/**
 * Share the replayed game (milestone §5 — moved here from the Library per
 * Patrick's feedback 2026-07-02): upload once, then the button becomes the
 * link — tap to copy it AND open it in the browser, so you can see where
 * your game lives online and send that URL to anyone.
 */
function ShareGameButton() {
  const libraryId = useReplayStore((s) => s.libraryId);
  const replaySharedId = useReplayStore((s) => s.sharedId);
  const libraryGame = useLibraryStore((s) =>
    libraryId ? s.games.find((g) => g.id === libraryId) : undefined,
  );
  const setSharedId = useLibraryStore((s) => s.setSharedId);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);

  // Live code from the library entry (updates after upload); a replay opened
  // FROM a share link carries its code directly.
  const sharedId = libraryGame?.sharedId ?? replaySharedId ?? undefined;

  // Demo replays and other unsharable sources: nothing to share.
  if (!libraryGame && !sharedId) return null;

  const handleShare = async () => {
    if (!libraryGame) return;
    setError(false);
    setUploading(true);
    try {
      const sizeMatch = libraryGame.sgf.match(/SZ\[(\d+)\]/);
      const { id } = await api.uploadGame(libraryGame, {
        playerName: useProfileStore.getState().displayName || undefined,
        boardSize: sizeMatch ? Number(sizeMatch[1]) : undefined,
      });
      setSharedId(libraryGame.id, id);
    } catch (e) {
      console.warn('Game upload failed:', e);
      setError(true);
    } finally {
      setUploading(false);
    }
  };

  const handleOpenLink = () => {
    if (!sharedId) return;
    const link = shareLinkFor(sharedId);
    navigator.clipboard?.writeText(link).catch(() => { /* code stays visible */ });
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    // Native app: WKUIDelegate hands _blank opens to Safari.
    window.open(link, '_blank', 'noopener,noreferrer');
    // Self-heal: uploads can be lost server-side (deploy-window incident,
    // 2026-07-02). Clear the stale code ONLY on a definitive not-found so
    // the Share button comes back; a network error proves nothing.
    if (libraryGame) {
      api.fetchSharedGame(sharedId).catch((e) => {
        if (e instanceof Error && /not found/i.test(e.message)) {
          console.warn(`[share] server lost ${sharedId} — reverting to Share`);
          setSharedId(libraryGame.id, undefined);
        }
      });
    }
  };

  if (sharedId) {
    return (
      <button
        onClick={handleOpenLink}
        className="btn btn-secondary replay-share-link"
        style={{ fontSize: 12 }}
        title={shareLinkFor(sharedId)}
      >
        {copied ? 'Link copied!' : `🔗 ${sharedId} ↗`}
      </button>
    );
  }
  return (
    <button
      onClick={handleShare}
      disabled={uploading}
      className="btn btn-secondary"
      style={{ fontSize: 12 }}
      title="Upload this game and get a link anyone can open"
    >
      {uploading ? 'Sharing…' : error ? 'Retry share' : 'Share game'}
    </button>
  );
}

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
  const returnToReview = useReplayStore((s) => s.returnToReview);

  // §4a quick replay: this replay was opened from a tapped highlight card —
  // "back" reopens the Play-of-the-Game overlay instead of tearing down to
  // home. The finished game is still in gameStore (dismissGameEnd doesn't
  // clear it), so the review rebuilds from the same data.
  const backToHighlights = () => {
    const target = returnToReview;
    useReplayStore.getState().close();
    if (target === 'demo') useGameReviewStore.getState().openDemo();
    else useGameReviewStore.getState().open();
  };

  const hasHighlights = highlights.length > 0;
  const currentHighlight = highlights.find((h) => h.moveNumber === currentMove);
  const concept = currentHighlight?.conceptId ? getConcept(currentHighlight.conceptId) : undefined;
  // "The good line" for the mistake under the cursor — a point on the board
  // is pulsing when this is set (see replayStore._maybeAnalyzeBetterMove).
  const betterMove = useReplayStore((s) => s.betterMove);
  const betterPts = currentHighlight?.swing !== undefined
    ? Math.max(1, Math.round(Math.abs(currentHighlight.swing)))
    : null;

  // With score data, the score graph IS the scrubber (arc + key-move dots +
  // "Move N / M" header + drag-to-seek) — the panel has no vertical room for
  // both, so the plain slider + marker strip render only as the fallback.
  // Must mirror ReplayScoreGraph's own render guard (it drops the move-0
  // seed point), else a degenerate history leaves NO scrubber at all.
  const hasScoreGraph = useReplayStore(
    (s) => s.scoreHistory.filter((p) => p.move >= 1).length >= 2,
  );

  return (
    <div className="replay-controls">
      {/* When this replay is a drill-down from the highlights reel, the
          header IS the way back: iOS-style back button top-left, accent-
          colored so it can't be missed (Patrick's device pass: the old
          Close-styled "★ Highlights" next to Close got overlooked). The
          "Game Replay" title carries no information a kid needs — it yields
          its slot to the back affordance. */}
      <div className="replay-header">
        {returnToReview ? (
          <button onClick={backToHighlights} className="btn btn-primary replay-back-highlights">
            ← ★ Back to Highlights
          </button>
        ) : (
          <h3>Game Replay</h3>
        )}
        <button onClick={onClose} className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }}>
          Close
        </button>
      </div>

      {/* One line, not two — the replay panel fits the viewport with zero
          slack (layout policy), and the score graph needed the row back. */}
      {(opponentRank || gameResult) && (
        <div className="replay-meta">
          {opponentRank ? `vs ${opponentRank}` : ''}
          {opponentRank && gameResult ? ' · ' : ''}
          {gameResult}
        </div>
      )}

      {hasScoreGraph ? (
        <ReplayScoreGraph />
      ) : (
        <>
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
        </>
      )}

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
          {betterMove && (
            <div className="replay-better-move" style={{ marginTop: 4, fontSize: 13 }}>
              ⭐ A better spot is glowing on the board
              {betterPts !== null ? ` — worth about ${betterPts} more point${betterPts === 1 ? '' : 's'}` : ''}.
            </div>
          )}
          {concept && (
            <div style={{ marginTop: 4, fontSize: 13, opacity: 0.9 }}>
              Learn: <ConceptLink id={concept.id} />
            </div>
          )}
        </div>
      )}

      {/* Key-move skip — its own row so the main controls don't crowd. */}
      {hasHighlights && (
        <div style={{ display: 'flex', gap: 8, margin: '4px 0' }}>
          <button onClick={prevHighlight} className="replay-btn" style={{ flex: 1, width: 'auto', fontSize: 13 }} aria-label="Previous key move">
            ★ ◀ Prev key
          </button>
          <button onClick={nextHighlight} className="replay-btn" style={{ flex: 1, width: 'auto', fontSize: 13 }} aria-label="Next key move">
            Next key ▶ ★
          </button>
        </div>
      )}

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
          {getKataGoBridge() ? 'Share SGF' : 'Download SGF'}
        </button>
        <ShareGameButton />
      </div>

      <div className="replay-hint">
        {hasHighlights ? '★ markers are the key moves — tap to jump there' : '← → arrow keys to step through moves'}
      </div>
    </div>
  );
}
