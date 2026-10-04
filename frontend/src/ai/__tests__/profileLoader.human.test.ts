import { describe, it, expect } from 'vitest';
import { getHumanProfile, getProfile, loadHumanTable } from '../profileLoader';

/**
 * The two profile sets on the device: b28.yaml (every rung, standard path)
 * and b28_human.yaml (only the rungs on the human path). The human set is
 * looked up by exact rank and size; a rank it lacks is undefined, never a
 * fallback.
 */

const STANDARD_KNOBS = { max_point_loss: 30, mistake_freq: 0.8, policy_weight: 0.1, randomness: 0.7, random_move_chance: 0.1, local_bias: 0, first_line_chance: 0, visits: 16, min_candidates: 10, opening_moves: 3 };

describe('the human set (b28_human.yaml)', () => {
  it('holds the 9×9 18k, 15k and 12k with their human knobs', () => {
    const want = {
      '18k': { tilt: 4.0, cap: 10.0 },
      '15k': { tilt: -8.0, cap: 10.0 },
      '12k': { tilt: -4.0, cap: 4.0 },
    };
    for (const [rank, { tilt, cap }] of Object.entries(want)) {
      const p = getHumanProfile(rank, 9)!;
      expect(p).toBeDefined();
      expect(p).toMatchObject({
        human_sl_profile: 'rank_20k',
        human_tilt: tilt,
        human_tilt_from: 12,
        human_cand_min: 0.03,
        human_cand_max: 8,
        human_score_visits: 4,
        human_pass_margin: 0.5,
        human_small_gain: 2.0,
        human_confirm_visits: 12,
        human_confirm_margin: 0.75,
        human_loss_cap: cap,
      });
    }
  });

  it('carries the standard knobs of the same b28.yaml rung', () => {
    for (const rank of ['18k', '15k', '12k']) {
      const human = getHumanProfile(rank, 9)!;
      const standard = getProfile(rank, 9) as unknown as Record<string, unknown>;
      for (const [k, v] of Object.entries(standard)) expect(human[k as keyof typeof human]).toEqual(v);
    }
  });

  it('has nothing for any other rank or size, and does not fall back', () => {
    for (const [rank, size] of [
      ['9k', 9],
      ['6k', 9],
      ['30k', 9],
      ['18k', 19],
      ['15k', 13],
      ['15k', 19],
      ['12k', 5],
      ['constructor', 9],
      ['toString', 9],
    ] as const) {
      expect(getHumanProfile(rank, size)).toBeUndefined();
    }
  });
});

describe('the standard set (b28.yaml) is as before', () => {
  it('carries no human knobs on the 9×9 rungs the human set covers', () => {
    for (const rank of ['18k', '15k', '12k']) {
      const p = getProfile(rank, 9);
      expect(Object.keys(p).filter((k) => k.startsWith('human_'))).toEqual([]);
    }
  });

  it("keeps getProfile's fallbacks: same rank on 19×19, then 19×19 15k", () => {
    expect(getProfile('9k', 13)).toBe(getProfile('9k', 19));
    expect(getProfile('no-such-rank', 9)).toBe(getProfile('15k', 19));
  });
});

describe('loadHumanTable', () => {
  const table = (ranks: Record<string, Record<string, unknown>>) => ({ profiles: { '9x9': ranks } });

  it('needs no 19×19 15k', () => {
    const t = loadHumanTable(table({ '18k': { ...STANDARD_KNOBS, human_sl_profile: 'rank_20k' } }));
    expect(t[9]['18k'].human_sl_profile).toBe('rank_20k');
  });

  it('refuses a rung that names no human profile', () => {
    expect(() => loadHumanTable(table({ '18k': { ...STANDARD_KNOBS } }))).toThrow(/9x9\/18k must name its human_sl_profile/);
    expect(() => loadHumanTable(table({ '18k': { ...STANDARD_KNOBS, human_sl_profile: '' } }))).toThrow(/human_sl_profile/);
  });

  it('keeps the standard checks', () => {
    const { visits: _visits, ...noVisits } = STANDARD_KNOBS;
    void _visits;
    expect(() => loadHumanTable(table({ '18k': { ...noVisits, human_sl_profile: 'rank_20k' } }))).toThrow(/missing required key 'visits'/);
    expect(() => loadHumanTable({ profiles: { '7x7': {} } })).toThrow(/unsupported board size/);
  });
});
