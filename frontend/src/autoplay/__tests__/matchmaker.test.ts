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
  it('30k is even vs the 30k bot', () => {
    expect(matchupForRung('30k')).toEqual({ kind: 'stones', bot: '30k', handicap: 0, validated: true });
  });

  it('27k is H9 vs 18k bot — the first big jump after the 30k start', () => {
    expect(matchupForRung('27k')).toEqual({ kind: 'stones', bot: '18k', handicap: 9, validated: true });
  });

  it('19k is H1 vs 18k bot, the last rung before 18k even', () => {
    expect(matchupForRung('19k')).toEqual({ kind: 'stones', bot: '18k', handicap: 1, validated: true });
  });

  it('18k is even vs 18k bot', () => {
    expect(matchupForRung('18k')).toEqual({ kind: 'stones', bot: '18k', handicap: 0, validated: true });
  });

  it('17k transitions to the next bot (15k) with H2', () => {
    expect(matchupForRung('17k')).toEqual({ kind: 'stones', bot: '15k', handicap: 2, validated: true });
  });

  it('5k uses the 3k bot, currently unvalidated', () => {
    expect(matchupForRung('5k')).toEqual({ kind: 'stones', bot: '3k', handicap: 2, validated: false });
  });

  it('1d (top of ladder) is currently unvalidated', () => {
    expect(matchupForRung('1d')).toEqual({ kind: 'stones', bot: '1d', handicap: 0, validated: false });
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

describe('nextRung (19×19)', () => {
  it('returns the next rung up', () => {
    expect(nextRung('30k')).toBe('27k');
    expect(nextRung('19k')).toBe('18k');
    expect(nextRung('18k')).toBe('17k');
  });

  it('returns null at the top', () => {
    expect(nextRung('1d')).toBeNull();
  });
});

describe('isNextRungValidated (19×19)', () => {
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

describe('applyResult (19×19)', () => {
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

describe('effectiveMatchup (anti-frustration safeguard, 19×19)', () => {
  it('lossStreak below threshold: returns base matchup', () => {
    expect(effectiveMatchup('18k', SAFEGUARD_LOSS_THRESHOLD - 1)).toEqual({
      kind: 'stones', bot: '18k', handicap: 0, validated: true,
    });
  });

  it('lossStreak at threshold: adds +2 stones', () => {
    expect(effectiveMatchup('18k', SAFEGUARD_LOSS_THRESHOLD)).toEqual({
      kind: 'stones', bot: '18k', handicap: 2, validated: true,
    });
  });

  it('lossStreak above threshold: still +2 stones (no stacking)', () => {
    expect(effectiveMatchup('18k', SAFEGUARD_LOSS_THRESHOLD + 5)).toEqual({
      kind: 'stones', bot: '18k', handicap: 2, validated: true,
    });
  });

  it('27k safeguard is a no-op (already at H9, the engine cap)', () => {
    expect(effectiveMatchup('27k', SAFEGUARD_LOSS_THRESHOLD)).toEqual({
      kind: 'stones', bot: '18k', handicap: 9, validated: true,
    });
  });

  it('partial boost when base is mid-range (8k base H2 + 2 = H4)', () => {
    expect(effectiveMatchup('8k', SAFEGUARD_LOSS_THRESHOLD).handicap).toBe(4);
  });
});

describe('isSafeguardActive (19×19)', () => {
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

describe('freshState (19×19 default)', () => {
  it('starts at 30k with no progress', () => {
    expect(freshState()).toEqual({
      currentRung: '30k',
      winsAtCurrentRung: 0,
      lossStreak: 0,
    });
  });
});

/* ========================================================================= *
 * 9×9 hybrid ladder — feature 24.
 * ========================================================================= */

describe('9×9 ladder structure', () => {
  it('exists for 9×9, not for 13×13', () => {
    expect(hasLadder(9)).toBe(true);
    expect(hasLadder(19)).toBe(true);
    expect(hasLadder(13)).toBe(false);
  });

  it('runs weakest→strongest from 30k to 1d', () => {
    const rungs = ladderRungs(9);
    expect(rungs[0]).toBe('30k');
    expect(rungs[rungs.length - 1]).toBe('1d');
    expect(startingRung(9)).toBe('30k');
  });

  it('is the 9-rung chain bridging the 6 real 9×9 profiles', () => {
    expect(ladderRungs(9)).toEqual(['30k', '18k', '15k', '12k', '9k', '6k', '3k', '1k', '1d']);
  });

  it('every rung names a bot with a real 9×9 profile (never 18k/12k bots)', () => {
    const REAL_9X9_PROFILES = new Set(['30k', '15k', '9k', '6k', '3k', '1d']);
    for (const rung of ladderRungs(9)) {
      const m = matchupForRung(rung, 9);
      expect(REAL_9X9_PROFILES.has(m.bot), `${rung} → bot ${m.bot}`).toBe(true);
    }
  });

  it('throws when asked for the uncalibrated 13×13 ladder', () => {
    expect(() => ladderRungs(13)).toThrow();
  });
});

describe('9×9 matchups — hybrid stones/komi bridges (per b28.yaml design)', () => {
  it('real-profile rungs are even-game stones vs their own bot', () => {
    expect(matchupForRung('30k', 9)).toEqual({ kind: 'stones', bot: '30k', handicap: 0, validated: true });
    expect(matchupForRung('15k', 9)).toEqual({ kind: 'stones', bot: '15k', handicap: 0, validated: true });
    expect(matchupForRung('1d', 9)).toEqual({ kind: 'stones', bot: '1d', handicap: 0, validated: true });
  });

  it('18k rung bridges off the 15k bot + komi head start', () => {
    expect(matchupForRung('18k', 9)).toEqual({ kind: 'komi', bot: '15k', handicap: 0, komi: 2, validated: true });
  });

  it('12k rung bridges off the 6k bot + handicap stones', () => {
    expect(matchupForRung('12k', 9)).toEqual({ kind: 'stones', bot: '6k', handicap: 2, validated: true });
  });

  it('1k rung bridges off the 1d bot + komi (grounded in the 1d sweep)', () => {
    expect(matchupForRung('1k', 9)).toEqual({ kind: 'komi', bot: '1d', handicap: 0, komi: 4, validated: true });
  });

  it('all rungs are validated (every bridge bot has a real 9×9 profile)', () => {
    for (const rung of ladderRungs(9)) {
      expect(matchupForRung(rung, 9).validated, rung).toBe(true);
    }
  });
});

describe('9×9 navigation + promotion', () => {
  it('nextRung walks the bridged chain', () => {
    expect(nextRung('30k', 9)).toBe('18k');
    expect(nextRung('6k', 9)).toBe('3k');
    expect(nextRung('3k', 9)).toBe('1k');
    expect(nextRung('1d', 9)).toBeNull();
  });

  it('every non-top rung promotes (no validation wall on 9×9)', () => {
    expect(isNextRungValidated('6k', 9)).toBe(true);
    expect(isNextRungValidated('1k', 9)).toBe(true);
    expect(isNextRungValidated('1d', 9)).toBe(false);  // top
  });

  it('three wins from 30k promotes to 18k on 9×9', () => {
    const s = freshState(9);
    let out = applyResult(s, 'win', 9);
    out = applyResult(out.state, 'win', 9);
    out = applyResult(out.state, 'win', 9);
    expect(out.promoted).toBe(true);
    expect(out.fromRung).toBe('30k');
    expect(out.state.currentRung).toBe('18k');
  });
});

describe('9×9 safeguard — komi rungs ease via komi, stones rungs via stones', () => {
  it('komi rung below threshold returns base komi', () => {
    expect(effectiveMatchup('18k', SAFEGUARD_LOSS_THRESHOLD - 1, 9)).toEqual({
      kind: 'komi', bot: '15k', handicap: 0, komi: 2, validated: true,
    });
  });

  it('komi rung at threshold drops komi by ~1 rank toward the player', () => {
    // base komi 2 − 6 = −4 (lower komi ⇒ more Black/player advantage)
    expect(effectiveMatchup('18k', SAFEGUARD_LOSS_THRESHOLD, 9)).toEqual({
      kind: 'komi', bot: '15k', handicap: 0, komi: -4, validated: true,
    });
  });

  it('stones rung still eases via +2 stones', () => {
    expect(effectiveMatchup('15k', SAFEGUARD_LOSS_THRESHOLD, 9)).toEqual({
      kind: 'stones', bot: '15k', handicap: 2, validated: true,
    });
  });

  it('isSafeguardActive fires for both stones and komi rungs', () => {
    expect(isSafeguardActive('15k', SAFEGUARD_LOSS_THRESHOLD, 9)).toBe(true);
    expect(isSafeguardActive('18k', SAFEGUARD_LOSS_THRESHOLD, 9)).toBe(true);
    expect(isSafeguardActive('18k', SAFEGUARD_LOSS_THRESHOLD - 1, 9)).toBe(false);
  });
});
