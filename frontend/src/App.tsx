import { useState, useEffect } from 'react';
import { GoBoard } from './board/GoBoard';
import { GameControls } from './components/GameControls';
import { NewGameDialog } from './components/NewGameDialog';
import { StudyMode } from './components/StudyMode';
import { GameLibrary } from './components/GameLibrary';
import { PlayerCard } from './components/PlayerCard';
import { CaptureAnimation } from './components/CaptureAnimation';
import { useGameStore } from './store/gameStore';
import { useLibraryStore, type SavedGame } from './store/libraryStore';
import { Color, oppositeColor } from './engine/types';
import './App.css';

function useGameIdInUrl() {
  const gameId = useGameStore((s) => s.gameId);
  useEffect(() => {
    if (gameId) {
      window.history.replaceState(null, '', `#/game/${gameId}`);
    } else if (window.location.hash.startsWith('#/game/')) {
      window.history.replaceState(null, '', '#/');
    }
  }, [gameId]);
}

function App() {
  const [showNewGame, setShowNewGame] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showStudy, setShowStudy] = useState(false);

  const phase = useGameStore((s) => s.phase);
  const targetRank = useGameStore((s) => s.targetRank);
  const gameId = useGameStore((s) => s.gameId);
  const currentColor = useGameStore((s) => s.currentColor);
  const playerColor = useGameStore((s) => s.playerColor);
  const playerAvatar = useGameStore((s) => s.playerAvatar);
  const botAvatar = useGameStore((s) => s.botAvatar);
  const botName = useGameStore((s) => s.botName);
  const blackCaptures = useGameStore((s) => s.blackCaptures);
  const whiteCaptures = useGameStore((s) => s.whiteCaptures);
  const aiThinking = useGameStore((s) => s.aiThinking);

  useGameIdInUrl();

  useEffect(() => {
    useLibraryStore.getState().loadFromStorage();
  }, []);

  const handleSelectGame = (saved: SavedGame) => {
    setShowLibrary(false);
    if (saved.gameId) setShowStudy(true);
  };

  const isAIGame = !!gameId;
  const opponentColor = oppositeColor(playerColor);

  // Figure out which captures belong to which player
  const playerCaptures = playerColor === Color.Black ? blackCaptures : whiteCaptures;
  const opponentCaptures = opponentColor === Color.Black ? blackCaptures : whiteCaptures;

  const isPlayerTurn = phase === 'playing' && currentColor === playerColor;
  const isOpponentTurn = phase === 'playing' && currentColor === opponentColor;

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">GoForKids</h1>
        <div className="header-controls">
          <button onClick={() => setShowLibrary(true)} className="btn btn-secondary">
            Library
          </button>
          {phase === 'finished' && gameId && (
            <button onClick={() => setShowStudy(!showStudy)} className="btn btn-secondary">
              {showStudy ? 'Hide Study' : 'Study'}
            </button>
          )}
          <button onClick={() => setShowNewGame(true)} className="btn btn-primary">
            New Game
          </button>
        </div>
      </header>

      <main className="game-layout" style={{ position: 'relative' }}>
        <CaptureAnimation />
        <aside className="avatar-panel">
          {/* Opponent at top */}
          <PlayerCard
            name={isAIGame ? `${botName} (${targetRank})` : 'Opponent'}
            avatarType={botAvatar}
            stoneColor={opponentColor}
            captures={opponentCaptures}
            isActive={isOpponentTurn}
            isThinking={aiThinking}
            isTop
          />

          {/* Player at bottom */}
          <PlayerCard
            name="You"
            avatarType={playerAvatar}
            stoneColor={playerColor}
            captures={playerCaptures}
            isActive={isPlayerTurn && !aiThinking}
          />
        </aside>

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
        <GameLibrary onSelectGame={handleSelectGame} onClose={() => setShowLibrary(false)} />
      )}
    </div>
  );
}

export default App;
