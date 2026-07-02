import { describe, it, expect, beforeEach } from 'vitest';
import { recordSelectorLog, snapshotSelectorLog, clearSelectorLog } from '../selectorLog';

/**
 * Selector diagnostic ring buffer (MILESTONE_tester_round §2/§5): pass-reason
 * lines are buffered per game and attached to the SavedGame so an uploaded
 * replay of a bad bot pass carries its own diagnosis.
 */
describe('selectorLog', () => {
  beforeEach(() => clearSelectorLog());

  it('records lines with a timestamp prefix', () => {
    recordSelectorLog('[selector] PASS reason=pass-threshold');
    const log = snapshotSelectorLog();
    expect(log).toHaveLength(1);
    // ISO timestamp then the original line.
    expect(log[0]).toMatch(/^\d{4}-\d{2}-\d{2}T.* \[selector\] PASS reason=pass-threshold$/);
  });

  it('snapshot returns a copy — later records do not mutate it', () => {
    recordSelectorLog('line 1');
    const snap = snapshotSelectorLog();
    recordSelectorLog('line 2');
    expect(snap).toHaveLength(1);
    expect(snapshotSelectorLog()).toHaveLength(2);
  });

  it('clear empties the buffer (game-start behavior)', () => {
    recordSelectorLog('stale line from the previous game');
    clearSelectorLog();
    expect(snapshotSelectorLog()).toHaveLength(0);
  });

  it('caps the buffer, keeping the most recent lines', () => {
    for (let i = 0; i < 250; i++) recordSelectorLog(`line ${i}`);
    const log = snapshotSelectorLog();
    expect(log.length).toBe(200);
    expect(log[log.length - 1]).toContain('line 249');
    expect(log[0]).toContain('line 50');
  });
});
