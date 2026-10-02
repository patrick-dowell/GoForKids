import { FriendsSection } from './FriendsSection';
import { HomeButton } from './HomeButton';
import { useSyncStore } from '../store/syncStore';
import './ProfileView.css';
import './FriendsPage.css';

interface FriendsPageProps {
  /** App's goHome. */
  onExit: () => void;
}

/**
 * The Friends page (feature 32, revision 7), opened by the home screen's
 * Friends button. It mounts the Friends section as it is; the section's
 * styles live with the Profile page's, where it used to sit.
 *
 * A sanctioned scroll screen, like the Library list: the header with the
 * home button stays put and the content scrolls inside its own container
 * (never the body — WKWebView).
 *
 * Friends need a profile this device is logged into; until then the page
 * says so and offers nothing else.
 */
export function FriendsPage({ onExit }: FriendsPageProps) {
  const loggedIn = useSyncStore((s) => s.deviceToken !== null);

  return (
    <div className="friends-page">
      <div className="profile-backdrop">
        <div className="profile-stars" />
      </div>

      <header className="friends-page-header">
        <div className="friends-page-home">
          <HomeButton onHome={onExit} />
        </div>
        <h1 className="friends-page-title">Friends</h1>
        <div />
      </header>

      <div className="friends-page-scroll">
        <main className="profile-main friends-page-main">
          {loggedIn ? (
            <FriendsSection />
          ) : (
            <section className="profile-section friends-page-offline">
              <p className="profile-devices-text">
                Friends need your player saved online first. That will happen next time this device is connected.
              </p>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
