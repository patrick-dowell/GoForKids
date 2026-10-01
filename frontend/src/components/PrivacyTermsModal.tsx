import './PrivacyTermsModal.css';

interface PrivacyTermsModalProps {
  onClose: () => void;
}

/** Plain-language privacy text for parents (feature 32, revision 2): what a
 *  profile holds, what it never holds, and how to have it deleted. */
export function PrivacyTermsModal({ onClose }: PrivacyTermsModalProps) {
  return (
    <div className="privacy-overlay" onClick={onClose}>
      <div className="privacy-modal" onClick={(e) => e.stopPropagation()}>
        <button className="privacy-close" onClick={onClose} aria-label="Close">×</button>
        <h2>Privacy & Terms</h2>

        <section>
          <h3>Your profile</h3>
          <p>
            When you start playing, GoForKids makes a profile automatically, so
            your progress is saved and can move to another device. A profile
            holds:
          </p>
          <ul>
            <li>a random ID that isn't connected to who you are,</li>
            <li>a made-up name picked from our word list, like “Cosmic Otter”,</li>
            <li>your rank and game results, finished lessons, avatar and saved games.</li>
          </ul>
          <p>
            That's all. There's no email, no password, and nowhere to type a
            name. Settings like theme and sound stay on this device.
          </p>
        </section>

        <section>
          <h3>What we don't do</h3>
          <ul>
            <li>No advertising, no third-party trackers.</li>
            <li>No selling or sharing of your data.</li>
          </ul>
        </section>

        <section>
          <h3>Deleting a profile</h3>
          <p>
            Logging out (Profile → Devices) removes the profile from this
            device. To delete it from our server too, use the Feedback button
            or email the project owner, and tell us the player name shown on
            the Profile page and roughly when you last played.
          </p>
        </section>

        <section>
          <h3>Beta</h3>
          <p>
            This is a beta. Things may break or change without notice, so
            don't count on saved games lasting forever yet.
          </p>
        </section>
      </div>
    </div>
  );
}
