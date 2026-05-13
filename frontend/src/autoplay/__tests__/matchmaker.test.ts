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
} from '../matchmaker';

describe('matchupForRung', () => {
  it('30k is even vs the 30k bot', () => {
    expect(matchupForRung('30k')).toEqual({ bot: '30k', handicap: 0, validated: true });
  });

  it('27k is H9 vs 18k bot — the first big jump after the 30k start', () => {
    expect(matchupForRung('27k')).toEqual({ bot: '18k', handicap: 9, validated: true });
  });

  it('19k is H1 vs 18k bot, the last rung before 18k even', () => {
    expect(matchupForRung('19k')).toEqual({ bot: '18k', handicap: 1, validated: true });
  });

  it('18k is even vs 18k bot', () => {
    expect(matchupForRung('18k')).toEqual({ bot: '18k', handicap: 0, validated: true });
  });

  it('17k transitions to the next bot (15k) with H2', () => {
    expect(matchupForRung('17k')).toEqual({ bot: '15k', handicap: 2, validated: true });
  });

  it('5k uses the 3k bot, currently unvalidated', () => {
    expect(matchupForRung('5k')).toEqual({ bot: '3k', handicap: 2, validated: false });
  });

  it('1d (top of ladder) is currently unvalidated', () => {
    expect(matchupForRung('1d')).toEqual({ bot: '1d', handicap: 0, validated: false });
  });

  it('throws on an unknown rung', () => {
    expect(() => matchupForRung('99k')).toThrow();
  });
});

describe('LADDER_RUNGS', () => {
  it('starts at 30k and ends at 1d', () => {
    expect(LADDER_RUNGS[0]).toBe('30k');
    expect(LADDER_RUNGS[LADDER_RUNGS.length - 1]).toBe('1d');
    expect(STARTING_RUNG).toBe('30k');
  });

  it('has 29 unique rungs (30k→27k skips 28k/29k because no validated bot fills that gap)', () => {
    expect(LADDER_RUNGS.length).toBe(29);
    expect(new Set(LADDER_RUNGS).size).toBe(29);
  });

  it('every step is exactly 1 effective rank stronger than the previous (except the 30k → 27k 3-rank jump)', () => {
    function effectiveKyu(rung: string): number {
      const m = matchupForRung(rung);
      // 1d treated as kyu=0; effective opponent strength = bot_kyu + handicap.
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

describe('nextRung', () => {
  it('returns the next rung up', () => {
    expect(nextRung('30k')).toBe('27k');
    expect(nextRung('19k')).toBe('18k');
    expect(nextRung('18k')).toBe('17k');
  });

  it('returns null at the top', () => {
    expect(nextRung('1d')).toBeNull();
  });
});

describe('isNextRungValidated', () => {
  it('true when the next rung uses a calibrated bot', () => {
    expect(isNextRungValidated('30k')).toBe(true);  // 27k → 18k bot
    expect(isNextRungValidated('7k')).toBe(true);   // 6k → 6k bot
  });

  it('false when the next rung uses an unvalidated bot (6k → 5k uses 3k bot)', () => {
    expect(isNextRungValidated('6k')).toBe(false);
  });

  it('false at the top of the ladder', () => {
    expect(isNextRungValidated('1d')).toBe(false);
  });
});

describe('applyResult', () => {
  it('loss: increments lossStreak, no other change', () => {
    const out = applyResult({ currentRung: '30k', winsAtCurrentRung: 1, lossStreak: 0 }, 'loss');
    expect(out.state).toEqual({ currentRung: '30k', winsAtCurrentRung: 1, lossStreak: 1 });
    expect(out.promoted).toBe(false);
  });

  it('win below threshold: increments wins, resets lossStreak', () => {
    const out = applyResult({ currentRung: '30k', winsAtCurrentRung: 0, lossStreak: 3 }, 'win');
    expect(out.state).toEqual({ currentRung: '30k', winsAtCurrentRung: 1, lossStreak: 0 });
    expect(out.promoted).toBe(false);
  });

  it('win that hits threshold: promotes to next rung', () => {
    const out = applyResult(
      { currentRung: '30k', winsAtCurrentRung: WINS_TO_PROMOTE - 1, lossStreak: 0 },
      'win',
    );
    expect(out.promoted).toBe(true);
    expect(out.fromRung).toBe('30k');
    expect(out.state).toEqual({ currentRung: '27k', winsAtCurrentRung: 0, lossStreak: 0 });
  });

  it('promotion at validation wall holds at current rung (6k → 5k blocked)', () => {
    const out = applyResult(
      { currentRung: '6k', winsAtCurrentRung: WINS_TO_PROMOTE - 1, lossStreak: 0 },
      'win',
    );
    expect(out.promoted).toBe(false);
    expect(out.state.currentRung).toBe('6k');
    expect(out.state.winsAtCurrentRung).toBe(WINS_TO_PROMOTE);
    expect(out.state.lossStreak).toBe(0);
  });

  it('promotion at top of ladder holds at 1d', () => {
    const out = applyResult(
      { currentRung: '1d', winsAtCurrentRung: WINS_TO_PROMOTE - 1, lossStreak: 0 },
      'win',
    );
    expect(out.promoted).toBe(false);
    expect(out.state.currentRung).toBe('1d');
    expect(out.state.winsAtCurrentRung).toBe(WINS_TO_PROMOTE);
  });

  it('integration: three wins from 30k promotes to 27k', () => {
    let s = freshState();
    for (let i = 0; i < 3; i++) {
      const out = applyResult(s, 'win');
      s = out.state;
      if (i < 2) expect(out.promoted).toBe(false);
      else expect(out.promoted).toBe(true);
    }
    expect(s.currentRung).toBe('27k');
  });

  it('integration: losses do not delay promotion progress', () => {
    let s = freshState();
    s = applyResult(s, 'win').state;        // 1 win
    s = applyResult(s, 'loss').state;       // loss (no effect on wins)
    s = applyResult(s, 'loss').state;       // loss
    s = applyResult(s, 'win').state;        // 2 wins
    expect(s.winsAtCurrentRung).toBe(2);
    const out = applyResult(s, 'win');      // 3 wins → promote
    expect(out.promoted).toBe(true);
    expect(out.state.currentRung).toBe('27k');
  });
});

describe('effectiveMatchup (anti-frustration safeguard)', () => {
  it('lossStreak below threshold: returns base matchup', () => {
    expect(effectiveMatchup('18k', SAFEGUARD_LOSS_THRESHOLD - 1)).toEqual({
      bot: '18k', handicap: 0, validated: true,
    });
  });

  it('lossStreak at threshold: adds +2 stones', () => {
    expect(effectiveMatchup('18k', SAFEGUARD_LOSS_THRESHOLD)).toEqual({
      bot: '18k', handicap: 2, validated: true,
    });
  });

  it('lossStreak above threshold: still +2 stones (no stacking)', () => {
    expect(effectiveMatchup('18k', SAFEGUARD_LOSS_THRESHOLD + 5)).toEqual({
      bot: '18k', handicap: 2, validated: true,
    });
  });

  it('27k safeguard is a no-op (already at H9, the engine cap)', () => {
    expect(effectiveMatchup('27k', SAFEGUARD_LOSS_THRESHOLD)).toEqual({
      bot: '18k', handicap: 9, validated: true,
    });
  });

  it('partial boost when base is mid-range (8k base H2 + 2 = H4)', () => {
    expect(effectiveMatchup('8k', SAFEGUARD_LOSS_THRESHOLD).handicap).toBe(4);
  });
});

describe('isSafeguardActive', () => {
  it('false below threshold', () => {
    expect(isSafeguardActive('18k', 0)).toBe(false);
    expect(isSafeguardActive('18k', SAFEGUARD_LOSS_THRESHOLD - 1)).toBe(false);
  });

  it('true at threshold for rungs that can take the boost', () => {
    expect(isSafeguardActive('18k', SAFEGUARD_LOSS_THRESHOLD)).toBe(true);
    expect(isSafeguardActive('8k', SAFEGUARD_LOSS_THRESHOLD)).toBe(true);
  });

  it('false at threshold for rungs already at MAX_HANDICAP (27k)', () => {
    expect(isSafeguardActive('27k', SAFEGUARD_LOSS_THRESHOLD)).toBe(false);
  });
});

describe('freshState', () => {
  it('starts at 30k with no progress', () => {
    expect(freshState()).toEqual({
      currentRung: '30k',
      winsAtCurrentRung: 0,
      lossStreak: 0,
    });
  });
});
