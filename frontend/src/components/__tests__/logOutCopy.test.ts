import { describe, expect, it } from 'vitest';
import { logOutConfirmText, unsavedGameCount } from '../logOutCopy';

/**
 * The log-out confirm (feature 32) must not promise that every game is saved
 * online when some were refused by the server and will be removed.
 */
describe('log-out confirm text', () => {
  it('with every game saved online, says games are saved and nothing is lost', () => {
    const text = logOutConfirmText(0);
    expect(text).toContain('Your rank, lessons, games, avatar and name will be saved online');
    expect(text).not.toMatch(/couldn't be saved/);
    expect(text).not.toMatch(/removed for good/);
  });

  it('with refused games, says how many could not be saved and will be removed', () => {
    const text = logOutConfirmText(2);
    expect(text).toContain("2 of your games couldn't be saved online, so they will be removed for good.");
    expect(text).toContain('other games');
    expect(text).not.toContain('lessons, games, avatar');
    expect(logOutConfirmText(1)).toContain("One of your games couldn't be saved online, so it will be removed for good.");
  });

  it('counts only refused games still in the library', () => {
    expect(unsavedGameCount([], ['a', 'b'])).toBe(0);
    expect(unsavedGameCount(['a', 'gone'], ['a', 'b'])).toBe(1);
  });
});
