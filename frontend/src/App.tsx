import { useState, useEffect } from 'react';
import { GoBoard } from './board/GoBoard';
import { GameControls } from './components/GameControls';
import { NewGameDialog } from './components/NewGameDialog';
import { StudyMode } from './components/StudyMode';
import { GameLibrary } from './components/GameLibrary';
import { useGameStore } from './store/gameStore';
import { useLibraryStore, type SavedGame } from './store/libraryStore';
import './App.css';

/** Sync game ID to/from the URL hash */
function useGameIdInUrl() {
  const gameId = useGameStore((s) => s.gameId);

  // Push game ID into the URL when it changes
  useEffect(() => {
    if (gameId) {
      window.history.replaceState(null, '', `#/game/${gameId}`);
    } else {
      // Only clear if we're on a game URL
      if (window.location.hash.startsWith('#/game/')) {
        window.history.replaceState(null, '', '#/');
      }
    }
  }, [gameId]);

  // On mount, check if there's a game ID in the URL to restore
  useEffect(() => {
    const hash = window.location.hash;
    const match = hash.match(/^#\/game\/(.+)$/);
    if (match) {
      // TODO: could restore from backend here via api.getGame(match[1])
      // For now just note it — the game would need to still exist in backend memory
      console.log('Game ID from URL:', match[1]);
    }
  }, []);
}

function App() {
  const [showNewGame, setShowNewGame] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showStudy, setShowStudy] = useState(false);
  const phase = useGameStore((s) => s.phase);
  const targetRank = useGameStore((s) => s.targetRank);
  const gameId = useGameStore((s) => s.gameId);

  useGameIdInUrl();

  // Load library on mount
  useEffect(() => {
    useLibraryStore.getState().loadFromStorage();
  }, []);

  const handleSelectGame = (saved: SavedGame) => {
    setShowLibrary(false);
    if (saved.gameId) {
      setShowStudy(true);
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">GoForKids</h1>
        <div className="header-controls">
          <span className="rank-display">vs {targetRank}</span>
          <button
            onClick={() => setShowLibrary(true)}
            className="btn btn-secondary"
          >
            Library
          </button>
          {phase === 'finished' && gameId && (
            <button
              onClick={() => setShowStudy(!showStudy)}
              className="btn btn-secondary"
            >
              {showStudy ? 'Hide Study' : 'Study'}
            </button>
          )}
          <button
            onClick={() => setShowNewGame(true)}
            className="btn btn-primary"
          >
            New Game
          </button>
        </div>
      </header>

      <main className="game-layout">
        <div className="board-container">
          <GoBoard />
        </div>
        <aside className="side-panel">
          {showStudy && gameId ? (
            <StudyMode gameId={gameId} onClose={() => setShowStudy(false)} />
          ) : (
            <GameControls />
          )}
        </aside>
      </main>

      {showNewGame && (
        <NewGameDialog onClose={() => { setShowNewGame(false); setShowStudy(false); }} />
      )}

      {showLibrary && (
        <GameLibrary
          onSelectGame={handleSelectGame}
          onClose={() => setShowLibrary(false)}
        />
      )}
    </div>
  );
}

export default App;
