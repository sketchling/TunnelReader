import { describe, it, expect } from 'vitest';
import { currentChapter, fractionToIndex, snapIndex } from './chapterNav';

const chapters = [
  { index: 0, title: 'I' },
  { index: 100, title: 'II' },
  { index: 250, title: 'III' },
];

describe('currentChapter', () => {
  it('returns the last chapter starting at or before the position', () => {
    expect(currentChapter(chapters, 0).title).toBe('I');
    expect(currentChapter(chapters, 150).title).toBe('II');
    expect(currentChapter(chapters, 999).title).toBe('III');
  });
  it('returns null when there are no chapters', () => {
    expect(currentChapter([], 10)).toBeNull();
  });
});

describe('fractionToIndex', () => {
  it('maps a fraction to a clamped word index', () => {
    expect(fractionToIndex(0, 300)).toBe(0);
    expect(fractionToIndex(1, 300)).toBe(299);
    expect(fractionToIndex(0.5, 301)).toBe(150);
    expect(fractionToIndex(-1, 300)).toBe(0);
    expect(fractionToIndex(2, 300)).toBe(299);
  });
});

describe('snapIndex', () => {
  it('snaps to a nearby chapter tick within the threshold', () => {
    // threshold = 0.02 * 300 = 6 words
    expect(snapIndex(103, chapters, 300)).toBe(100);
    expect(snapIndex(97, chapters, 300)).toBe(100);
  });
  it('does not snap when no tick is within the threshold', () => {
    expect(snapIndex(150, chapters, 300)).toBe(150);
  });
});
