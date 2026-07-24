// Pure navigation helpers for the reader. No DOM, unit-tested.

// The chapter the reader is currently in: the last one starting at or before
// `position`. Returns null when there are no chapters.
export function currentChapter(chapters, position) {
  let result = null;
  for (const ch of chapters) {
    if (ch.index <= position) result = ch;
    else break;
  }
  return result;
}

// Map a 0..1 bar fraction to a clamped word index.
export function fractionToIndex(fraction, wordCount) {
  if (wordCount <= 0) return 0;
  const i = Math.round(fraction * (wordCount - 1));
  return Math.max(0, Math.min(wordCount - 1, i));
}

// Snap a raw index to the nearest chapter tick within thresholdFraction of the
// book length; otherwise return the raw index unchanged.
export function snapIndex(index, chapters, wordCount, thresholdFraction = 0.02) {
  if (!chapters.length || wordCount <= 1) return index;
  const threshold = thresholdFraction * wordCount;
  let best = index;
  let bestDist = Infinity;
  for (const ch of chapters) {
    const d = Math.abs(ch.index - index);
    if (d <= threshold && d < bestDist) { bestDist = d; best = ch.index; }
  }
  return best;
}
