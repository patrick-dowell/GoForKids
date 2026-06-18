import { useState, useEffect, useRef } from 'react';
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
import { PlayerOutOfMovesModal } from './components/PlayerOutOfMovesModal';
import { RuleViolationModal } from './components/RuleViolationModal';
import { LessonGameEndModal } from './components/LessonGameEndModal';
import { GameEndModal } from './components/GameEndModal';
import { SettingsButton } from './components/SettingsButton';
import { FeedbackButton } from './components/FeedbackButton';
import { PrivacyTermsModal } from './components/PrivacyTermsModal';
import { ScoringInProgressModal } from './components/ScoringInProgressModal';
import { useGameStore } from './store/gameStore';
import { useLearnStore } from './store/learnStore';
import { useLibraryStore, type SavedGame } from './store/libraryStore';
import { useReplayStore } from './store/replayStore';
import { useSettingsStore } from './store/settingsStore';
import { useAutoPlayStore } from './store/autoPlayStore';
import { type Matchup, type BoardSize } from './autoplay/matchmaker';
import { useProfileStore } from './store/profileStore';
import { LESSONS } from './learn/lessons';
import { BOT_AVATARS } from './components/Avatar';
import { AutoPlayView } from './components/AutoPlayView';
import { AutoPlayGameEndModal } from './components/AutoPlayGameEndModal';
import { RankUpOverlay } from './components/RankUpOverlay';
import { ProfileView } from './components/ProfileView';
import { GlossaryView } from './components/GlossaryView';
import { GameReview } from './components/GameReview';
import { useGlossaryStore } from './store/glossaryStore';
import { useGameReviewStore } from './store/gameReviewStore';
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
  const [showAutoPlay, setShowAutoPlay] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showStudy, setShowStudy] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  /** Tracks which lesson kicked off the currently-active game (for the
   *  "Next lesson" continuation on the game-end modal). Cleared on Move on. */
  const [activeGameLessonId, setActiveGameLessonId] = useState<string | null>(null);

  // Deep-link into the glossary: `?concept=<id>` opens that concept's page,
  // `?glossary=1` opens the index. Enables shareable concept links and lets the
  // Play-of-the-Game review / lessons jump straight to a concept. Runs once.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const cid = params.get('concept');
    if (cid) useGlossaryStore.getState().openConcept(cid);
    else if (params.get('glossary')) useGlossaryStore.getState().openIndex();
    // `?review=demo` opens a populated Play-of-the-Game review from a fixture
    // game; any other `?review` value shows the live (or empty) state. QA hook.
    const review = params.get('review');
    if (review === 'demo') useGameReviewStore.getState().openDemo();
    else if (review) useGameReviewStore.getState().open();
    // `?learn=N` jumps straight into lesson N (QA — no route otherwise).
    const learn = params.get('learn');
    if (learn !== null) useLearnStore.getState().resumeAt(Number(learn) || 0);
    // `?replay=demo` loads the demo game into the replay with highlights (QA).
    if (params.get('replay') === 'demo') {
      import('./learn/gameReview').then(({ demoReplay }) => {
        const d = demoReplay();
        setShowHome(false);
        useReplayStore.getState().loadGame(d.sgf, {
          playerColor: d.playerColor,
          scoreHistory: d.scoreHistory,
          result: 'Black wins by 8.5',
          opponentRank: 'demo',
        });
        useReplayStore.getState().nextHighlight(); // jump to the key move (QA)
      });
    }
  }, []);

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
  const komi = useGameStore((s) => s.komi);
  const aiThinking = useGameStore((s) => s.aiThinking);
  const gameMode = useGameStore((s) => s.gameMode);
  const blackRank = useGameStore((s) => s.blackRank);
  const whiteRank = useGameStore((s) => s.whiteRank);
  const botVsBotPaused = useGameStore((s) => s.botVsBotPaused);
  const botVsBotSpeed = useGameStore((s) => s.botVsBotSpeed);
  const scoringInProgress = useGameStore((s) => s.scoringInProgress);
  const autoplayContext = useGameStore((s) => s.autoplayContext);
  const result = useGameStore((s) => s.result);
  const togglePause = useGameStore((s) => s.toggleBotVsBotPause);
  const setSpeed = useGameStore((s) => s.setBotVsBotSpeed);

  const autoplayGamePending = useAutoPlayStore((s) => s.gamePending);
  const recordAutoplayResult = useAutoPlayStore((s) => s.recordResult);

  useGameIdInUrl();

  useEffect(() => {
    useLibraryStore.getState().loadFromStorage();
    useAutoPlayStore.getState().loadFromStorage();
    useProfileStore.getState().loadFromStorage();
  }, []);

  // Auto-play game-end recording. Two guards needed beyond gamePending:
  //
  // 1. Cross-game double-fire. handleStartAutoPlayGame sets gamePending=true
  //    SYNCHRONOUSLY before newGame()'s async createGame call resolves and
  //    flips phase to 'playing'. During that gap, gameStore still has the
  //    previous game's phase='finished' + result, so the effect would
  //    re-fire and re-record the previous outcome on every Next-match tap.
  //    recordedThisGameRef catches this; it resets to false on the next
  //    phase='playing' transition.
  //
  // 2. Local-then-server result swap on player double-pass. When the
  //    player passes twice with a backend, gameStore first sets `result`
  //    from local scoreTerritory (no dead-stone awareness), then later
  //    replaces it with the server's dead-stone-corrected result. On close
  //    games dead stones can flip the winner — the local fire would record
  //    the wrong outcome. scoringInProgress is true between the two fires;
  //    skip while true so we record the corrected result, not the local one.
  const recordedThisGameRef = useRef<boolean>(false);

  useEffect(() => {
    if (phase === 'playing') {
      recordedThisGameRef.current = false;
    }
  }, [phase]);

  useEffect(() => {
    if (!autoplayContext || !autoplayGamePending) return;
    if (phase !== 'finished' || !result) return;
    if (scoringInProgress) return;
    if (recordedThisGameRef.current) return;
    recordedThisGameRef.current = true;
    const userWon = result.winner === playerColor;
    recordAutoplayResult(userWon ? 'win' : 'loss');
  }, [autoplayContext, autoplayGamePending, phase, result, scoringInProgress, playerColor, recordAutoplayResult]);

  const replayActive = useReplayStore((s) => s.active);
  const loadReplay = useReplayStore((s) => s.loadGame);
  const closeReplay = useReplayStore((s) => s.close);
  const replayNext = useReplayStore((s) => s.nextMove);
  const replayPrev = useReplayStore((s) => s.prevMove);

  /** Replay close → return to home, not to the in-progress game underneath.
   *  Without the setShowHome here, closing a replay opened from Library left
   *  the user on the prior game's layout (bug #4 from TestFlight 2026-05-14). */
  const handleCloseReplay = () => {
    closeReplay();
    setShowStudy(false);
    setShowHome(true);
  };

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
      playerAvatar: useProfileStore.getState().avatar,
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
      scoreHistory: saved.scoreHistory,
      deadStones: saved.deadStones,
    });
  };

  const handleOpenNewGame = () => {
    // Dismiss any lingering game-end modal from the previous (finished) game so
    // it doesn't re-render over the New Game dialog. The finished game stays in
    // the store until the new game replaces it; without this it pops back up.
    useGameStore.getState().dismissGameEnd();
    setShowHome(false);
    setShowAutoPlay(false);
    setShowProfile(false);
    setShowNewGame(true);
  };

  const handleStartProfile = (boardSize?: BoardSize) => {
    // A board chip on the home screen opens THAT ladder's profile — switch the
    // active board so ProfileView (which reads the active board) shows it. The
    // typeof guard ignores a leaked click-event from the generic Profile button.
    if (typeof boardSize === 'number') {
      useAutoPlayStore.getState().setBoardSize(boardSize);
    }
    setShowHome(false);
    setShowAutoPlay(false);
    setShowNewGame(false);
    setShowProfile(true);
  };

  const handleExitProfile = () => {
    setShowProfile(false);
    setShowHome(true);
  };

  const handleStartAutoPlay = () => {
    setShowHome(false);
    setShowAutoPlay(true);
  };

  const handleExitAutoPlay = () => {
    setShowAutoPlay(false);
    setShowHome(true);
  };

  const handleStartAutoPlayGame = (matchup: Matchup) => {
    // Switch out of the match-picker so the game UI takes over, then mark
    // the game pending so the game-end effect records the result back into
    // the auto-play store. Board size comes from the auto-play store (the
    // player picks it on the match-picker); komi rungs (9×9 strong end,
    // feature 24) pass an explicit komi, stones rungs pass handicap.
    setShowAutoPlay(false);
    const boardSize = useAutoPlayStore.getState().boardSize;
    useAutoPlayStore.getState().setGamePending(true);
    newGame({
      boardSize,
      targetRank: matchup.bot,
      handicap: matchup.handicap,
      komi: matchup.komi,
      useBackend: true,
      isRanked: false,
      gameMode: 'ai',
      playerColor: matchup.playerColor === 'white' ? Color.White : Color.Black,
      playerAvatar: useProfileStore.getState().avatar,
      autoplayContext: true,
    });
  };

  const handleNextAutoPlayMatch = () => {
    // Return to the match-picker — AutoPlayView reads the post-recordResult
    // rung state from the store. Tapping Play on the card starts the next game.
    setShowAutoPlay(true);
  };

  const handleAutoPlayHome = () => {
    useGameStore.getState().dismissGameEnd();
    setShowAutoPlay(false);
    setShowHome(true);
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
        <FeedbackButton />
        <GlossaryView />
        <GameReview />
        {showPrivacy && <PrivacyTermsModal onClose={() => setShowPrivacy(false)} />}
      </div>
    );
  }

  // Show homepage
  if (showHome && !replayActive) {
    return (
      <div className="app">
        <SettingsButton />
        <HomePage
          onAutoPlay={handleStartAutoPlay}
          onCustomMatch={handleOpenNewGame}
          onLibrary={() => setShowLibrary(true)}
          onLearn={handleStartLearn}
          onProfile={handleStartProfile}
          onShowPrivacy={() => setShowPrivacy(true)}
        />
        {showNewGame && (
          <NewGameDialog onClose={() => setShowNewGame(false)} onOpenProfile={handleStartProfile} />
        )}
        {showLibrary && (
          <GameLibrary onSelectGame={handleSelectGame} onClose={() => setShowLibrary(false)} />
        )}
        <FeedbackButton />
        <GlossaryView />
        <GameReview />
        {showPrivacy && <PrivacyTermsModal onClose={() => setShowPrivacy(false)} />}
      </div>
    );
  }

  // Auto-play match-picker — shown when the player tapped "Play" on home
  // and either hasn't started a game yet or has just returned from one.
  if (showAutoPlay && !replayActive) {
    return (
      <div className="app">
        <SettingsButton />
        <AutoPlayView onExit={handleExitAutoPlay} onStart={handleStartAutoPlayGame} />
        <FeedbackButton />
        <GlossaryView />
        <GameReview />
        {showPrivacy && <PrivacyTermsModal onClose={() => setShowPrivacy(false)} />}
      </div>
    );
  }

  // Profile page — feature 23.
  if (showProfile && !replayActive) {
    return (
      <div className="app">
        <SettingsButton />
        <ProfileView onExit={handleExitProfile} />
        <FeedbackButton />
        <GlossaryView />
        <GameReview />
        {showPrivacy && <PrivacyTermsModal onClose={() => setShowPrivacy(false)} />}
      </div>
    );
  }

  return (
    <div className={'app' + (replayActive ? ' app-replay' : '')}>
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
                komi={komi}
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
                komi={opponentColor === Color.White ? komi : 0}
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
                komi={playerColor === Color.White ? komi : 0}
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
            <ReplayControls onClose={handleCloseReplay} />
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
        <NewGameDialog
          onClose={() => { setShowNewGame(false); setShowStudy(false); }}
          onOpenProfile={handleStartProfile}
        />
      )}
      {showLibrary && (
        <GameLibrary onSelectGame={handleSelectGame} onClose={() => setShowLibrary(false)} />
      )}
      <BotPassedModal />
      <PlayerOutOfMovesModal />
      <RuleViolationModal />
      <LessonGameEndModal
        onMoveOn={handleMoveOnFromLessonGame}
        onNextLesson={nextLessonAfterGame !== null ? handleNextLessonAfterGame : undefined}
      />
      <GameEndModal onQuit={() => { useGameStore.getState().dismissGameEnd(); setShowHome(true); }} />
      <AutoPlayGameEndModal
        onNextMatch={handleNextAutoPlayMatch}
        onHome={handleAutoPlayHome}
      />
      <GameReview />
      <RankUpOverlay />
      <FeedbackButton />
      <GlossaryView />
      {showPrivacy && <PrivacyTermsModal onClose={() => setShowPrivacy(false)} />}
      {scoringInProgress && <ScoringInProgressModal />}
    </div>
  );
}

export default App;
