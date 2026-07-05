import { describe, it, expect } from 'vitest';
import {
  LADDER_RUNGS,
  STARTING_RUNG,
  WINS_TO_PROMOTE,
  SAFEGUARD_LOSS_THRESHOLD,
  applyResult,
  effectiveMatchup,
  isSafeguardActive,
  matchupForRung,
  nextRung,
  prevRung,
  isNextRungValidated,
  freshState,
  ladderRungs,
  startingRung,
  hasLadder,
  winsToPromote,
  lossSetbackActive,
  isColorSymmetric,
  gameMatchup,
} from '../matchmaker';

describe('matchupForRung (19×19)', () => {
  it('30k is even vs the 30k bot, player Black', () => {
    expect(matchupForRung('30k')).toEqual({ bot: '30k', playerColor: 'black', handicap: 0, validated: true });
  });

  it('27k is H9 vs 18k bot — the first big jump after the 30k start', () => {
    expect(matchupForRung('27k')).toEqual({ bot: '18k', playerColor: 'black', handicap: 9, validated: true });
  });

  it('18k is even vs 18k bot', () => {
    expect(matchupForRung('18k')).toEqual({ bot: '18k', playerColor: 'black', handicap: 0, validated: true });
  });

  it('17k transitions to the next bot (15k) with H2', () => {
    expect(matchupForRung('17k')).toEqual({ bot: '15k', playerColor: 'black', handicap: 2, validated: true });
  });

  it('5k uses the 3k bot, currently unvalidated', () => {
    expect(matchupForRung('5k')).toEqual({ bot: '3k', playerColor: 'black', handicap: 2, validated: false });
  });

  it('1d (top of ladder) is currently unvalidated', () => {
    expect(matchupForRung('1d')).toEqual({ bot: '1d', playerColor: 'black', handicap: 0, validated: false });
  });

  it('throws on an unknown rung', () => {
    expect(() => matchupForRung('99k')).toThrow();
  });
});

describe('LADDER_RUNGS (19×19)', () => {
  it('starts at 30k and ends at 1d', () => {
    expect(LADDER_RUNGS[0]).toBe('30k');
    expect(LADDER_RUNGS[LADDER_RUNGS.length - 1]).toBe('1d');
    expect(STARTING_RUNG).toBe('30k');
  });

  it('has 29 unique rungs', () => {
    expect(LADDER_RUNGS.length).toBe(29);
    expect(new Set(LADDER_RUNGS).size).toBe(29);
  });

  it('every step is exactly 1 effective rank stronger (except the 30k → 27k 3-rank jump)', () => {
    function effectiveKyu(rung: string): number {
      const m = matchupForRung(rung);
      const botKyu = m.bot === '1d' ? 0 : parseInt(m.bot, 10);
      return botKyu + m.handicap;
    }
    let prev = effectiveKyu(LADDER_RUNGS[0]);
    for (let i = 1; i < LADDER_RUNGS.length; i++) {
      const cur = effectiveKyu(LADDER_RUNGS[i]);
      const expected = i === 1 ? prev - 3 : prev - 1;
      expect(cur, `step ${LADDER_RUNGS[i - 1]} → ${LADDER_RUNGS[i]}`).toBe(expected);
      prev = cur;
    }
  });
});

describe('nextRung / promotion (19×19)', () => {
  it('returns the next rung up, null at the top', () => {
    expect(nextRung('30k')).toBe('27k');
    expect(nextRung('18k')).toBe('17k');
    expect(nextRung('1d')).toBeNull();
  });

  it('validation wall: 6k → 5k blocked (5k uses the unvalidated 3k bot)', () => {
    expect(isNextRungValidated('30k')).toBe(true);
    expect(isNextRungValidated('6k')).toBe(false);
    expect(isNextRungValidated('1d')).toBe(false);
  });

  it('loss increments streak; three wins promote; losses do not delay wins below 12k', () => {
    expect(applyResult({ currentRung: '30k', winsAtCurrentRung: 1, lossStreak: 0 }, 'loss').state)
      .toEqual({ currentRung: '30k', winsAtCurrentRung: 1, lossStreak: 1 });
    const promo = applyResult({ currentRung: '30k', winsAtCurrentRung: WINS_TO_PROMOTE - 1, lossStreak: 0 }, 'win');
    expect(promo.promoted).toBe(true);
    expect(promo.state.currentRung).toBe('27k');
  });

  it('promotion holds at the validation wall (6k) and the ladder top (1d), pinned at the rung threshold', () => {
    const wall = applyResult({ currentRung: '6k', winsAtCurrentRung: winsToPromote('6k') - 1, lossStreak: 0 }, 'win');
    expect(wall.promoted).toBe(false);
    expect(wall.state).toEqual({ currentRung: '6k', winsAtCurrentRung: winsToPromote('6k'), lossStreak: 0 });
    const top = applyResult({ currentRung: '1d', winsAtCurrentRung: winsToPromote('1d') - 1, lossStreak: 0 }, 'win');
    expect(top.promoted).toBe(false);
    expect(top.state).toEqual({ currentRung: '1d', winsAtCurrentRung: winsToPromote('1d'), lossStreak: 0 });
  });
});

/* ========================================================================= *
 * Feature 25 — ranked promotion polish (2026-06-11).
 * ========================================================================= */

describe('graduated promotion thresholds (feature 25)', () => {
  it('19×19: 3 below 12k, 4 from 12k, 5 from 5k', () => {
    expect(winsToPromote('30k')).toBe(3);
    expect(winsToPromote('13k')).toBe(3);
    expect(winsToPromote('12k')).toBe(4);
    expect(winsToPromote('6k')).toBe(4);
    expect(winsToPromote('5k')).toBe(5);
    expect(winsToPromote('1d')).toBe(5);
  });

  it('9×9: same rank boundaries', () => {
    expect(winsToPromote('30k', 9)).toBe(3);
    expect(winsToPromote('13k', 9)).toBe(3);
    expect(winsToPromote('12k', 9)).toBe(4);
    expect(winsToPromote('6k', 9)).toBe(4);
    expect(winsToPromote('5k', 9)).toBe(5);
    expect(winsToPromote('1d', 9)).toBe(5);
  });

  it('a 4-win rung promotes on the 4th win, not the 3rd', () => {
    const third = applyResult({ currentRung: '12k', winsAtCurrentRung: 2, lossStreak: 0 }, 'win', 9);
    expect(third.promoted).toBe(false);
    expect(third.state.winsAtCurrentRung).toBe(3);
    const fourth = applyResult(third.state, 'win', 9);
    expect(fourth.promoted).toBe(true);
    expect(fourth.state.currentRung).toBe('11k');
  });
});

describe('loss setback from 12k (feature 25)', () => {
  it('below 12k a loss leaves wins untouched', () => {
    expect(lossSetbackActive('13k', 9)).toBe(false);
    const out = applyResult({ currentRung: '13k', winsAtCurrentRung: 2, lossStreak: 0 }, 'loss', 9);
    expect(out.state).toEqual({ currentRung: '13k', winsAtCurrentRung: 2, lossStreak: 1 });
  });

  it('from 12k each loss costs one win, floored at 0 — never the rung itself', () => {
    expect(lossSetbackActive('12k', 9)).toBe(true);
    const a = applyResult({ currentRung: '12k', winsAtCurrentRung: 2, lossStreak: 0 }, 'loss', 9);
    expect(a.state).toEqual({ currentRung: '12k', winsAtCurrentRung: 1, lossStreak: 1 });
    const b = applyResult(a.state, 'loss', 9);
    expect(b.state).toEqual({ currentRung: '12k', winsAtCurrentRung: 0, lossStreak: 2 });
    const c = applyResult(b.state, 'loss', 9);
    expect(c.state).toEqual({ currentRung: '12k', winsAtCurrentRung: 0, lossStreak: 3 });
  });

  it('applies on 19×19 too', () => {
    expect(applyResult({ currentRung: '9k', winsAtCurrentRung: 3, lossStreak: 0 }, 'loss').state.winsAtCurrentRung).toBe(2);
  });

  it('a win still resets the loss streak in the setback tier', () => {
    const out = applyResult({ currentRung: '12k', winsAtCurrentRung: 1, lossStreak: 3 }, 'win', 9);
    expect(out.state).toEqual({ currentRung: '12k', winsAtCurrentRung: 2, lossStreak: 0 });
  });
});

describe('color variety on symmetric rungs (feature 25 follow-up)', () => {
  it('identifies color-symmetric rungs on 9×9 — even (6.5 komi) only', () => {
    expect(isColorSymmetric('28k', 9)).toBe(true);
    expect(isColorSymmetric('15k', 9)).toBe(true);
    expect(isColorSymmetric('9k', 9)).toBe(true);
    expect(isColorSymmetric('1d', 9)).toBe(true);
    expect(isColorSymmetric('30k', 9)).toBe(false); // komi 0 — Black's edge
    expect(isColorSymmetric('10k', 9)).toBe(false); // 3.5 komi — Black's edge
    expect(isColorSymmetric('25k', 9)).toBe(false); // spec'd White rung (30k bot +2)
    expect(isColorSymmetric('22k', 9)).toBe(false); // handicap stones (18k bot +2)
  });

  it('identifies color-symmetric rungs on 19×19 — even games (engine-default komi)', () => {
    expect(isColorSymmetric('18k')).toBe(true);
    expect(isColorSymmetric('30k')).toBe(true); // symmetric, but excluded as starting rung below
    expect(isColorSymmetric('1d')).toBe(true);
    expect(isColorSymmetric('17k')).toBe(false); // handicap stones
  });

  it('alternates the player color by games already played at the rung', () => {
    expect(gameMatchup('15k', 0, 0, 9).playerColor).toBe('black');
    expect(gameMatchup('15k', 0, 1, 9).playerColor).toBe('white');
    expect(gameMatchup('15k', 0, 2, 9).playerColor).toBe('black');
    // The even game's komi rides along unchanged — symmetric by definition.
    expect(gameMatchup('15k', 0, 1, 9).komi).toBe(6.5);
  });

  it('in-between 9×9 rungs alternate to a White game vs the weaker bot (S44)', () => {
    // 17k even game: Black vs the stronger 15k bot with advantage (komi 0).
    expect(gameMatchup('17k', 0, 0, 9)).toEqual({ bot: '15k', playerColor: 'black', handicap: 0, komi: 0, validated: true });
    // 17k odd game: White vs the weaker 18k bot, difficulty-matched (komi 3.5).
    expect(gameMatchup('17k', 0, 1, 9)).toEqual({ bot: '18k', playerColor: 'white', handicap: 0, komi: 3.5, validated: true });
    // 16k mirrors: Black komi 3.5 ↔ White vs 18k komi 0.
    expect(gameMatchup('16k', 0, 1, 9)).toEqual({ bot: '18k', playerColor: 'white', handicap: 0, komi: 0, validated: true });
    // Back to Black on the next even game.
    expect(gameMatchup('17k', 0, 2, 9).playerColor).toBe('black');
    // The white-alt bot is always the next-WEAKER real bot, never named unless validated.
    for (const [rung, weaker] of [['14k', '15k'], ['11k', '12k'], ['8k', '9k'], ['5k', '6k'], ['2k', '3k']] as const) {
      const alt = gameMatchup(rung, 0, 1, 9);
      expect(alt.playerColor, rung).toBe('white');
      expect(alt.bot, rung).toBe(weaker);
      expect(alt.validated, rung).toBe(true);
    }
  });

  it('desert in-between rungs (20k/19k) have no weaker sampling bot → never flip', () => {
    // Below 18k only the 30k heuristic lives, so these stay Black-only.
    expect(gameMatchup('20k', 0, 1, 9).playerColor).toBe('black');
    expect(gameMatchup('20k', 0, 1, 9).bot).toBe('18k');
    expect(gameMatchup('19k', 0, 1, 9).playerColor).toBe('black');
  });

  it('never flips non-symmetric rungs', () => {
    expect(gameMatchup('30k', 0, 1, 9).playerColor).toBe('black'); // komi-0 rung
    expect(gameMatchup('25k', 0, 0, 9).playerColor).toBe('white'); // spec'd White stays White
    expect(gameMatchup('25k', 0, 1, 9).playerColor).toBe('white');
    expect(gameMatchup('17k', 0, 1).playerColor).toBe('black');    // 19×19 stones
  });

  it('never flips the starting rung — brand-new players get consistency', () => {
    expect(gameMatchup('30k', 0, 1).playerColor).toBe('black'); // 19×19 30k is symmetric but excluded
  });

  it('pauses variety while the safeguard is active (its easing assumes Black)', () => {
    const m = gameMatchup('15k', SAFEGUARD_LOSS_THRESHOLD, 1, 9);
    expect(m.playerColor).toBe('black');
    expect(m.komi).toBe(0.5); // eased komi rung
  });
});

describe('prevRung (feature 25 — voluntary derank)', () => {
  it('returns the rung below, null at the bottom', () => {
    expect(prevRung('27k')).toBe('30k');
    expect(prevRung('30k')).toBeNull();
    expect(prevRung('28k', 9)).toBe('30k');
    expect(prevRung('30k', 9)).toBeNull();
    expect(prevRung('1d', 9)).toBe('1k');
  });

  it('throws on a rung the board does not have', () => {
    expect(() => prevRung('28k')).toThrow(); // 28k exists only on the 9×9 ladder
  });
});

describe('effectiveMatchup safeguard (19×19 stones)', () => {
  it('below threshold returns the base matchup', () => {
    expect(effectiveMatchup('18k', SAFEGUARD_LOSS_THRESHOLD - 1)).toEqual({
      bot: '18k', playerColor: 'black', handicap: 0, validated: true,
    });
  });

  it('at threshold adds +2 stones (no stacking above)', () => {
    expect(effectiveMatchup('18k', SAFEGUARD_LOSS_THRESHOLD).handicap).toBe(2);
    expect(effectiveMatchup('18k', SAFEGUARD_LOSS_THRESHOLD + 5).handicap).toBe(2);
    expect(effectiveMatchup('8k', SAFEGUARD_LOSS_THRESHOLD).handicap).toBe(4);
  });

  it('is a no-op at the H9 engine cap (27k)', () => {
    expect(effectiveMatchup('27k', SAFEGUARD_LOSS_THRESHOLD).handicap).toBe(9);
    expect(isSafeguardActive('27k', SAFEGUARD_LOSS_THRESHOLD)).toBe(false);
  });

  it('one win after the safeguard returns the player to the base matchup (Patrick requirement, 2026-06-11)', () => {
    // 5 straight losses at 18k → safeguard eases the matchup.
    let state = { currentRung: '18k', winsAtCurrentRung: 0, lossStreak: 0 };
    for (let i = 0; i < SAFEGUARD_LOSS_THRESHOLD; i++) state = applyResult(state, 'loss').state;
    expect(isSafeguardActive(state.currentRung, state.lossStreak)).toBe(true);
    expect(effectiveMatchup(state.currentRung, state.lossStreak).handicap).toBe(2);
    // One win — streak resets, and the very next game is the real matchup again.
    state = applyResult(state, 'win').state;
    expect(state.lossStreak).toBe(0);
    expect(isSafeguardActive(state.currentRung, state.lossStreak)).toBe(false);
    expect(effectiveMatchup(state.currentRung, state.lossStreak)).toEqual(matchupForRung('18k'));
  });
});

describe('freshState (19×19 default)', () => {
  it('starts at 30k with no progress', () => {
    expect(freshState()).toEqual({ currentRung: '30k', winsAtCurrentRung: 0, lossStreak: 0 });
  });
});

/* ========================================================================= *
 * 9×9 ladder — feature 24, full 23-rung points model (2026-06-04).
 * ========================================================================= */

const RUNGS_9 = [
  '30k', '28k', '25k', '22k', // 30k→20k desert (stones)
  '20k', '19k', '18k', // 18k bot komi triple (NEW)
  '17k', '16k', '15k', // 15k bot
  '14k', '13k', '12k', // 12k bot komi triple (NEW)
  '11k', '10k', '9k', // 9k bot
  '8k', '7k', '6k', // 6k bot
  '5k', '4k', '3k', // 3k bot
  '2k', '1k', '1d', // 1d bot
];

describe('9×9 ladder structure', () => {
  it('exists for 9×9 + 19×19, not for 13×13', () => {
    expect(hasLadder(9)).toBe(true);
    expect(hasLadder(19)).toBe(true);
    expect(hasLadder(13)).toBe(false);
    expect(() => ladderRungs(13)).toThrow();
  });

  it('is the full 25-rung ramp from 30k to 1d', () => {
    expect(ladderRungs(9)).toEqual(RUNGS_9);
    expect(startingRung(9)).toBe('30k');
  });

  it('only ever names a bot with a real 9×9 profile, and all rungs validated', () => {
    const REAL = new Set(['30k', '18k', '15k', '12k', '9k', '6k', '3k', '1d']);
    for (const rung of RUNGS_9) {
      const m = matchupForRung(rung, 9);
      expect(REAL.has(m.bot), `${rung} → ${m.bot}`).toBe(true);
      expect(m.validated, rung).toBe(true);
    }
  });

  it('handicap STONES survive only in the 30k→20k desert (rebuilt S44)', () => {
    for (const rung of RUNGS_9) {
      const m = matchupForRung(rung, 9);
      if (m.handicap > 0) {
        expect(['25k', '22k'], `${rung} has stones`).toContain(rung);
      }
    }
  });
});

describe('9×9 rung definitions (Patrick points model, rebuilt S44)', () => {
  it('30k→20k desert: 30k no-komi → even → you-White bot+2 → you+2 vs 18k', () => {
    expect(matchupForRung('30k', 9)).toEqual({ bot: '30k', playerColor: 'black', handicap: 0, komi: 0, validated: true });
    expect(matchupForRung('28k', 9)).toEqual({ bot: '30k', playerColor: 'black', handicap: 0, komi: 6.5, validated: true });
    expect(matchupForRung('25k', 9)).toEqual({ bot: '30k', playerColor: 'white', handicap: 2, validated: true });
    expect(matchupForRung('22k', 9)).toEqual({ bot: '18k', playerColor: 'black', handicap: 2, validated: true });
  });

  it('18k bot (NEW): komi triple no-komi → 3.5 → even', () => {
    expect(matchupForRung('20k', 9)).toEqual({ bot: '18k', playerColor: 'black', handicap: 0, komi: 0, validated: true });
    expect(matchupForRung('19k', 9)).toEqual({ bot: '18k', playerColor: 'black', handicap: 0, komi: 3.5, validated: true });
    expect(matchupForRung('18k', 9)).toEqual({ bot: '18k', playerColor: 'black', handicap: 0, komi: 6.5, validated: true });
  });

  it('15k bot: komi triple (no more +4/+3 stone grind)', () => {
    expect(matchupForRung('17k', 9)).toEqual({ bot: '15k', playerColor: 'black', handicap: 0, komi: 0, validated: true });
    expect(matchupForRung('16k', 9)).toEqual({ bot: '15k', playerColor: 'black', handicap: 0, komi: 3.5, validated: true });
    expect(matchupForRung('15k', 9)).toEqual({ bot: '15k', playerColor: 'black', handicap: 0, komi: 6.5, validated: true });
  });

  it('12k bot (NEW): komi triple no-komi → 3.5 → even (was 9k+2-stones proxy)', () => {
    expect(matchupForRung('14k', 9)).toEqual({ bot: '12k', playerColor: 'black', handicap: 0, komi: 0, validated: true });
    expect(matchupForRung('13k', 9)).toEqual({ bot: '12k', playerColor: 'black', handicap: 0, komi: 3.5, validated: true });
    expect(matchupForRung('12k', 9)).toEqual({ bot: '12k', playerColor: 'black', handicap: 0, komi: 6.5, validated: true });
  });

  it('9k bot: komi triple no-komi → 3.5 → even', () => {
    expect(matchupForRung('11k', 9)).toEqual({ bot: '9k', playerColor: 'black', handicap: 0, komi: 0, validated: true });
    expect(matchupForRung('10k', 9)).toEqual({ bot: '9k', playerColor: 'black', handicap: 0, komi: 3.5, validated: true });
    expect(matchupForRung('9k', 9)).toEqual({ bot: '9k', playerColor: 'black', handicap: 0, komi: 6.5, validated: true });
  });

  it('strong bots (6k/3k/1d) each ramp no-komi → 3.5 → 6.5', () => {
    expect(matchupForRung('8k', 9)).toEqual({ bot: '6k', playerColor: 'black', handicap: 0, komi: 0, validated: true });
    expect(matchupForRung('7k', 9)).toEqual({ bot: '6k', playerColor: 'black', handicap: 0, komi: 3.5, validated: true });
    expect(matchupForRung('6k', 9)).toEqual({ bot: '6k', playerColor: 'black', handicap: 0, komi: 6.5, validated: true });
    expect(matchupForRung('5k', 9).bot).toBe('3k');
    expect(matchupForRung('2k', 9)).toEqual({ bot: '1d', playerColor: 'black', handicap: 0, komi: 0, validated: true });
    expect(matchupForRung('1d', 9)).toEqual({ bot: '1d', playerColor: 'black', handicap: 0, komi: 6.5, validated: true });
  });
});

describe('9×9 navigation + promotion', () => {
  it('walks the chain; bot handoffs land where expected', () => {
    expect(nextRung('30k', 9)).toBe('28k');
    expect(nextRung('22k', 9)).toBe('20k'); // 18k+2 stones → 18k komi triple
    expect(nextRung('18k', 9)).toBe('17k'); // 18k bot → 15k bot
    expect(nextRung('15k', 9)).toBe('14k'); // 15k bot → 12k bot
    expect(nextRung('12k', 9)).toBe('11k'); // 12k bot → 9k bot
    expect(nextRung('1d', 9)).toBeNull();
  });

  it('three wins from 30k promotes to 28k', () => {
    let out = applyResult(freshState(9), 'win', 9);
    out = applyResult(out.state, 'win', 9);
    out = applyResult(out.state, 'win', 9);
    expect(out.promoted).toBe(true);
    expect(out.state.currentRung).toBe('28k');
  });
});

describe('9×9 safeguard eases along each rung\'s own axis', () => {
  it('komi rung (Black, 6.5 komi): drops komi toward the player', () => {
    expect(effectiveMatchup('15k', SAFEGUARD_LOSS_THRESHOLD, 9)).toEqual({
      bot: '15k', playerColor: 'black', handicap: 0, komi: 0.5, validated: true,
    });
  });

  it('Black no-komi rung: adds stones (komi 0 is not > 0.5)', () => {
    expect(effectiveMatchup('30k', SAFEGUARD_LOSS_THRESHOLD, 9)).toEqual({
      bot: '30k', playerColor: 'black', handicap: 2, komi: 0, validated: true,
    });
  });

  it('White-with-bot-stones rung: takes a stone back off the bot', () => {
    expect(effectiveMatchup('25k', SAFEGUARD_LOSS_THRESHOLD, 9)).toEqual({
      bot: '30k', playerColor: 'white', handicap: 0, validated: true, // 2 − 2 → 0
    });
  });

  it('isSafeguardActive fires above threshold, not below', () => {
    expect(isSafeguardActive('15k', SAFEGUARD_LOSS_THRESHOLD, 9)).toBe(true);
    expect(isSafeguardActive('15k', SAFEGUARD_LOSS_THRESHOLD - 1, 9)).toBe(false);
  });
});
