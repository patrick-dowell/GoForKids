import { useEffect } from 'react';
import { useLibraryStore, type SavedGame } from '../store/libraryStore';

interface GameLibraryProps {
  onSelectGame: (game: SavedGame) => void;
  onClose: () => void;
}

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

export function GameLibrary({ onSelectGame, onClose }: GameLibraryProps) {
  const games = useLibraryStore((s) => s.games);
  const loadFromStorage = useLibraryStore((s) => s.loadFromStorage);
  const deleteGame = useLibraryStore((s) => s.deleteGame);

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  return (
    <div className="dialog-overlay">
      <div className="dialog" style={{ width: 480, maxHeight: '70vh' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>Game Library</h2>
          <button onClick={onClose} className="btn btn-secondary">Close</button>
        </div>

        {games.length === 0 ? (
          <div className="library-empty">
            No games yet. Finish a game to see it here.
          </div>
        ) : (
          <div className="library-list">
            {games.map((game) => (
              <div key={game.id} className="library-item">
                <div className="library-item-main" onClick={() => onSelectGame(game)}>
                  <div className="library-item-header">
                    <span className="library-rank">vs {game.opponentRank}</span>
                    <span className="library-date">{formatDate(game.date)}</span>
                  </div>
                  <div className="library-result">{game.result}</div>
                  <div className="library-meta">
                    {game.moveCount} moves · You played {game.playerColor}
                    {game.isRanked ? ' · Ranked' : ''}
                  </div>
                </div>
                <button
                  className="library-delete"
                  onClick={(e) => { e.stopPropagation(); deleteGame(game.id); }}
                  title="Remove from library"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
