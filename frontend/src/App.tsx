import { useState, useEffect, useCallback } from 'react';
import { GoBoard } from './board/GoBoard';
import { GameControls } from './components/GameControls';
import { NewGameDialog } from './components/NewGameDialog';
import { StudyMode } from './components/StudyMode';
import { GameLibrary } from './components/GameLibrary';
import { PlayerCard } from './components/PlayerCard';
import { CaptureAnimation } from './components/CaptureAnimation';
import { ReplayControls } from './components/ReplayControls';
import { HomePage } from './components/HomePage';
import { LearnView } from './components/LearnView';
import { BotPassedModal } from './components/BotPassedModal';
import { LessonGameEndModal } from './components/LessonGameEndModal';
import { SettingsButton } from './components/SettingsButton';
import { useGameStore } from './store/gameStore';
import { useLearnStore } from './store/learnStore';
import { useLibraryStore, type SavedGame } from './store/libraryStore';
import { useReplayStore } from './store/replayStore';
import { useSettingsStore } from './store/settingsStore';
import { LESSONS } from './learn/lessons';
import { BOT_AVATARS } from './components/Avatar';
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
  const [showHome, setShowHome] = useState(true);
  const [showNewGame, setShowNewGame] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showStudy, setShowStudy] = useState(false);
  /** Tracks which lesson kicked off the currently-active game (for the
   *  "Next lesson" continuation on the game-end modal). Cleared on Move on. */
  const [activeGameLessonId, setActiveGameLessonId] = useState<string | null>(null);

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
  const gameMode = useGameStore((s) => s.gameMode);
  const blackRank = useGameStore((s) => s.blackRank);
  const whiteRank = useGameStore((s) => s.whiteRank);
  const botVsBotPaused = useGameStore((s) => s.botVsBotPaused);
  const botVsBotSpeed = useGameStore((s) => s.botVsBotSpeed);
  const togglePause = useGameStore((s) => s.toggleBotVsBotPause);
  const setSpeed = useGameStore((s) => s.setBotVsBotSpeed);

  useGameIdInUrl();

  useEffect(() => {
    useLibraryStore.getState().loadFromStorage();
  }, []);

  const replayActive = useReplayStore((s) => s.active);
  const loadReplay = useReplayStore((s) => s.loadGame);
  const replayNext = useReplayStore((s) => s.nextMove);
  const replayPrev = useReplayStore((s) => s.prevMove);

  const learnActive = useLearnStore((s) => s.active);
  const startLearn = useLearnStore((s) => s.start);
  const exitLearn = useLearnStore((s) => s.exit);
  const resumeLearnAt = useLearnStore((s) => s.resumeAt);
  const markLessonComplete = useLearnStore((s) => s.markComplete);
  const newGame = useGameStore((s) => s.newGame);
  const setTheme = useSettingsStore((s) => s.setTheme);

  const handleStartLearn = () => {
    // Testing mode: drop the user back to the classic board so the Cosmic Board
    // unlock at the end of lesson 4 actually feels like a transformation.
    setTheme('classic');
    setShowHome(false);
    startLearn();
  };

  const handleExitLearn = () => {
    exitLearn();
    setShowHome(true);
  };

  const handleStartGameLesson = (config: { boardSize: number; opponentRank: string }, lessonId: string) => {
    // Lesson 5 launches a real game vs the bot. Apply the unlocked Cosmic Board
    // theme so the reward feels meaningful even if the user had picked classic.
    markLessonComplete(lessonId);
    setTheme('cosmic');
    exitLearn();
    setShowHome(false);
    setActiveGameLessonId(lessonId);
    newGame({
      boardSize: config.boardSize,
      targetRank: config.opponentRank,
      useBackend: true,
      isRanked: false,
      gameMode: 'ai',
      playerColor: Color.Black,
      lessonContext: true,
    });
  };

  // Compute the next lesson after the game-kind lesson the player is in,
  // if any. Used to show "Next lesson →" on the lesson game-end modal.
  const nextLessonAfterGame = (() => {
    if (!activeGameLessonId) return null;
    const idx = LESSONS.findIndex((l) => l.id === activeGameLessonId);
    if (idx === -1 || idx + 1 >= LESSONS.length) return null;
    return idx + 1;
  })();

  const handleNextLessonAfterGame = () => {
    if (nextLessonAfterGame === null) return;
    setActiveGameLessonId(null);
    resumeLearnAt(nextLessonAfterGame);
  };

  const handleMoveOnFromLessonGame = () => {
    setActiveGameLessonId(null);
    setShowHome(true);
  };

  const handleSelectGame = (saved: SavedGame) => {
    setShowLibrary(false);
    setShowStudy(false);
    setShowHome(false);
    loadReplay(saved.sgf, {
      result: saved.result,
      playerColor: saved.playerColor,
      opponentRank: saved.opponentRank,
    });
  };

  const handleOpenNewGame = () => {
    setShowHome(false);
    setShowNewGame(true);
  };

  // Keyboard navigation for replay
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!useReplayStore.getState().active) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); replayNext(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); replayPrev(); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [replayNext, replayPrev]);

  const isBotVsBot = gameMode === 'botvsbot';
  const isAIGame = !!gameId;
  const opponentColor = oppositeColor(playerColor);

  // In bot-vs-bot mode, both are bots
  const blackBotInfo = isBotVsBot ? (BOT_AVATARS[blackRank || '15k'] || BOT_AVATARS['15k']) : null;
  const whiteBotInfo = isBotVsBot ? (BOT_AVATARS[whiteRank || '15k'] || BOT_AVATARS['15k']) : null;

  const isPlayerTurn = phase === 'playing' && currentColor === playerColor && !isBotVsBot;
  const isOpponentTurn = phase === 'playing' && currentColor === opponentColor && !isBotVsBot;

  // Lesson mode — full-screen, replaces all other views. The settings gear is
  // intentionally hidden here so the lesson UI stays focused; it returns once
  // the user is in a real game.
  if (learnActive) {
    return (
      <div className="app">
        <LearnView onExit={handleExitLearn} onStartGameLesson={handleStartGameLesson} />
      </div>
    );
  }

  // Show homepage
  if (showHome && !replayActive) {
    return (
      <div className="app">
        <SettingsButton />
        <HomePage
          onNewGame={handleOpenNewGame}
          onLibrary={() => setShowLibrary(true)}
          onLearn={handleStartLearn}
        />
        {showNewGame && (
          <NewGameDialog onClose={() => setShowNewGame(false)} />
        )}
        {showLibrary && (
          <GameLibrary onSelectGame={handleSelectGame} onClose={() => setShowLibrary(false)} />
        )}
      </div>
    );
  }

  return (
    <div className="app">
      <SettingsButton />
      <header className="app-header">
        <h1 className="app-title" onClick={() => setShowHome(true)} style={{ cursor: 'pointer' }}>GoForKids</h1>
        <div className="header-controls">
          <button onClick={() => setShowLibrary(true)} className="btn btn-secondary">
            Library
          </button>
          {phase === 'finished' && gameId && (
            <button onClick={() => setShowStudy(!showStudy)} className="btn btn-secondary">
              {showStudy ? 'Hide Study' : 'Study'}
            </button>
          )}
          <button onClick={handleOpenNewGame} className="btn btn-primary">
            New Game
          </button>
        </div>
      </header>

      <main className="game-layout" style={{ position: 'relative' }}>
        <CaptureAnimation />

        <aside className="avatar-panel">
          {isBotVsBot ? (
            <>
              {/* Bot vs Bot: White bot at top */}
              <PlayerCard
                name={`${whiteBotInfo!.name} (${whiteRank})`}
                avatarType={whiteBotInfo!.type}
                stoneColor={Color.White}
                captures={whiteCaptures}
                isActive={phase === 'playing' && currentColor === Color.White}
                isThinking={aiThinking && currentColor === Color.White}
                isTop
              />
              {/* Bot vs Bot: Black bot at bottom */}
              <PlayerCard
                name={`${blackBotInfo!.name} (${blackRank})`}
                avatarType={blackBotInfo!.type}
                stoneColor={Color.Black}
                captures={blackCaptures}
                isActive={phase === 'playing' && currentColor === Color.Black}
                isThinking={aiThinking && currentColor === Color.Black}
              />
            </>
          ) : (
            <>
              {/* Human vs AI: Opponent at top */}
              <PlayerCard
                name={isAIGame ? `${botName} (${targetRank})` : 'Opponent'}
                avatarType={botAvatar}
                stoneColor={opponentColor}
                captures={opponentColor === Color.Black ? blackCaptures : whiteCaptures}
                isActive={isOpponentTurn}
                isThinking={aiThinking}
                isTop
              />
              {/* Human vs AI: Player at bottom */}
              <PlayerCard
                name="You"
                avatarType={playerAvatar}
                stoneColor={playerColor}
                captures={playerColor === Color.Black ? blackCaptures : whiteCaptures}
                isActive={isPlayerTurn && !aiThinking}
              />
            </>
          )}
        </aside>

        <div className="board-container">
          <GoBoard />
        </div>

        <aside className="side-panel">
          {replayActive ? (
            <ReplayControls />
          ) : showStudy && gameId ? (
            <StudyMode gameId={gameId} onClose={() => setShowStudy(false)} />
          ) : (
            <>
              <GameControls />
              {/* Bot vs Bot spectator controls */}
              {isBotVsBot && phase === 'playing' && (
                <div className="spectator-controls">
                  <button onClick={togglePause} className="btn btn-secondary">
                    {botVsBotPaused ? 'Resume' : 'Pause'}
                  </button>
                  <div className="speed-control">
                    <label>Speed</label>
                    <div className="speed-buttons">
                      <button
                        className={`speed-btn ${botVsBotSpeed === 2000 ? 'active' : ''}`}
                        onClick={() => setSpeed(2000)}
                      >
                        Slow
                      </button>
                      <button
                        className={`speed-btn ${botVsBotSpeed === 800 ? 'active' : ''}`}
                        onClick={() => setSpeed(800)}
                      >
                        Normal
                      </button>
                      <button
                        className={`speed-btn ${botVsBotSpeed === 200 ? 'active' : ''}`}
                        onClick={() => setSpeed(200)}
                      >
                        Fast
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </aside>
      </main>

      {showNewGame && (
        <NewGameDialog onClose={() => { setShowNewGame(false); setShowStudy(false); }} />
      )}
      {showLibrary && (
        <GameLibrary onSelectGame={handleSelectGame} onClose={() => setShowLibrary(false)} />
      )}
      <BotPassedModal />
      <LessonGameEndModal
        onMoveOn={handleMoveOnFromLessonGame}
        onNextLesson={nextLessonAfterGame !== null ? handleNextLessonAfterGame : undefined}
      />
    </div>
  );
}

export default App;
