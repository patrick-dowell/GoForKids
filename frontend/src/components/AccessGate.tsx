import { useState, type FormEvent, type ReactNode } from 'react';
import './AccessGate.css';

const STORAGE_KEY = 'goforkids-beta-auth';

interface AccessGateProps {
  children: ReactNode;
}

/**
 * Shared-password beta gate. Reads VITE_BETA_PASSWORD at build time;
 * when unset (local dev) the gate is bypassed entirely.
 *
 * Threat model: keep curious passers-by out, not protect anything sensitive —
 * the password lives in the JS bundle. Fine for closed beta.
 */
export function AccessGate({ children }: AccessGateProps) {
  const expected = import.meta.env.VITE_BETA_PASSWORD;
  const [unlocked, setUnlocked] = useState(
    () => !expected || localStorage.getItem(STORAGE_KEY) === '1',
  );
  const [input, setInput] = useState('');
  const [error, setError] = useState(false);

  if (unlocked) return <>{children}</>;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (input === expected) {
      localStorage.setItem(STORAGE_KEY, '1');
      setUnlocked(true);
    } else {
      setError(true);
      setInput('');
    }
  }

  return (
    <div className="access-gate">
      <form className="access-gate-form" onSubmit={handleSubmit}>
        <h1>GoForKids</h1>
        <p>Closed beta — enter the access code to continue.</p>
        <input
          type="password"
          autoFocus
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setError(false);
          }}
          placeholder="Access code"
          aria-label="Access code"
        />
        {error && <div className="access-gate-error">Wrong code — try again.</div>}
        <button type="submit" disabled={!input}>Enter</button>
      </form>
    </div>
  );
}
