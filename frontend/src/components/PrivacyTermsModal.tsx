import './PrivacyTermsModal.css';

interface PrivacyTermsModalProps {
  onClose: () => void;
}

export function PrivacyTermsModal({ onClose }: PrivacyTermsModalProps) {
  return (
    <div className="privacy-overlay" onClick={onClose}>
      <div className="privacy-modal" onClick={(e) => e.stopPropagation()}>
        <button className="privacy-close" onClick={onClose} aria-label="Close">×</button>
        <h2>Privacy & Terms</h2>

        <section>
          <h3>What we store</h3>
          <p>
            GoForKids saves the games you play (move history, score, opponent rank)
            so you can replay them later. Game data lives on our server and in your
            browser's local storage. No accounts, no email, no real names — we
            don't ask, and we don't track who you are.
          </p>
        </section>

        <section>
          <h3>What we don't do</h3>
          <ul>
            <li>No advertising, no third-party trackers.</li>
            <li>No selling or sharing of your data.</li>
            <li>No collection of personal information from kids or anyone else.</li>
          </ul>
        </section>

        <section>
          <h3>Beta status</h3>
          <p>
            This is a closed beta. The app may have bugs, lose your data on
            redeploys, or change without notice. Don't rely on saved games being
            permanent yet.
          </p>
        </section>

        <section>
          <h3>Contact</h3>
          <p>
            Questions, concerns, or want your data removed? Use the Feedback
            button or email the project owner directly.
          </p>
        </section>
      </div>
    </div>
  );
}
