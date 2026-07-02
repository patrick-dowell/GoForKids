/**
 * In-app ring buffer of bot-selector diagnostics, so a field repro of the
 * ko-fight pass bug carries its own diagnosis — Patrick is never attached to
 * Xcode when it happens, so console.log alone taught us nothing three fixes
 * running. The buffer is cleared at game start and snapshotted into the
 * SavedGame on finish (and from there into the upload payload).
 *
 * Lines are what the console sees (`[selector] PASS reason=...` etc.),
 * prefixed with a timestamp so multi-game sessions stay legible.
 */

const MAX_LINES = 200;

let lines: string[] = [];

/** Append a diagnostic line (also timestamps it). Callers still console.log
 *  separately — the Xcode console remains the live view. */
export function recordSelectorLog(line: string): void {
  lines.push(`${new Date().toISOString()} ${line}`);
  if (lines.length > MAX_LINES) lines = lines.slice(-MAX_LINES);
}

/** Copy of the buffer for attaching to a finished game. */
export function snapshotSelectorLog(): string[] {
  return [...lines];
}

/** Called at game start so each SavedGame carries only its own game's lines. */
export function clearSelectorLog(): void {
  lines = [];
}
