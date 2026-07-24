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
