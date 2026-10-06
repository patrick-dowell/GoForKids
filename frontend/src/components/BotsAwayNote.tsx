import { checkServer, useServerChecking } from '../store/serverReachStore';
import { BOTS_AWAY, CHECKING, TRY_AGAIN } from './botsAwayCopy';
import './BotsAwayNote.css';

/** Beside a greyed game against a bot: why, and a way to ask again. The
 *  screen un-greys by itself when the answer comes back. */
export function BotsAwayNote({ className = '' }: { className?: string }) {
  const checking = useServerChecking();
  return (
    <div className={`bots-away ${className}`.trim()} role="status">
      <p className="bots-away-text">{BOTS_AWAY}</p>
      <button type="button" className="bots-away-retry" onClick={() => void checkServer()} disabled={checking}>
        {checking ? CHECKING : TRY_AGAIN}
      </button>
    </div>
  );
}
