import { renderName } from '../profile/names';
import { useProfileStore } from '../store/profileStore';
import { useSyncStore } from '../store/syncStore';
import './FirstRunScreen.css';

/**
 * Shown once, on the home screen, to a player who already had progress on
 * this device when profiles arrived (feature 32, revision 2, case 2): their
 * profile was created without asking, and this is where they meet the name
 * it was given.
 */
export function NameIntroCard() {
  const handle = useProfileStore((s) => s.handle);
  const shuffle = useProfileStore((s) => s.shuffleHandle);
  const dismiss = useSyncStore((s) => s.dismissIntro);

  return (
    <div className="name-intro-overlay" role="dialog" aria-modal="true" aria-labelledby="name-intro-title">
      <div className="name-intro-card">
        <p className="first-run-sub" id="name-intro-title">
          Your player name is
        </p>
        <div className="first-run-name">{renderName(handle)}</div>
        <p className="first-run-sub">Your progress is now saved online.</p>
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
