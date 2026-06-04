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
  isNextRungValidated,
  freshState,
  ladderRungs,
  startingRung,
  hasLadder,
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

  it('loss increments streak; three wins promote; losses do not delay wins', () => {
    expect(applyResult({ currentRung: '30k', winsAtCurrentRung: 1, lossStreak: 0 }, 'loss').state)
      .toEqual({ currentRung: '30k', winsAtCurrentRung: 1, lossStreak: 1 });
    const promo = applyResult({ currentRung: '30k', winsAtCurrentRung: WINS_TO_PROMOTE - 1, lossStreak: 0 }, 'win');
    expect(promo.promoted).toBe(true);
    expect(promo.state.currentRung).toBe('27k');
  });

  it('promotion holds at the validation wall (6k) and the ladder top (1d)', () => {
    const wall = applyResult({ currentRung: '6k', winsAtCurrentRung: WINS_TO_PROMOTE - 1, lossStreak: 0 }, 'win');
    expect(wall.promoted).toBe(false);
    expect(wall.state.currentRung).toBe('6k');
    const top = applyResult({ currentRung: '1d', winsAtCurrentRung: WINS_TO_PROMOTE - 1, lossStreak: 0 }, 'win');
    expect(top.promoted).toBe(false);
    expect(top.state.currentRung).toBe('1d');
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
  '30k', '28k', '25k', '23k', '21k', '19k', '17k', '15k', '14k', '13k', '12k',
  '11k', '10k', '9k', '8k', '7k', '6k', '5k', '4k', '3k', '2k', '1k', '1d',
];

describe('9×9 ladder structure', () => {
  it('exists for 9×9 + 19×19, not for 13×13', () => {
    expect(hasLadder(9)).toBe(true);
    expect(hasLadder(19)).toBe(true);
    expect(hasLadder(13)).toBe(false);
    expect(() => ladderRungs(13)).toThrow();
  });

  it('is the full 23-rung ramp from 30k to 1d', () => {
    expect(ladderRungs(9)).toEqual(RUNGS_9);
    expect(startingRung(9)).toBe('30k');
  });

  it('only ever names a bot with a real 9×9 profile, and all rungs validated', () => {
    const REAL = new Set(['30k', '15k', '9k', '6k', '3k', '1d']);
    for (const rung of RUNGS_9) {
      const m = matchupForRung(rung, 9);
      expect(REAL.has(m.bot), `${rung} → ${m.bot}`).toBe(true);
      expect(m.validated, rung).toBe(true);
    }
  });
});

describe('9×9 rung definitions (Patrick points model)', () => {
  it('30k bot: no-komi → 6.5 komi → you-White bot+2 stones', () => {
    expect(matchupForRung('30k', 9)).toEqual({ bot: '30k', playerColor: 'black', handicap: 0, komi: 0, validated: true });
    expect(matchupForRung('28k', 9)).toEqual({ bot: '30k', playerColor: 'black', handicap: 0, komi: 6.5, validated: true });
    expect(matchupForRung('25k', 9)).toEqual({ bot: '30k', playerColor: 'white', handicap: 2, validated: true });
  });

  it('15k bot: +4 → +3 → +2 stones → no-komi → even → you-White 3.5 komi', () => {
    expect(matchupForRung('23k', 9)).toEqual({ bot: '15k', playerColor: 'black', handicap: 4, validated: true });
    expect(matchupForRung('21k', 9)).toEqual({ bot: '15k', playerColor: 'black', handicap: 3, validated: true });
    expect(matchupForRung('19k', 9)).toEqual({ bot: '15k', playerColor: 'black', handicap: 2, validated: true });
    expect(matchupForRung('17k', 9)).toEqual({ bot: '15k', playerColor: 'black', handicap: 0, komi: 0, validated: true });
    expect(matchupForRung('15k', 9)).toEqual({ bot: '15k', playerColor: 'black', handicap: 0, komi: 6.5, validated: true });
    expect(matchupForRung('14k', 9)).toEqual({ bot: '15k', playerColor: 'white', handicap: 0, komi: 3.5, validated: true });
  });

  it('9k bot: +2 → +2 with 3.5 komi → no-komi → 3.5 → even', () => {
    expect(matchupForRung('13k', 9)).toEqual({ bot: '9k', playerColor: 'black', handicap: 2, validated: true });
    expect(matchupForRung('12k', 9)).toEqual({ bot: '9k', playerColor: 'black', handicap: 2, komi: 3.5, validated: true }); // †
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
    expect(nextRung('25k', 9)).toBe('23k'); // 30k bot → 15k bot
    expect(nextRung('14k', 9)).toBe('13k'); // 15k bot → 9k bot
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
