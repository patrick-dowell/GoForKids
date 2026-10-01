import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ADJECTIVES, NOUNS, isHandle, randomHandle, renderName } from '../names';

/**
 * Generated names (feature 32, revision 2). The lists are append-only — a
 * position never changes its word — so these pin both ends and the order.
 */
describe('name lists', () => {
  it('has 64 words in each list, in the printed order', () => {
    expect(ADJECTIVES).toHaveLength(64);
    expect(NOUNS).toHaveLength(64);
    expect(new Set(ADJECTIVES).size).toBe(64);
    expect(new Set(NOUNS).size).toBe(64);
    expect(ADJECTIVES.slice(0, 5)).toEqual(['Cosmic', 'Quiet', 'Bright', 'Swift', 'Gentle']);
    expect(ADJECTIVES.slice(-4)).toEqual(['Radiant', 'Electric', 'Stellar', 'Astral']);
    expect(ADJECTIVES[29]).toBe('Humming');
    expect(ADJECTIVES[30]).toBe('Patient');
    expect(NOUNS.slice(0, 5)).toEqual(['Otter', 'Comet', 'Panda', 'Falcon', 'Fox']);
    expect(NOUNS.slice(-4)).toEqual(['Lotus', 'Bamboo', 'Crane', 'Whale']);
    expect(NOUNS[29]).toBe('Nova');
    expect(NOUNS[30]).toBe('Moon');
  });

  it('renders [a, n] as "ADJECTIVES[a] NOUNS[n]"', () => {
    expect(renderName([0, 0])).toBe('Cosmic Otter');
    expect(renderName([63, 63])).toBe('Astral Whale');
    expect(renderName([12, 21])).toBe('Silver Nebula');
    expect(renderName(null)).toBe('');
  });

  it('accepts only two integers from 0 to 63', () => {
    expect(isHandle([0, 63])).toBe(true);
    expect(isHandle([64, 0])).toBe(false);
    expect(isHandle([-1, 0])).toBe(false);
    expect(isHandle([1.5, 0])).toBe(false);
    expect(isHandle([1])).toBe(false);
    expect(isHandle([1, 2, 3])).toBe(false);
    expect(isHandle(['1', 2])).toBe(false);
    expect(isHandle(null)).toBe(false);
  });

  it('draws positions uniformly over both lists, and Shuffle never repeats the name', () => {
    expect(randomHandle(null, () => 0)).toEqual([0, 0]);
    expect(randomHandle(null, () => 0.9999)).toEqual([63, 63]);
    let n = 0;
    const seq = [0, 0, 0, 0, 0.5, 0.5];
    expect(randomHandle([0, 0], () => seq[n++])).toEqual([32, 32]);
  });
});

describe('profile store — the name', () => {
  beforeEach(() => {
    vi.resetModules();
    const store = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size;
      },
    } as Storage;
  });

  it('drops an old free-text displayName on load, keeping the avatar', async () => {
    localStorage.setItem(
      'goforkids.profile.v1',
      JSON.stringify({ avatar: 'nova', displayName: 'OLD-NAME-SENTINEL', avatarPicked: true }),
    );
    const { useProfileStore } = await import('../../store/profileStore');
    useProfileStore.getState().loadFromStorage();
    const s = useProfileStore.getState();
    expect(s.avatar).toBe('nova');
    expect(s.avatarPicked).toBe(true);
    expect(s.handle).toBeNull();
    expect('displayName' in s).toBe(false);
    expect(localStorage.getItem('goforkids.profile.v1')).not.toContain('OLD-NAME-SENTINEL');
  });

  it('Shuffle stores a new valid name, and it survives a reload', async () => {
    const { useProfileStore, currentPlayerName } = await import('../../store/profileStore');
    useProfileStore.getState().setHandle([3, 4]);
    expect(currentPlayerName()).toBe('Swift Fox');
    useProfileStore.getState().shuffleHandle();
    const h = useProfileStore.getState().handle!;
    expect(isHandle(h)).toBe(true);
    expect(h).not.toEqual([3, 4]);
    useProfileStore.setState({ handle: null });
    useProfileStore.getState().loadFromStorage();
    expect(useProfileStore.getState().handle).toEqual(h);
  });
});
