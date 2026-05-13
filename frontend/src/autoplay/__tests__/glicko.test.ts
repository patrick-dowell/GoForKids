import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RATING,
  confidenceInterval,
  displayRating,
  rankToRating,
  toGoRank,
  updateRating,
} from '../glicko';

describe('rankToRating', () => {
  it('maps 5k to 2000 (the kyu anchor)', () => {
    expect(rankToRating('5k')).toBe(2000);
  });

  it('maps 15k to 1000 (10 ranks weaker than 5k)', () => {
    expect(rankToRating('15k')).toBe(1000);
  });

  it('maps 30k to -500 (the starting rung; well below the default 1500)', () => {
    expect(rankToRating('30k')).toBe(-500);
  });

  it('maps 1k to 2400', () => {
    expect(rankToRating('1k')).toBe(2400);
  });

  it('maps 1d to 2500 (one rank stronger than 1k — fixes the Python bug)', () => {
    expect(rankToRating('1d')).toBe(2500);
  });

  it('maps 2d to 2600', () => {
    expect(rankToRating('2d')).toBe(2600);
  });

  it('1d is stronger than 1k (the property the bug violated)', () => {
    expect(rankToRating('1d')).toBeGreaterThan(rankToRating('1k'));
  });

  it('whole ladder is monotonic in strength (lower kyu / higher dan = higher rating)', () => {
    const labels = ['30k', '18k', '15k', '12k', '9k', '6k', '3k', '1k', '1d', '2d'];
    const ratings = labels.map(rankToRating);
    for (let i = 1; i < ratings.length; i++) {
      expect(ratings[i]).toBeGreaterThan(ratings[i - 1]);
    }
  });

  it('case-insensitive and tolerates whitespace', () => {
    expect(rankToRating('  15K  ')).toBe(1000);
  });
});

describe('toGoRank', () => {
  it('default rating (mu=1500) maps to 10k by the formula', () => {
    // The original Python comment claimed 1500 = ~15k but the formula
    // actually gives 10k. Document the real mapping here.
    expect(toGoRank(DEFAULT_RATING)).toBe('10k');
  });

  it('mu=1000 → 15k', () => {
    expect(toGoRank({ ...DEFAULT_RATING, mu: 1000 })).toBe('15k');
  });

  it('mu=-500 → 30k (the floor; rankToRating("30k") returns -500)', () => {
    expect(toGoRank({ ...DEFAULT_RATING, mu: -500 })).toBe('30k');
  });

  it('very low mu clamps at 30k', () => {
    expect(toGoRank({ ...DEFAULT_RATING, mu: -2000 })).toBe('30k');
  });

  it('mu=2000 → 5k', () => {
    expect(toGoRank({ ...DEFAULT_RATING, mu: 2000 })).toBe('5k');
  });

  it('mu=2400 → 1k', () => {
    expect(toGoRank({ ...DEFAULT_RATING, mu: 2400 })).toBe('1k');
  });

  it('mu=2500 → 1d (one above 1k)', () => {
    expect(toGoRank({ ...DEFAULT_RATING, mu: 2500 })).toBe('1d');
  });

  it('round-trip: rankToRating → toGoRank for validated rungs', () => {
    const labels = ['30k', '18k', '15k', '12k', '9k', '6k', '3k', '1k', '1d'];
    for (const label of labels) {
      const mu = rankToRating(label);
      expect(toGoRank({ ...DEFAULT_RATING, mu })).toBe(label);
    }
  });
});

describe('displayRating + confidenceInterval', () => {
  it('displayRating rounds mu', () => {
    expect(displayRating({ mu: 1500.4, phi: 100, sigma: 0.06 })).toBe(1500);
    expect(displayRating({ mu: 1500.6, phi: 100, sigma: 0.06 })).toBe(1501);
  });

  it('confidenceInterval is mu ± 2·phi, rounded', () => {
    expect(confidenceInterval({ mu: 1500, phi: 100, sigma: 0.06 })).toEqual([1300, 1700]);
  });
});

describe('updateRating', () => {
  it('a win against an equally-rated opponent raises mu and shrinks phi', () => {
    const r = updateRating(DEFAULT_RATING, 1500, 350, 1);
    expect(r.mu).toBeGreaterThan(1500);
    expect(r.phi).toBeLessThan(350);
  });

  it('a loss against an equally-rated opponent lowers mu and shrinks phi', () => {
    const r = updateRating(DEFAULT_RATING, 1500, 350, 0);
    expect(r.mu).toBeLessThan(1500);
    expect(r.phi).toBeLessThan(350);
  });

  it('a draw against an equal opponent barely changes mu (within tiny epsilon)', () => {
    const r = updateRating(DEFAULT_RATING, 1500, 350, 0.5);
    expect(Math.abs(r.mu - 1500)).toBeLessThan(0.1);
  });

  it('beating a much stronger opponent raises mu more than beating an equal one', () => {
    const beatEqual = updateRating(DEFAULT_RATING, 1500, 50, 1);
    const beatStrong = updateRating(DEFAULT_RATING, 1900, 50, 1);
    expect(beatStrong.mu - 1500).toBeGreaterThan(beatEqual.mu - 1500);
  });

  it('losing to a much weaker opponent lowers mu more than losing to an equal one', () => {
    const loseEqual = updateRating(DEFAULT_RATING, 1500, 50, 0);
    const loseWeak = updateRating(DEFAULT_RATING, 1100, 50, 0);
    expect(1500 - loseWeak.mu).toBeGreaterThan(1500 - loseEqual.mu);
  });

  it('after many wins from default, mu lands somewhere reasonable (sanity)', () => {
    let r = DEFAULT_RATING;
    for (let i = 0; i < 20; i++) r = updateRating(r, 1500, 100, 1);
    expect(r.mu).toBeGreaterThan(1500);
    expect(r.mu).toBeLessThan(3000);
    expect(r.phi).toBeLessThan(350);
  });
});
