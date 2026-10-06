/** A finished game's margin as the end cards print it: "1 point",
 *  "1.5 points", "8 points" (whole margins without a decimal). */
export function marginPoints(margin: number): string {
  const n = marginNumber(margin);
  return `${n} ${n === '1' ? 'point' : 'points'}`;
}

/** The short form the compact end panels print: "1 pt", "1.5 pts". */
export function marginPts(margin: number): string {
  const n = marginNumber(margin);
  return `${n} ${n === '1' ? 'pt' : 'pts'}`;
}

function marginNumber(margin: number): string {
  return margin.toFixed(margin % 1 === 0 ? 0 : 1);
}
