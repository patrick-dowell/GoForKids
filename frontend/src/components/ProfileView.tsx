import { useState } from 'react';
import { Avatar, PLAYER_AVATARS, type PlayerAvatarType } from './Avatar';
import { useProfileStore } from '../store/profileStore';
import { useAutoPlayStore, type HistoryEntry } from '../store/autoPlayStore';
import {
  winsToPromote,
  applyResult,
  effectiveMatchup,
  freshState,
  ladderRungs,
  nextRung,
  prevRung,
  type BoardSize,
  type Rung,
  type RungState,
} from '../autoplay/matchmaker';
import { confidenceInterval, displayRating, toGoRank } from '../autoplay/glicko';
import './ProfileView.css';

interface ProfileViewProps {
  onExit: () => void;
}

export function ProfileView({ onExit }: ProfileViewProps) {
  const avatar = useProfileStore((s) => s.avatar);
  const displayName = useProfileStore((s) => s.displayName);
  const setAvatar = useProfileStore((s) => s.setAvatar);
  const setDisplayName = useProfileStore((s) => s.setDisplayName);

  // The active board's slot — set by the home-screen chip that opened this view.
  const boardSize = useAutoPlayStore((s) => s.boardSize);
  const rungState = useAutoPlayStore((s) => s.rungState);
  const history = useAutoPlayStore((s) => s.history);
  const promotionEvents = useAutoPlayStore((s) => s.promotionEvents);
  const shadowRating = useAutoPlayStore((s) => s.shadowRating);
  const resetAutoPlay = useAutoPlayStore((s) => s.reset);
  const setRung = useAutoPlayStore((s) => s.setRung);
  const derank = useAutoPlayStore((s) => s.derank);

  const [advancedOpen, setAdvancedOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem('goforkids.profile.advanced') === '1';
    } catch {
      return false;
    }
  });
  const toggleAdvanced = () => {
    const next = !advancedOpen;
    setAdvancedOpen(next);
    try { localStorage.setItem('goforkids.profile.advanced', next ? '1' : '0'); } catch {}
  };

  return (
    <div className="profile-view">
      <div className="profile-backdrop">
        <div className="profile-stars" />
      </div>

      <header className="profile-header-nav">
        <button className="profile-back-btn" onClick={onExit} aria-label="Back to home">
          ← Home
        </button>
        <div className="profile-header-title">Profile</div>
        <div className="profile-header-spacer" />
      </header>

      <main className="profile-main">
        <ProfileHeader
          avatar={avatar}
          displayName={displayName}
          onSetDisplayName={setDisplayName}
        />

        <CurrentRankCard rungState={rungState} history={history} boardSize={boardSize} onDerank={derank} />

        <RankGraph history={history} boardSize={boardSize} />

        <AvatarPickerSection avatar={avatar} onSelect={setAvatar} />

        <AdvancedSection
          open={advancedOpen}
          onToggle={toggleAdvanced}
          rungState={rungState}
          boardSize={boardSize}
          shadowRating={shadowRating}
          history={history}
          promotionEvents={promotionEvents}
          onReset={resetAutoPlay}
          onSetRung={setRung}
        />
      </main>
    </div>
  );
}

/* ---------- Header ---------- */

function ProfileHeader({
  avatar,
  displayName,
  onSetDisplayName,
}: {
  avatar: PlayerAvatarType;
  displayName: string;
  onSetDisplayName: (s: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(displayName);

  const commit = () => {
    onSetDisplayName(draft.trim());
    setEditing(false);
  };

  return (
    <section className="profile-section profile-header-card">
      <Avatar type={avatar} size={96} />
      <div className="profile-header-text">
        {editing ? (
          <input
            type="text"
            className="profile-name-input"
            value={draft}
            placeholder="Your name"
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(displayName); setEditing(false); } }}
            maxLength={40}
          />
        ) : (
          <button
            type="button"
            className="profile-name-display"
            onClick={() => { setDraft(displayName); setEditing(true); }}
            aria-label="Edit name"
          >
            {displayName || <span className="profile-name-placeholder">Tap to set your name</span>}
            <span className="profile-name-edit-hint" aria-hidden>✎</span>
          </button>
        )}
        <div className="profile-header-sub">Player Profile</div>
      </div>
    </section>
  );
}

/* ---------- Current Rank Card ---------- */

function CurrentRankCard({ rungState, history, boardSize, onDerank }: { rungState: RungState; history: HistoryEntry[]; boardSize: BoardSize; onDerank: () => void }) {
  const matchup = effectiveMatchup(rungState.currentRung, rungState.lossStreak, boardSize);
  const next = nextRung(rungState.currentRung, boardSize);
  const prev = prevRung(rungState.currentRung, boardSize);
  const winsNeeded = winsToPromote(rungState.currentRung, boardSize);
  const atWall = rungState.winsAtCurrentRung >= winsNeeded;
  const recentResults = history.slice(-10);

  // Voluntary derank (feature 25) — player-facing, so confirmation is the
  // same inline two-tap used by the dev Reset button (window.confirm
  // silently no-ops in WKWebView).
  const [derankArmed, setDerankArmed] = useState(false);
  const handleDerank = () => {
    if (!derankArmed) {
      setDerankArmed(true);
      return;
    }
    setDerankArmed(false);
    onDerank();
  };

  const color = matchup.playerColor === 'white' ? '⚪ White' : '⚫ Black';
  const detail =
    matchup.handicap > 0
      ? `${matchup.playerColor === 'white' ? 'bot' : 'you'} +${matchup.handicap} stone${matchup.handicap === 1 ? '' : 's'}`
      : matchup.komi === 0
        ? 'no komi'
        : matchup.komi === undefined
          ? 'even'
          : `${matchup.komi} komi`;
  const handicapLine = `Playing ${matchup.bot} bot as ${color} · ${detail}`;

  const winsLine = atWall
    ? `You've earned promotion — the ${next ?? 'next'} bot isn't calibrated yet, so you're held at ${rungState.currentRung}.`
    : `${rungState.winsAtCurrentRung} of ${winsNeeded} wins toward ${next ?? 'next rung'}`;

  return (
    <section className="profile-section profile-rank-card">
      <div className="profile-section-eyebrow">{boardSize}×{boardSize} — Auto-play</div>
      <div className="profile-rank-big">{rungState.currentRung}</div>
      <div className="profile-rank-matchup">{handicapLine}</div>

      <div className="profile-progress-row">
        <div className="profile-progress-bar" role="progressbar" aria-valuenow={rungState.winsAtCurrentRung} aria-valuemax={winsNeeded}>
          {Array.from({ length: winsNeeded }).map((_, i) => (
            <div
              key={i}
              className={'profile-progress-seg' + (i < rungState.winsAtCurrentRung ? ' profile-progress-seg-filled' : '')}
            />
          ))}
        </div>
        <div className="profile-progress-label">{winsLine}</div>
      </div>

      {prev && (
        <div className="profile-derank-row">
          <button
            className={'profile-derank-btn' + (derankArmed ? ' profile-derank-btn-armed' : '')}
            onClick={handleDerank}
            onBlur={() => setDerankArmed(false)}
          >
            {derankArmed ? `Tap again to move down to ${prev}` : 'Too tough? Move down a rank…'}
          </button>
        </div>
      )}

      <div className="profile-recent-row">
        <div className="profile-recent-label">Recent results</div>
        <div className="profile-recent-chips">
          {recentResults.length === 0 ? (
            <span className="profile-recent-empty">No games yet — tap Play on the home page.</span>
          ) : (
            recentResults.map((entry, i) => (
              <span
                key={entry.ts + '-' + i}
                className={'profile-recent-chip ' + (entry.result === 'win' ? 'profile-recent-chip-win' : 'profile-recent-chip-loss')}
                title={chipTooltip(entry)}
              >
                {entry.result === 'win' ? 'W' : 'L'}
              </span>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function chipTooltip(entry: HistoryEntry): string {
  const when = new Date(entry.ts).toLocaleString();
  const handi = entry.handicap === 0 ? 'even' : `H${entry.handicap}`;
  return `${entry.result === 'win' ? 'Won' : 'Lost'} at ${entry.rung} vs ${entry.bot} ${handi} — ${when}`;
}

/* ---------- Rank Graph ---------- */

/**
 * Replay history through the matchmaker to get the rung the player was at
 * before each game. The graph plots one data point per game, with the
 * y-value = rung-index-at-game-start. Promotions show up as step-ups
 * between consecutive points.
 */
function rankSeries(history: HistoryEntry[], boardSize: BoardSize): number[] {
  const rungs = ladderRungs(boardSize);
  let state: RungState = freshState(boardSize);
  const rungIndices: number[] = [rungs.indexOf(state.currentRung)];
  for (const entry of history) {
    const out = applyResult(state, entry.result, boardSize);
    state = out.state;
    rungIndices.push(rungs.indexOf(state.currentRung));
  }
  return rungIndices;
}

function RankGraph({ history, boardSize }: { history: HistoryEntry[]; boardSize: BoardSize }) {
  const rungs = ladderRungs(boardSize);
  const W = 580;
  const H = 200;
  const padL = 50;
  const padR = 16;
  const padT = 16;
  const padB = 32;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const series = rankSeries(history, boardSize);
  const maxX = Math.max(1, series.length - 1);
  const maxRung = rungs.length - 1;

  const xAt = (i: number) => padL + (i / maxX) * plotW;
  // Invert Y so stronger (higher rung index) plots at the top.
  const yAt = (rungIdx: number) => padT + (1 - rungIdx / maxRung) * plotH;

  // Path: step-wise so the line jumps at promotions instead of slanting.
  const path: string[] = [];
  series.forEach((rungIdx, i) => {
    const x = xAt(i);
    const y = yAt(rungIdx);
    if (i === 0) path.push(`M ${x.toFixed(1)} ${y.toFixed(1)}`);
    else {
      const prevY = yAt(series[i - 1]);
      path.push(`L ${x.toFixed(1)} ${prevY.toFixed(1)} L ${x.toFixed(1)} ${y.toFixed(1)}`);
    }
  });

  // Promotion markers: each i where series[i] > series[i-1].
  const promotions: { x: number; y: number; rung: Rung }[] = [];
  for (let i = 1; i < series.length; i++) {
    if (series[i] > series[i - 1]) {
      promotions.push({ x: xAt(i), y: yAt(series[i]), rung: rungs[series[i]] });
    }
  }

  // Y-axis labels: a few evenly-spaced rungs across the visible range.
  const yLabels = ['30k', '15k', '6k', '1d'];
  const yLabelPositions = yLabels.map((label) => ({
    label,
    y: yAt(rungs.indexOf(label)),
  }));

  return (
    <section className="profile-section profile-graph-section">
      <div className="profile-section-eyebrow">Rank over time</div>
      {history.length === 0 ? (
        <div className="profile-graph-empty">
          No games yet. The chart fills in as you play.
        </div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="profile-graph" role="img" aria-label="Rank progression chart">
          {/* Grid lines */}
          {yLabelPositions.map(({ label, y }) => (
            <g key={label}>
              <line x1={padL} x2={W - padR} y1={y} y2={y} className="profile-graph-grid" />
              <text x={padL - 8} y={y} className="profile-graph-axis-label" textAnchor="end" dominantBaseline="middle">
                {label}
              </text>
            </g>
          ))}
          {/* X-axis label */}
          <text x={W / 2} y={H - 6} className="profile-graph-axis-label" textAnchor="middle">
            Games played ({history.length})
          </text>
          {/* Series line */}
          <path d={path.join(' ')} className="profile-graph-line" />
          {/* Promotion dots */}
          {promotions.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={5} className="profile-graph-promotion-dot">
              <title>Promoted to {p.rung}</title>
            </circle>
          ))}
        </svg>
      )}
    </section>
  );
}

/* ---------- Avatar Picker ---------- */

function AvatarPickerSection({
  avatar,
  onSelect,
}: {
  avatar: PlayerAvatarType;
  onSelect: (type: PlayerAvatarType) => void;
}) {
  return (
    <section className="profile-section">
      <div className="profile-section-eyebrow">Your avatar</div>
      <div className="profile-avatar-grid">
        {PLAYER_AVATARS.map((a) => (
          <button
            key={a.type}
            className={'profile-avatar-option' + (avatar === a.type ? ' profile-avatar-option-selected' : '')}
            onClick={() => onSelect(a.type)}
          >
            <Avatar type={a.type} size={64} active={avatar === a.type} />
            <span className="profile-avatar-option-name">{a.name}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

/* ---------- Advanced + Dev Tools ---------- */

function AdvancedSection({
  open,
  onToggle,
  rungState,
  boardSize,
  shadowRating,
  history,
  promotionEvents,
  onReset,
  onSetRung,
}: {
  open: boolean;
  onToggle: () => void;
  rungState: RungState;
  boardSize: BoardSize;
  shadowRating: { mu: number; phi: number; sigma: number };
  history: HistoryEntry[];
  promotionEvents: { from: Rung; to: Rung; ts: number }[];
  onReset: () => void;
  onSetRung: (rung: Rung) => void;
}) {
  return (
    <section className="profile-section profile-advanced">
      <button className="profile-advanced-toggle" onClick={onToggle}>
        <span>{open ? '▼' : '▶'}</span>
        Advanced
      </button>
      {open && (
        <div className="profile-advanced-body">
          <GlickoBlock rating={shadowRating} />
          <MatchmakerBlock rungState={rungState} boardSize={boardSize} />
          <RecentResultsBlock history={history} promotionEvents={promotionEvents} />
          <DevToolsBlock
            rungState={rungState}
            boardSize={boardSize}
            onReset={onReset}
            onSetRung={onSetRung}
          />
        </div>
      )}
    </section>
  );
}

function GlickoBlock({ rating }: { rating: { mu: number; phi: number; sigma: number } }) {
  const [lo, hi] = confidenceInterval(rating);
  return (
    <div className="profile-advanced-block">
      <div className="profile-advanced-block-title">Glicko-2 (shadow)</div>
      <div className="profile-kv-grid">
        <div><span className="profile-kv-key">Display rank</span><span className="profile-kv-val">{toGoRank(rating)}</span></div>
        <div><span className="profile-kv-key">Rating (μ)</span><span className="profile-kv-val">{displayRating(rating)}</span></div>
        <div><span className="profile-kv-key">Deviation (φ)</span><span className="profile-kv-val">{rating.phi.toFixed(1)}</span></div>
        <div><span className="profile-kv-key">Volatility (σ)</span><span className="profile-kv-val">{rating.sigma.toFixed(4)}</span></div>
        <div><span className="profile-kv-key">95% CI</span><span className="profile-kv-val">[{lo}, {hi}]</span></div>
      </div>
      <div className="profile-advanced-block-note">
        Shadow rating — does NOT drive promotion in v1. The linear ladder is authoritative.
      </div>
    </div>
  );
}

function MatchmakerBlock({ rungState, boardSize }: { rungState: RungState; boardSize: BoardSize }) {
  const matchup = effectiveMatchup(rungState.currentRung, rungState.lossStreak, boardSize);
  const base = effectiveMatchup(rungState.currentRung, 0, boardSize);
  const safeguardActive = matchup.handicap !== base.handicap;
  return (
    <div className="profile-advanced-block">
      <div className="profile-advanced-block-title">Matchmaker decision</div>
      <pre className="profile-code-block">
{`currentRung:        ${rungState.currentRung}
winsAtCurrentRung:  ${rungState.winsAtCurrentRung}
lossStreak:         ${rungState.lossStreak}

matchup.bot:        ${matchup.bot}
matchup.handicap:   ${matchup.handicap}${safeguardActive ? '  (+' + (matchup.handicap - base.handicap) + ' safeguard)' : ''}
matchup.validated:  ${matchup.validated}`}
      </pre>
    </div>
  );
}

function RecentResultsBlock({
  history,
  promotionEvents,
}: {
  history: HistoryEntry[];
  promotionEvents: { from: Rung; to: Rung; ts: number }[];
}) {
  const recent = history.slice(-20).reverse();
  return (
    <div className="profile-advanced-block">
      <div className="profile-advanced-block-title">Recent games ({history.length} total, showing last {recent.length})</div>
      <div className="profile-results-list">
        {recent.length === 0 ? (
          <div className="profile-results-empty">No games recorded yet.</div>
        ) : recent.map((entry, i) => (
          <div key={entry.ts + '-' + i} className="profile-results-row">
            <span className={'profile-results-result ' + (entry.result === 'win' ? 'win' : 'loss')}>
              {entry.result === 'win' ? 'W' : 'L'}
            </span>
            <span className="profile-results-rung">{entry.rung}</span>
            <span className="profile-results-vs">vs {entry.bot}{entry.handicap > 0 ? ` H${entry.handicap}` : ''}</span>
            <span className="profile-results-ts">{new Date(entry.ts).toLocaleString()}</span>
          </div>
        ))}
      </div>
      <div className="profile-advanced-block-title profile-advanced-promotions-title">
        Promotions ({promotionEvents.length})
      </div>
      <div className="profile-promotions-list">
        {promotionEvents.length === 0 ? (
          <div className="profile-results-empty">No promotions yet.</div>
        ) : promotionEvents.slice().reverse().map((p, i) => (
          <div key={p.ts + '-' + i} className="profile-promotions-row">
            <span className="profile-promotions-arrow">{p.from} → <strong>{p.to}</strong></span>
            <span className="profile-results-ts">{new Date(p.ts).toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DevToolsBlock({
  rungState,
  boardSize,
  onReset,
  onSetRung,
}: {
  rungState: RungState;
  boardSize: BoardSize;
  onReset: () => void;
  onSetRung: (rung: Rung) => void;
}) {
  const [selectedRung, setSelectedRung] = useState<Rung>(rungState.currentRung);
  const [resetArmed, setResetArmed] = useState(false);

  const exportPayload = () => {
    const raw = localStorage.getItem('goforkids.autoplay.v1') || '{}';
    const blob = new Blob([raw], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `goforkids-autoplay-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importPayload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return;
      f.text().then((text) => {
        try {
          JSON.parse(text); // validate
          localStorage.setItem('goforkids.autoplay.v1', text);
          window.location.reload();
        } catch (e) {
          alert('Import failed: not valid JSON');
        }
      });
    };
    input.click();
  };

  // window.confirm/prompt silently no-op in WKWebView (no native JS-panel
  // delegate), so confirmation is inline: Set rung acts directly (reversible,
  // dev-only); Reset arms on the first tap and fires on the second.
  const handleReset = () => {
    if (!resetArmed) {
      setResetArmed(true);
      return;
    }
    setResetArmed(false);
    onReset();
  };

  const handleSetRung = () => {
    if (selectedRung === rungState.currentRung) return;
    onSetRung(selectedRung);
  };

  return (
    <div className="profile-advanced-block">
      <div className="profile-advanced-block-title">Dev tools (beta only)</div>

      <div className="profile-dev-row">
        <label className="profile-dev-label" htmlFor="profile-manual-rank">Manual rank set</label>
        <select
          id="profile-manual-rank"
          className="profile-dev-select"
          value={selectedRung}
          onChange={(e) => setSelectedRung(e.target.value)}
        >
          {ladderRungs(boardSize).map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <button className="profile-dev-btn" onClick={handleSetRung} disabled={selectedRung === rungState.currentRung}>
          Set rung
        </button>
      </div>

      <div className="profile-dev-row">
        <span className="profile-dev-label">Storage</span>
        <button className="profile-dev-btn" onClick={exportPayload}>Export JSON</button>
        <button className="profile-dev-btn" onClick={importPayload}>Import JSON</button>
        <button
          className="profile-dev-btn profile-dev-btn-danger"
          onClick={handleReset}
          onBlur={() => setResetArmed(false)}
        >
          {resetArmed ? 'Tap again to confirm' : 'Reset to 30k…'}
        </button>
      </div>
    </div>
  );
}
