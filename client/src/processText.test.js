import { describe, it, expect } from 'vitest';
import { matchHeading } from './processText';

describe('matchHeading', () => {
  it('matches labeled headings', () => {
    expect(matchHeading('CHAPTER 1')?.kind).toBe('labeled');
    expect(matchHeading('Chapter One')?.kind).toBe('labeled');
    expect(matchHeading('STAVE I.')?.kind).toBe('labeled');
    expect(matchHeading('Part IV')?.kind).toBe('labeled');
  });

  it('matches named sections', () => {
    expect(matchHeading('Prologue')?.kind).toBe('named');
    expect(matchHeading('EPILOGUE')?.kind).toBe('named');
  });

  it('matches an ordinal followed by a title on one line', () => {
    expect(matchHeading('I. The Beginning')?.kind).toBe('ordinal-title');
    expect(matchHeading('12. A New Day')?.kind).toBe('ordinal-title');
  });

  it('matches bare roman numerals and bare numbers', () => {
    expect(matchHeading('IV.')?.kind).toBe('roman');
    expect(matchHeading('42')?.kind).toBe('number');
  });

  it('matches ALL-CAPS short lines', () => {
    expect(matchHeading("MARLEY'S GHOST")?.kind).toBe('caps');
  });

  it('returns null for normal prose and long lines', () => {
    expect(matchHeading('Marley was dead: to begin with.')).toBeNull();
    expect(matchHeading('I am here and it is raining today.')).toBeNull();
    expect(matchHeading('The Project Gutenberg eBook of A Christmas Carol')).toBeNull();
    expect(matchHeading('')).toBeNull();
  });

  it('title-cases ALL-CAPS titles for display', () => {
    expect(matchHeading("MARLEY'S GHOST")?.title).toBe("Marley's Ghost");
  });
});

import { detectStructure } from './processText';

// Helper: build the paragraph model detectStructure expects.
// A number = a prose block of that many words; a string = a heading line.
function paras(spec) {
  const out = [];
  let word = 0;
  for (const item of spec) {
    if (typeof item === 'number') {
      out.push({ text: 'x '.repeat(item).trim(), wordStart: word, wordCount: item });
      word += item;
    } else {
      const wc = item.trim().split(/\s+/).length;
      out.push({ text: item, wordStart: word, wordCount: wc });
      word += wc;
    }
  }
  return { paragraphs: out, total: word };
}

describe('detectStructure', () => {
  it('rejects stacked TOC entries (no prose between them)', () => {
    const { paragraphs, total } = paras([
      'CONTENTS', 'I. The Beginning', 'II. The Middle', 'III. The End',
      'I. The Beginning', 50, 'II. The Middle', 50,
    ]);
    const { chapters, contentStart } = detectStructure(paragraphs, total);
    expect(chapters.map(c => c.title)).toEqual(['I. The Beginning', 'II. The Middle']);
    expect(contentStart.confident).toBe(true);
    expect(contentStart.index).toBe(chapters[0].index);
    expect(contentStart.index).toBeGreaterThan(0);
  });

  it('merges a two-line title', () => {
    const { paragraphs, total } = paras(['STAVE I.', "MARLEY'S GHOST", 60]);
    const { chapters } = detectStructure(paragraphs, total);
    expect(chapters).toHaveLength(1);
    expect(chapters[0].title).toBe("Stave I. · Marley's Ghost");
  });

  it('returns no chapters and low confidence for prose-only input', () => {
    const { paragraphs, total } = paras([80]);
    const { chapters, contentStart } = detectStructure(paragraphs, total);
    expect(chapters).toEqual([]);
    expect(contentStart).toEqual({ index: 0, confident: false });
  });

  it('detects a chapter at word 0 without skipping', () => {
    const { paragraphs, total } = paras(['Chapter 1', 60]);
    const { chapters, contentStart } = detectStructure(paragraphs, total);
    expect(chapters).toHaveLength(1);
    expect(contentStart.index).toBe(0);
    expect(contentStart.confident).toBe(false); // nothing to skip
  });

  it('is not confident when the first chapter is past the 30% guard', () => {
    // 200 words of front matter, then a chapter — 200/262 > 0.30
    const { paragraphs, total } = paras([200, 'Chapter 1', 60]);
    const { chapters, contentStart } = detectStructure(paragraphs, total);
    expect(chapters).toHaveLength(1);           // tick still exists
    expect(contentStart.confident).toBe(false); // but no auto-skip
  });
});
