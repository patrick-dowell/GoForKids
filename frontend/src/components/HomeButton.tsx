import { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import './HomeButton.css';

interface HomeButtonProps {
  /** Centralized teardown + navigate home (App's goHome). */
  onHome: () => void;
  /** When true, leaving an actively-playing game prompts a confirm first. Only
   *  the in-game HomeButton sets this — on other screens (profile, match
   *  picker) you're not in the game even if a stale `phase: 'playing'` lingers
   *  in the store after a previous game was abandoned. */
  confirmOnActiveGame?: boolean;
}

/**
 * Always-available, always-on-top way back to the home screen. Rendered at the
 * App root on every non-home screen (mirrors SettingsButton), at a z-index
 * ABOVE the scoring overlay so no blocking modal can hide it — the menu-trap
 * bug, where a hung "Calculating the final score" overlay covered the only
 * path home (the title) with no escape.
 *
 * While a game is actively playing, a tap goes through a small confirm so a
 * stray tap doesn't abandon a game (mid-game ranked games don't auto-save).
 * The confirm is custom React, NOT window.confirm() — native dialogs are
 * unreliable inside WKWebView (the two-tap pattern lesson from Session 22).
 */
export function HomeButton({ onHome, confirmOnActiveGame = false }: HomeButtonProps) {
  const phase = useGameStore((s) => s.phase);
  const [confirming, setConfirming] = useState(false);

  const handleClick = () => {
    if (confirmOnActiveGame && phase === 'playing') setConfirming(true);
    else onHome();
  };

  return (
    <>
      <button
        className="home-button"
        onClick={handleClick}
        aria-label="Go to the home screen"
        title="Home"
      >
        <span className="home-button-icon" aria-hidden="true">⌂</span>
        <span className="home-button-label">Home</span>
      </button>

      {confirming && (
        <div
          className="home-confirm-backdrop"
          onClick={() => setConfirming(false)}
          role="dialog"
          aria-modal="true"
        >
          <div className="home-confirm-card" onClick={(e) => e.stopPropagation()}>
            <div className="home-confirm-title">Leave this game?</div>
            <div className="home-confirm-sub">Your progress won't be saved.</div>
            <div className="home-confirm-actions">
              <button className="btn btn-secondary" onClick={() => setConfirming(false)}>
                Keep playing
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setConfirming(false);
                  onHome();
                }}
              >
                Leave
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
