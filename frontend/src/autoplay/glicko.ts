/**
 * Glicko-2 rating system (TS port of `backend/app/game/rating.py`).
 *
 * Auto-play's linear ladder doesn't use this for promotion — it's surfaced
 * on the Profile page (feature 23) as a "shadow rating" so adults can see
 * the underlying statistical estimate alongside the kid-friendly rung
 * label. Each finished auto-play game updates the rating via `updateRating`.
 *
 * The math here mirrors the Python implementation exactly. The two are
 * independent ports of the Glicko-2 paper so they will stay in sync by
 * virtue of implementing the same algorithm, not by any code-sharing.
 */

const TAU = 0.5;
const EPSILON = 1e-6;

export interface Rating {
  /** Glicko-1 scale: 1500 is the historical default. Higher = stronger. */
  mu: number;
  /** Rating deviation. Smaller = more confident. Starts at 350. */
  phi: number;
  /** Volatility. Starts at 0.06. */
  sigma: number;
}

export const DEFAULT_RATING: Rating = { mu: 1500, phi: 350, sigma: 0.06 };

/** Round `mu` to an integer for display. */
export function displayRating(r: Rating): number {
  return Math.round(r.mu);
}

/** 95% confidence interval around `mu` ([low, high]). */
export function confidenceInterval(r: Rating): [number, number] {
  return [Math.round(r.mu - 2 * r.phi), Math.round(r.mu + 2 * r.phi)];
}

/**
 * Map a Glicko rating to an approximate Go rank label. ~100 rating points
 * per rank, anchored so mu=2000 → 5k. The floor is mu=-500 (30k); below
 * that we clamp. Negative `rankNum` flips to the dan range (1d, 2d, ...).
 *
 * Fix vs the Python source: the original had `max(1, ...)` clamping the
 * raw rank number before the dan-vs-kyu branch, making the `<=0` branch
 * unreachable. So `to_go_rank(mu=2500)` returned "1k" instead of "1d".
 * We drop the `max(1, ...)` and let negative `rankNum` flow into the
 * dan branch.
 */
export function toGoRank(r: Rating): string {
  let rankNum = Math.round((2000 - r.mu) / 100) + 5;
  if (rankNum > 30) rankNum = 30;
  if (rankNum <= 0) return `${Math.abs(rankNum) + 1}d`;
  return `${rankNum}k`;
}

/**
 * Inverse of `toGoRank`: rank label → approximate Glicko rating. Used to
 * seed the player's starting mu from their current rung (e.g. 30k → 500),
 * and to compare against bot opponents' rated strengths during updates.
 *
 * Fixes the dan-side bug in the original Python: `1d` should be one rank
 * STRONGER than `1k` (mu 2500 vs 2400), not weaker. The Python's formula
 * (`2000 + dan*100`) gave `1d` = 2100, less than `1k` = 2400. We use
 * `2400 + dan*100` so 1d=2500, 2d=2600, etc., consistent with the kyu side.
 */
export function rankToRating(rank: string): number {
  const r = rank.trim().toLowerCase();
  if (r.endsWith('k')) {
    const kyu = parseInt(r.slice(0, -1), 10);
    if (Number.isNaN(kyu)) return 1500;
    return 2000 - (kyu - 5) * 100; // 5k = 2000, 15k = 1000, 30k = 500
  }
  if (r.endsWith('d')) {
    const dan = parseInt(r.slice(0, -1), 10);
    if (Number.isNaN(dan)) return 1500;
    return 2400 + dan * 100; // 1d = 2500, 2d = 2600, ...
  }
  return 1500;
}

function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

/**
 * Update a player's rating after a single game.
 *
 * @param player   Current rating.
 * @param oppMu    Opponent's mu.
 * @param oppPhi   Opponent's phi.
 * @param score    1 for win, 0 for loss, 0.5 for draw.
 */
export function updateRating(
  player: Rating,
  oppMu: number,
  oppPhi: number,
  score: number,
): Rating {
  // Step 1: convert to Glicko-2 scale.
  const mu = (player.mu - 1500) / 173.7178;
  const phi = player.phi / 173.7178;
  const oppMu2 = (oppMu - 1500) / 173.7178;
  const oppPhi2 = oppPhi / 173.7178;

  // Step 2: variance.
  const gPhi = g(oppPhi2);
  const E = 1 / (1 + Math.exp(-gPhi * (mu - oppMu2)));
  const v = 1 / (gPhi * gPhi * E * (1 - E));

  // Step 3: delta.
  const delta = v * gPhi * (score - E);

  // Step 4: volatility (Illinois algorithm).
  const a = Math.log(player.sigma * player.sigma);
  const phi2 = phi * phi;

  const f = (x: number): number => {
    const ex = Math.exp(x);
    return (
      (ex * (delta * delta - phi2 - v - ex)) /
        (2 * (phi2 + v + ex) * (phi2 + v + ex)) -
      (x - a) / (TAU * TAU)
    );
  };

  let A = a;
  let B: number;
  if (delta * delta > phi2 + v) {
    B = Math.log(delta * delta - phi2 - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k += 1;
    B = a - k * TAU;
  }

  let fA = f(A);
  let fB = f(B);

  for (let i = 0; i < 100; i++) {
    if (Math.abs(B - A) < EPSILON) break;
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
  }

  const newSigma = Math.exp(A / 2);

  // Step 5: pre-rating-period phi.
  const phiStar = Math.sqrt(phi2 + newSigma * newSigma);

  // Step 6: new phi and mu.
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const newMu = mu + newPhi * newPhi * gPhi * (score - E);

  return {
    mu: newMu * 173.7178 + 1500,
    phi: newPhi * 173.7178,
    sigma: newSigma,
  };
}
