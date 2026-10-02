import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { normalizePairingCode, PAIRING_CODE_LENGTH } from '../api/sync';
import { randomHandle, renderName, type Handle } from '../profile/names';
import { useProfileStore } from '../store/profileStore';
import { useSyncStore } from '../store/syncStore';
import './FirstRunScreen.css';

interface FirstRunScreenProps {
  onShowPrivacy: () => void;
}

type Step = 'choose' | 'name' | 'login';

function logInError(e: unknown): string {
  if (e instanceof ApiError && e.status === 404) return "That code didn't work. Ask for a new one.";
  if (e instanceof ApiError && e.status === 429) return 'Too many tries. Wait a little, then try again.';
  return "Couldn't connect. Logging in needs the internet.";
}

/**
 * The first-run choice (feature 32, revision 2), shown before anything else
 * on a new install, after logging out, and after this device was logged out
 * elsewhere. A full screen that never scrolls.
 *
 * - "New player": a generated name (Shuffle for another), then on into the
 *   app; the profile is created in the background and never blocks play.
 *   The name is drawn here without asking the server, so another profile
 *   may already hold it (revision 6): then sync draws another while
 *   creating, and the name card on the home screen shows the one it got.
 * - "I already play on another device": type the code from that device's
 *   Profile → Add a device, and this device takes that player whole.
 */
export function FirstRunScreen({ onShowPrivacy }: FirstRunScreenProps) {
  const notice = useSyncStore((s) => s.firstRunNotice);
  const startNewPlayer = useSyncStore((s) => s.startNewPlayer);
  const logIn = useSyncStore((s) => s.logIn);

  const [step, setStep] = useState<Step>('choose');
  const [handle, setHandle] = useState<Handle>(() => randomHandle());
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const go = (next: Step) => {
    setStep(next);
    setError(null);
  };

  const confirmName = () => {
    useProfileStore.getState().setHandle(handle);
    startNewPlayer();
  };

  const submitCode = async () => {
    if (busy) return;
    if (normalizePairingCode(code).length !== PAIRING_CODE_LENGTH) {
      setError(`Type all ${PAIRING_CODE_LENGTH} letters and numbers.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await logIn(code);
      // Success unmounts this screen.
    } catch (e) {
      if (mounted.current) setError(logInError(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <div className="first-run">
      <div className="first-run-stars" />
      <div className="first-run-content">
        {step === 'choose' && (
          <>
            <h1 className="first-run-title">Welcome to GoForKids!</h1>
            {notice === 'logged-out' && (
              <p className="first-run-notice" role="status">
                This device was logged out, so its progress was removed here.
              </p>
            )}
            <p className="first-run-sub">Who's playing?</p>
            <div className="first-run-actions">
              <button className="first-run-btn first-run-btn-primary" onClick={() => go('name')}>
                New player
              </button>
              <button className="first-run-btn" onClick={() => go('login')}>
                I already play on another device
              </button>
            </div>
            <button className="first-run-link" onClick={onShowPrivacy}>
              Privacy &amp; Terms
            </button>
          </>
        )}

        {step === 'name' && (
          <>
            <p className="first-run-sub">Your player name is</p>
            <div className="first-run-name" aria-live="polite">
              {renderName(handle)}
            </div>
            <div className="first-run-actions">
              <button className="first-run-btn" onClick={() => setHandle((h) => randomHandle(h))}>
                Shuffle
              </button>
              <button className="first-run-btn first-run-btn-primary" onClick={confirmName}>
                Let's go →
              </button>
            </div>
            <button className="first-run-link" onClick={() => go('choose')}>
              ← Back
            </button>
          </>
        )}

        {step === 'login' && (
          <>
            <h1 className="first-run-title">Log in</h1>
            <label className="first-run-sub" htmlFor="first-run-code">
              On your other device, go to Profile and tap “Add a device”. Type the code it shows:
            </label>
            <input
              id="first-run-code"
              className="first-run-input"
              type="text"
              value={code}
              placeholder="ABCD 2345"
              maxLength={16}
              autoCapitalize="characters"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => {
                setCode(e.target.value.toUpperCase());
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitCode();
              }}
            />
            {error && (
              <p className="first-run-error" role="alert">
                {error}
              </p>
            )}
            <div className="first-run-actions">
              <button className="first-run-btn first-run-btn-primary" onClick={() => void submitCode()} disabled={busy}>
                {busy ? 'Logging in…' : 'Log in'}
              </button>
              <button className="first-run-btn" onClick={() => go('choose')} disabled={busy}>
                Back
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
