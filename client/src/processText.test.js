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

import { processText } from './processText';

const CHRISTMAS_CAROL = `The Project Gutenberg eBook of A Christmas Carol

Title: A Christmas Carol

Author: Charles Dickens

CONTENTS

Stave I. Marley's Ghost

Stave II. The First of the Three Spirits

STAVE I.

MARLEY'S GHOST

Marley was dead: to begin with. There is no doubt whatever about that. The register of his burial was signed by the clergyman, the clerk, the undertaker, and the chief mourner. Scrooge signed it: and Scrooge's name was good upon Change, for anything he chose to put his hand to. Old Marley was as dead as a door-nail.

STAVE II.

THE FIRST OF THE THREE SPIRITS

When Scrooge awoke, it was so dark, that looking out of bed, he could scarcely distinguish the transparent window from the opaque walls of his chamber. He was endeavouring to pierce the darkness with his ferret eyes, when the chimes of a neighbouring church struck the four quarters.`;

describe('processText integration', () => {
  it('returns words, chapters, and contentStart', () => {
    const r = processText(CHRISTMAS_CAROL);
    expect(Array.isArray(r.words)).toBe(true);
    expect(r.words.length).toBeGreaterThan(50);
    expect(r.chapters.length).toBeGreaterThanOrEqual(2);
  });

  it('starts content at the real STAVE I, not the TOC line', () => {
    const r = processText(CHRISTMAS_CAROL);
    expect(r.contentStart.confident).toBe(true);
    expect(r.contentStart.index).toBeGreaterThan(5); // past the front matter
    expect(r.chapters[0].title.toLowerCase()).toContain('stave i');
  });

  it('an essay with no headings opens at word 0', () => {
    const essay = 'This is a short essay clause here. '.repeat(20);
    const r = processText(essay);
    expect(r.chapters).toEqual([]);
    expect(r.contentStart).toEqual({ index: 0, confident: false });
  });
});

describe('hyphenated words', () => {
  it('splits a compound into halves with the hyphen trailing the first', () => {
    const { words } = processText('well-being matters');
    expect(words.map(w => w.original)).toEqual(['well-', 'being', 'matters']);
  });

  it('keeps the hyphen at the end of the first half, after the ORP', () => {
    const first = processText('well-being').words[0];
    expect(first.original).toBe('well-');
    expect(first.beforeORP + first.orpChar + first.afterORP).toBe('well-');
    expect(first.afterORP.endsWith('-')).toBe(true);
  });

  it('splits every hyphen in a multi-part compound', () => {
    const { words } = processText('mother-in-law');
    expect(words.map(w => w.original)).toEqual(['mother-', 'in-', 'law']);
  });

  it('splits numeric ranges', () => {
    const { words } = processText('1939-1945');
    expect(words.map(w => w.original)).toEqual(['1939-', '1945']);
  });

  it('leaves dangling hyphens and em dashes intact', () => {
    expect(processText('-ish').words.map(w => w.original)).toEqual(['-ish']);
    expect(processText('self-').words.map(w => w.original)).toEqual(['self-']);
    expect(processText('end—start').words.map(w => w.original)).toEqual(['end—start']);
  });

  it('carries trailing punctuation on the final half only', () => {
    const { words } = processText('well-being,');
    expect(words.map(w => w.original)).toEqual(['well-', 'being,']);
  });
});
