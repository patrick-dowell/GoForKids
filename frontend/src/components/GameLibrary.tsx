import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useLibraryStore, type SavedGame, type GameType } from '../store/libraryStore';
import { useProfileStore } from '../store/profileStore';

interface GameLibraryProps {
  onSelectGame: (game: SavedGame) => void;
  onClose: () => void;
}

type Filter = 'all' | GameType;

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}

function gameTypeOf(g: SavedGame): GameType {
  return g.gameType ?? 'human-vs-bot';
}

function boardSizeFromSgf(sgf: string): number | undefined {
  const m = sgf.match(/SZ\[(\d+)\]/);
  return m ? Number(m[1]) : undefined;
}

export function GameLibrary({ onSelectGame, onClose }: GameLibraryProps) {
  const games = useLibraryStore((s) => s.games);
  const loadFromStorage = useLibraryStore((s) => s.loadFromStorage);
  const deleteGame = useLibraryStore((s) => s.deleteGame);
  const setSharedId = useLibraryStore((s) => s.setSharedId);
  const clearAll = useLibraryStore((s) => s.clearAll);
  const [filter, setFilter] = useState<Filter>('all');
  const [confirmClear, setConfirmClear] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [shareErrorId, setShareErrorId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleShare = async (game: SavedGame) => {
    setShareErrorId(null);
    setUploadingId(game.id);
    try {
      const { id } = await api.uploadGame(game, {
        playerName: useProfileStore.getState().displayName || undefined,
        boardSize: boardSizeFromSgf(game.sgf),
      });
      setSharedId(game.id, id);
    } catch (e) {
      console.warn('Game upload failed:', e);
      setShareErrorId(game.id);
    } finally {
      setUploadingId(null);
    }
  };

  const handleCopyCode = async (game: SavedGame) => {
    if (!game.sharedId) return;
    // On the web, copy a ready-to-open link; in the iOS app (app:// origin)
    // a URL to our own scheme is useless to a friend — copy the bare code.
    const origin = window.location.origin;
    const text = origin.startsWith('http')
      ? `${origin}${window.location.pathname}?shared=${game.sharedId}`
      : game.sharedId;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(game.id);
      setTimeout(() => setCopiedId((c) => (c === game.id ? null : c)), 1500);
    } catch {
      // Clipboard unavailable (older WKWebView) — the code is visible anyway.
    }
    // Self-heal: uploads can be lost server-side (an API deploy's disk swap
    // ate one on 2026-07-02). Verify in the background; clear the stale code
    // ONLY on a definitive not-found — a network error proves nothing.
    api.fetchSharedGame(game.sharedId).catch((e) => {
      if (e instanceof Error && /not found/i.test(e.message)) {
        console.warn(`[share] server lost ${game.sharedId} — reverting to Share`);
        setSharedId(game.id, undefined);
        setCopiedId(null);
      }
    });
  };

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  const yourGamesCount = games.filter((g) => gameTypeOf(g) === 'human-vs-bot').length;
  const observedCount = games.filter((g) => gameTypeOf(g) === 'bot-vs-bot').length;

  const visible = filter === 'all'
    ? games
    : games.filter((g) => gameTypeOf(g) === filter);

  const handleClearAll = () => {
    clearAll();
    setConfirmClear(false);
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog" style={{ width: 520, maxHeight: '80vh' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>Game Library</h2>
          <button onClick={onClose} className="btn btn-secondary">Close</button>
        </div>

        <div className="library-tabs">
          <button
            className={`library-tab${filter === 'all' ? ' active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All <span className="library-tab-count">{games.length}</span>
          </button>
          <button
            className={`library-tab${filter === 'human-vs-bot' ? ' active' : ''}`}
            onClick={() => setFilter('human-vs-bot')}
          >
            Your games <span className="library-tab-count">{yourGamesCount}</span>
          </button>
          <button
            className={`library-tab${filter === 'bot-vs-bot' ? ' active' : ''}`}
            onClick={() => setFilter('bot-vs-bot')}
          >
            Observed <span className="library-tab-count">{observedCount}</span>
          </button>
        </div>

        {visible.length === 0 ? (
          <div className="library-empty">
            {games.length === 0
              ? 'No games yet. Finish a game to see it here.'
              : filter === 'human-vs-bot'
                ? 'No games against a bot yet.'
                : 'No observed bot-vs-bot games yet.'}
          </div>
        ) : (
          <div className="library-list">
            {visible.map((game) => {
              const type = gameTypeOf(game);
              const isBotVsBot = type === 'bot-vs-bot';
              return (
                <div key={game.id} className="library-item">
                  <div className="library-item-main" onClick={() => onSelectGame(game)}>
                    <div className="library-item-header">
                      <span className="library-rank">
                        {isBotVsBot
                          ? `${game.blackRank ?? '?'} vs ${game.whiteRank ?? '?'}`
                          : `vs ${game.opponentRank}`}
                      </span>
                      <span className="library-date">{formatDate(game.date)}</span>
                    </div>
                    <div className="library-result">{game.result}</div>
                    <div className="library-meta">
                      {game.moveCount} moves
                      {isBotVsBot
                        ? ' · Observed'
                        : ` · You played ${game.playerColor}${game.isRanked ? ' · Ranked' : ''}`}
                    </div>
                  </div>
                  {game.sharedId ? (
                    <button
                      className="library-share shared"
                      onClick={(e) => { e.stopPropagation(); handleCopyCode(game); }}
                      title="Copy share link"
                    >
                      {copiedId === game.id ? 'Copied!' : game.sharedId}
                    </button>
                  ) : (
                    <button
                      className="library-share"
                      disabled={uploadingId === game.id}
                      onClick={(e) => { e.stopPropagation(); handleShare(game); }}
                      title="Upload this game so a friend can replay it"
                    >
                      {uploadingId === game.id ? 'Sharing…' : shareErrorId === game.id ? 'Retry' : 'Share'}
                    </button>
                  )}
                  <button
                    className="library-delete"
                    onClick={(e) => { e.stopPropagation(); deleteGame(game.id); }}
                    title="Remove from library"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {games.length > 0 && (
          <div className="library-footer">
            {confirmClear ? (
              <>
                <span className="library-confirm-text">Clear all {games.length} saved games?</span>
                <button className="btn btn-secondary" onClick={() => setConfirmClear(false)}>
                  Cancel
                </button>
                <button className="btn btn-danger" onClick={handleClearAll}>
                  Clear all
                </button>
              </>
            ) : (
              <button className="btn btn-secondary library-clear-btn" onClick={() => setConfirmClear(true)}>
                Clear all saved games
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
