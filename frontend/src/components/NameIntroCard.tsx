import { renderName } from '../profile/names';
import { useProfileStore } from '../store/profileStore';
import { useSyncStore } from '../store/syncStore';
import './FirstRunScreen.css';

/**
 * Shown once, on the home screen, to a player who already had progress on
 * this device when profiles arrived (feature 32, revision 2, case 2): their
 * profile was created without asking, and this is where they meet the name
 * it was given.
 *
 * Also shown once to a new player whose first-run name turned out to belong
 * to another profile (revision 6): the profile was created under another
 * name, and the card says so and shows it.
 *
 * Either way it shows the name the player has now, so a Shuffle here that
 * the server refuses as taken shows the name sync picked instead.
 */
export function NameIntroCard() {
  const handle = useProfileStore((s) => s.handle);
  const shuffle = useProfileStore((s) => s.shuffleHandle);
  const dismiss = useSyncStore((s) => s.dismissIntro);
  const nameWasTaken = useSyncStore((s) => s.nameWasTaken);

  return (
    <div className="name-intro-overlay" role="dialog" aria-modal="true" aria-labelledby="name-intro-title">
      <div className="name-intro-card">
        <p className="first-run-sub" id="name-intro-title">
          {nameWasTaken ? 'Someone already has that name, so your player name is' : 'Your player name is'}
        </p>
        <div className="first-run-name" aria-live="polite">
          {renderName(handle)}
        </div>
        {!nameWasTaken && <p className="first-run-sub">Your progress is now saved online.</p>}
        <div className="first-run-actions">
          <button className="first-run-btn" onClick={shuffle}>
            Shuffle
          </button>
          <button className="first-run-btn first-run-btn-primary" onClick={dismiss}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
