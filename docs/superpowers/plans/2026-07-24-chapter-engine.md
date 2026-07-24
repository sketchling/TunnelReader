# Chapter Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect chapter boundaries in the client-side word stream so books open at the first chapter (when confident) and the reader can skip through a long book by percentage and by chapter.

**Architecture:** All detection is a pure function in `client/src/processText.js`, which grows to return `{ words, chapters, contentStart }`. `App.jsx` chooses the opening position from `contentStart`. `TunnelReader.jsx` turns its static progress bar into an interactive, tick-marked scrubber. Fiddly navigation math lives in a new pure module `client/src/chapterNav.js`. Detection and nav math are unit-tested with Vitest; reader wiring is verified manually against a real Gutenberg book.

**Tech Stack:** React 18 + Vite, Vitest (added here) for unit tests.

**Spec:** `docs/superpowers/specs/2026-07-24-chapter-engine-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `client/src/processText.js` (modify) | Tokenize + **detect chapters**. Exports `processText`, and (for tests) `matchHeading`, `detectStructure`. |
| `client/src/chapterNav.js` (create) | Pure reader-nav helpers: `currentChapter`, `fractionToIndex`, `snapIndex`. |
| `client/src/App.jsx` (modify) | Destructure new return; choose opening position; pass `chapters`/`contentStart` props. |
| `client/src/TunnelReader.jsx` (modify) | Chapter label, intro-skipped pill, interactive tick bar, tooltip, prev/next-chapter keys. |
| `client/src/index.css` (modify) | Styles for bar, ticks, front-matter zone, thumb, tooltip, pill. |
| `client/vite.config.js` (modify) | Add Vitest `test` config. |
| `client/package.json` (modify) | Add `vitest` devDep + `test` scripts. |
| `client/src/processText.test.js` (create) | Unit + integration tests for detection. |
| `client/src/chapterNav.test.js` (create) | Unit tests for nav helpers. |

---

## Task 1: Add Vitest test runner

**Files:**
- Modify: `client/package.json`
- Modify: `client/vite.config.js`

- [ ] **Step 1: Install Vitest**

Run:
```bash
cd client && npm install -D vitest
```
Expected: `vitest` added under `devDependencies`; no errors.

- [ ] **Step 2: Add test scripts to `client/package.json`**

Change the `"scripts"` block to:
```json
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
```

- [ ] **Step 3: Add Vitest config to `client/vite.config.js`**

Add a `test` property to the `defineConfig` object (detection is pure, so the `node` environment is enough — no jsdom):
```js
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.js']
  },
  server: {
```
(Leave the rest of the file unchanged.)

- [ ] **Step 4: Write a smoke test to confirm the runner works**

Create `client/src/__smoke__.test.js`:
```js
import { describe, it, expect } from 'vitest';

describe('vitest', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run the smoke test**

Run:
```bash
cd client && npm test
```
Expected: PASS — `1 passed`.

- [ ] **Step 6: Remove the smoke test**

Run:
```bash
cd client && rm src/__smoke__.test.js
```

- [ ] **Step 7: Commit**

```bash
git add client/package.json client/package-lock.json client/vite.config.js
git commit -m "chore: add vitest test runner for client"
```

---

## Task 2: `matchHeading` — classify one paragraph as a heading candidate

Detects whether a single line/paragraph looks like a chapter heading, returning `{ kind, title }` or `null`. This is the lowest-level detection primitive.

**Files:**
- Modify: `client/src/processText.js` (add exported helper + constants at top)
- Test: `client/src/processText.test.js` (create)

- [ ] **Step 1: Write the failing tests**

Create `client/src/processText.test.js`:
```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run:
```bash
cd client && npx vitest run src/processText.test.js
```
Expected: FAIL — `matchHeading is not a function` / import error.

- [ ] **Step 3: Implement `matchHeading` and constants**

At the **top** of `client/src/processText.js` (above `orpPosition`), add:
```js
// --- Chapter detection -----------------------------------------------------
const HEADING_MAX_WORDS = 7;    // headings are short lines
const MIN_PROSE_WORDS = 40;     // body words after a heading to confirm it (TOC filter)
const MIN_CHAPTER_GAP = 40;     // min words between two confirmed chapters
const SKIP_MAX_FRACTION = 0.30; // auto-skip only if content starts within first 30%

const LABELED = /^(chapter|stave|part|book|section|canto|act|scene|letter)\s+([0-9]+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\b/i;
const NAMED = /^(prologue|epilogue|introduction|preface|foreword|afterword|conclusion|interlude)\b/i;
const ORDINAL_TITLE = /^([0-9]{1,3}|[ivxlcdm]+)[.:)]\s+\S/i; // "I. The Beginning", "12: A New Day"
const ROMAN = /^[ivxlcdm]+\.?$/i;
const NUMBER = /^[0-9]{1,3}\.?$/;

function normalizeWhitespace(s) {
  return s.replace(/\s+/g, ' ').trim();
}

// Title-case an ALL-CAPS heading for display; leave anything with lowercase as-is.
function displayTitle(line) {
  const t = normalizeWhitespace(line);
  if (/[a-z]/.test(t)) return t;
  // Capitalize the first letter of each whitespace-separated word. Note: use
  // (^|\s) rather than \b, because \b treats an apostrophe as a boundary and
  // would wrongly capitalize the "s" in "MARLEY'S" -> "Marley'S".
  return t.toLowerCase().replace(/(^|\s)([a-z])/g, (_, sep, c) => sep + c.toUpperCase());
}

// Classify a single paragraph. Returns { kind, title } or null.
export function matchHeading(paragraphText) {
  const line = normalizeWhitespace(paragraphText);
  if (!line) return null;
  if (line.split(' ').length > HEADING_MAX_WORDS) return null;

  if (LABELED.test(line))       return { kind: 'labeled',       title: displayTitle(line) };
  if (NAMED.test(line))         return { kind: 'named',         title: displayTitle(line) };
  if (ORDINAL_TITLE.test(line)) return { kind: 'ordinal-title', title: displayTitle(line) };
  if (ROMAN.test(line))         return { kind: 'roman',         title: displayTitle(line) };
  if (NUMBER.test(line))        return { kind: 'number',        title: line.replace(/\.$/, '') };

  const hasLetter = /[a-z]/i.test(line);
  const hasLower = /[a-z]/.test(line);
  if (hasLetter && !hasLower)   return { kind: 'caps',          title: displayTitle(line) };

  return null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run:
```bash
cd client && npx vitest run src/processText.test.js
```
Expected: PASS — all `matchHeading` tests green.

- [ ] **Step 5: Commit**

```bash
git add client/src/processText.js client/src/processText.test.js
git commit -m "feat: add matchHeading chapter-heading classifier"
```

---

## Task 3: `detectStructure` — merge, TOC-trap confirm, confidence

Turns a list of paragraphs (each with its word offset) into confirmed chapters plus a confident content-start.

**Files:**
- Modify: `client/src/processText.js` (add exported `detectStructure`)
- Test: `client/src/processText.test.js` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `client/src/processText.test.js`:
```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run:
```bash
cd client && npx vitest run src/processText.test.js
```
Expected: FAIL — `detectStructure is not a function`.

- [ ] **Step 3: Implement `detectStructure`**

Add to `client/src/processText.js` (below `matchHeading`):
```js
// paragraphs: [{ text, wordStart, wordCount }]. Returns { chapters, contentStart }.
export function detectStructure(paragraphs, totalWords) {
  // 1. Classify every paragraph.
  const candidates = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    const h = matchHeading(p.text);
    if (h) candidates.push({ ...h, paraIndex: i, wordStart: p.wordStart, headingWords: p.wordCount });
  }

  // 2. Merge a two-line title: an ordinal-ish heading immediately followed by a
  //    caps/named heading paragraph.
  const merged = [];
  for (let c = 0; c < candidates.length; c++) {
    const cur = candidates[c];
    const next = candidates[c + 1];
    const isOrdinal = cur.kind === 'labeled' || cur.kind === 'roman' || cur.kind === 'number';
    if (next && next.paraIndex === cur.paraIndex + 1 && isOrdinal && (next.kind === 'caps' || next.kind === 'named')) {
      merged.push({ ...cur, title: `${cur.title} · ${next.title}`, headingWords: cur.headingWords + next.headingWords });
      c++; // consume next
    } else {
      merged.push(cur);
    }
  }

  // 3. Confirm via "followed by prose" (rejects stacked TOC entries).
  // 4. Dedupe headings closer than MIN_CHAPTER_GAP words.
  const chapters = [];
  for (let m = 0; m < merged.length; m++) {
    const cur = merged[m];
    const next = merged[m + 1];
    const bodyStart = cur.wordStart + cur.headingWords;
    const nextStart = next ? next.wordStart : totalWords;
    const proseWords = nextStart - bodyStart;
    if (proseWords < MIN_PROSE_WORDS) continue;
    if (chapters.length && cur.wordStart - chapters[chapters.length - 1].index < MIN_CHAPTER_GAP) continue;
    chapters.push({ index: cur.wordStart, title: cur.title });
  }

  // 5. Content start + confidence.
  const first = chapters[0];
  const confident = !!first && first.index > 0 && first.index < totalWords * SKIP_MAX_FRACTION;
  const contentStart = { index: confident ? first.index : 0, confident };

  return { chapters, contentStart };
}
```

- [ ] **Step 4: Run to verify it passes**

Run:
```bash
cd client && npx vitest run src/processText.test.js
```
Expected: PASS — all `detectStructure` tests green.

- [ ] **Step 5: Commit**

```bash
git add client/src/processText.js client/src/processText.test.js
git commit -m "feat: add detectStructure with TOC-trap filtering and confidence"
```

---

## Task 4: Wire detection into `processText`; change return shape; update caller

`processText` now returns `{ words, chapters, contentStart }`. Its one caller (`App.jsx:24`) is updated to keep the app building; open-behavior comes in Task 5.

**Files:**
- Modify: `client/src/processText.js` (build paragraph model, call `detectStructure`, change return)
- Modify: `client/src/App.jsx` (destructure new return)
- Test: `client/src/processText.test.js` (extend with full-text integration tests)

- [ ] **Step 1: Write the failing integration tests**

Append to `client/src/processText.test.js`:
```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run:
```bash
cd client && npx vitest run src/processText.test.js
```
Expected: FAIL — `processText(...).words` is undefined (still returns an array).

- [ ] **Step 3: Refactor `processText` to build the paragraph model and new return**

In `client/src/processText.js`, **leave the `cleaned` normalization chain and the `const paragraphs = cleaned.split(...)` line unchanged.** Replace everything from `const words = [];` through the function's closing `}` with:
```js
  const paraModel = [];   // { text, wordStart, wordCount }
  const rawWords = [];    // { word, endsParagraph }

  paragraphs.forEach((para, pIndex) => {
    const paraWords = para.split(/\s+/).filter(w => w.length > 0);
    paraModel.push({ text: para, wordStart: rawWords.length, wordCount: paraWords.length });
    paraWords.forEach((word, wIndex) => {
      rawWords.push({
        word,
        endsParagraph: pIndex < paragraphs.length - 1 && wIndex === paraWords.length - 1
      });
    });
  });

  const words = rawWords.map(({ word, endsParagraph }, index) => {
    const cleanWord = word.replace(/[^\p{L}\p{N}]/gu, '');
    const length = cleanWord.length;
    const orpClean = orpPosition(length);
    const middleIndex = mapCleanIndexToOriginal(word, orpClean);
    return {
      index,
      original: word,
      beforeORP: word.slice(0, middleIndex),
      orpChar: word[middleIndex],
      afterORP: word.slice(middleIndex + 1),
      orpIndex: middleIndex,
      length,
      endsParagraph
    };
  });

  const { chapters, contentStart } = detectStructure(paraModel, words.length);
  return { words, chapters, contentStart };
```
(The original built `words` inline and returned the array; now it builds a paragraph model alongside, runs detection, and returns the object. `orpPosition` and `mapCleanIndexToOriginal` are the existing helpers — unchanged.)

- [ ] **Step 4: Update the caller in `App.jsx`**

In `client/src/App.jsx`, replace the top of `openDocument` (currently `client/src/App.jsx:23-36`) so it destructures `words`:
```js
  const openDocument = useCallback((rawText, title, position = 0) => {
    const { words } = processText(rawText);
    if (words.length === 0) {
      setError('No readable text found');
      return;
    }
    const id = saveDoc({ title: title || 'Untitled', text: rawText, wordCount: words.length });
    if (id && position > 0) updatePosition(id, position);
    setWords(words);
    setBookTitle(title || '');
    setDocId(id);
    setStartPosition(Math.min(position, words.length - 1));
    setView('reader');
  }, []);
```
(Only the destructure and variable name change here; `chapters`/`contentStart` are wired in Task 5.)

- [ ] **Step 5: Run tests and build to verify**

Run:
```bash
cd client && npx vitest run src/processText.test.js && npm run build
```
Expected: tests PASS; Vite build succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/processText.js client/src/processText.test.js client/src/App.jsx
git commit -m "feat: return chapters + contentStart from processText"
```

---

## Task 5: Open behavior — skip to content when confident (`App.jsx`)

Fresh opens start at the confident content-start; resumes are respected; the reader receives the chapter data.

**Files:**
- Modify: `client/src/App.jsx` (state, `openDocument`, `handleBack`, reader props)

- [ ] **Step 1: Add state for chapters + contentStart**

In `App.jsx`, after the `startPosition` state (`client/src/App.jsx:19`), add:
```js
  const [chapters, setChapters] = useState([]);
  const [contentStart, setContentStart] = useState({ index: 0, confident: false });
```

- [ ] **Step 2: Use contentStart to choose the opening position**

Replace `openDocument` with:
```js
  const openDocument = useCallback((rawText, title, position = 0) => {
    const { words, chapters, contentStart } = processText(rawText);
    if (words.length === 0) {
      setError('No readable text found');
      return;
    }
    const id = saveDoc({ title: title || 'Untitled', text: rawText, wordCount: words.length });

    // Resume respects the saved position; a fresh open skips to the first
    // chapter only when detection is confident, else starts at the top.
    let start;
    if (position > 0) start = Math.min(position, words.length - 1);
    else if (contentStart.confident) start = contentStart.index;
    else start = 0;

    if (id && start > 0) updatePosition(id, start); // seed so resume % agrees

    setWords(words);
    setChapters(chapters);
    setContentStart(contentStart);
    setBookTitle(title || '');
    setDocId(id);
    setStartPosition(start);
    setView('reader');
  }, []);
```

- [ ] **Step 3: Pass the new props to the reader**

In the `view === 'reader'` block (`client/src/App.jsx:191-201`), add two props:
```jsx
      <TunnelReader
        words={words}
        chapters={chapters}
        contentStart={contentStart}
        onBack={handleBack}
        title={bookTitle}
        initialPosition={startPosition}
        onProgress={handleProgress}
      />
```

- [ ] **Step 4: Reset new state in `handleBack`**

In `handleBack` (`client/src/App.jsx:149-157`), add after `setStartPosition(0);`:
```js
    setChapters([]);
    setContentStart({ index: 0, confident: false });
```

- [ ] **Step 5: Manually verify the skip**

In one terminal run the backend from the repo root: `npm run server`. In another: `cd client && npm run dev`. Open the app, Browse Library → open a Project Gutenberg book (e.g. *A Christmas Carol*).
Expected: the reader opens on the first line of the story (e.g. "Marley…"), **not** the title page. Open a pasted short essay (Paste Text tab) → it opens at the first word.

- [ ] **Step 6: Commit**

```bash
git add client/src/App.jsx
git commit -m "feat: open books at the first chapter when detection is confident"
```

---

## Task 6: `chapterNav.js` — pure reader-navigation helpers

Extract the reader's navigation math so it can be unit-tested independently of the DOM.

**Files:**
- Create: `client/src/chapterNav.js`
- Test: `client/src/chapterNav.test.js`

- [ ] **Step 1: Write the failing tests**

Create `client/src/chapterNav.test.js`:
```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run:
```bash
cd client && npx vitest run src/chapterNav.test.js
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `chapterNav.js`**

Create `client/src/chapterNav.js`:
```js
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
```

- [ ] **Step 4: Run to verify it passes**

Run:
```bash
cd client && npx vitest run src/chapterNav.test.js
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/chapterNav.js client/src/chapterNav.test.js
git commit -m "feat: add pure chapter-navigation helpers"
```

---

## Task 7: Reader — chapter label + "intro skipped" pill

Display-only consumption of the chapter data: a current-chapter label and a recoverable intro pill.

**Files:**
- Modify: `client/src/TunnelReader.jsx` (props, imports, state, markup)
- Modify: `client/src/index.css` (pill + label styles)

- [ ] **Step 1: Accept the new props with safe defaults**

Change the component signature (`client/src/TunnelReader.jsx:3`):
```js
function TunnelReader({ words, chapters = [], contentStart = { index: 0, confident: false }, onBack, title, initialPosition = 0, onProgress }) {
```
And add the import at the top of the file (below the React import):
```js
import { currentChapter, fractionToIndex, snapIndex } from './chapterNav';
```

- [ ] **Step 2: Add intro-pill state and auto-hide**

After the existing `useState` declarations (`client/src/TunnelReader.jsx:8`), add:
```js
  const [introPillVisible, setIntroPillVisible] = useState(
    contentStart.confident && contentStart.index > 0
  );
  // Once the reader moves past the skip point, retire the pill.
  useEffect(() => {
    if (currentIndex > contentStart.index) setIntroPillVisible(false);
  }, [currentIndex, contentStart.index]);
```

- [ ] **Step 3: Compute the current chapter near the render bottom**

Just before `return (` (after `const pauseContext = getPauseContext();`, `client/src/TunnelReader.jsx:270`), add:
```js
  const chapterHere = currentChapter(chapters, currentIndex);
```

- [ ] **Step 4: Render the pill and label**

Immediately inside `<div className="reader-container">` (before the `gesture-surface` div, `client/src/TunnelReader.jsx:278`), add the pill:
```jsx
        {introPillVisible && (
          <button
            className="intro-pill"
            onClick={() => { setCurrentIndex(0); setIntroPillVisible(false); }}
          >
            ⏮ Intro skipped · tap to view
          </button>
        )}
```
Then update the progress text (`client/src/TunnelReader.jsx:324-326`) to include the chapter label:
```jsx
            <div className="progress-text">
              {chapterHere && <span className="chapter-here">{chapterHere.title}</span>}
              Word {currentIndex + 1} of {words.length} • ~{estimatedTime} min remaining
            </div>
```

- [ ] **Step 5: Add styles**

Append to `client/src/index.css`:
```css
.intro-pill {
  position: absolute;
  top: 3.25rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 5;
  background: #1c1c22;
  color: #c0c0c8;
  border: 1px solid #2e2e36;
  border-radius: 999px;
  padding: 0.35rem 0.8rem;
  font-size: 0.8rem;
  cursor: pointer;
}
.intro-pill:hover { color: #fff; border-color: #3a3a44; }

.chapter-here {
  display: block;
  color: #8a8a92;
  font-size: 0.8rem;
  margin-bottom: 0.15rem;
}
```

- [ ] **Step 6: Manually verify**

Run `cd client && npm run dev` (backend running), open a Gutenberg book.
Expected: opens at chapter 1; an "⏮ Intro skipped · tap to view" pill shows near the top and jumps to word 0 when tapped; the progress area shows the current chapter title (e.g. "Stave I. · Marley's Ghost"). After tapping the pill and pressing play, the pill disappears.

- [ ] **Step 7: Commit**

```bash
git add client/src/TunnelReader.jsx client/src/index.css
git commit -m "feat: show current chapter label and recoverable intro pill"
```

---

## Task 8: Reader — interactive tick bar (seek by %, chapter ticks, front-matter zone)

The static progress bar becomes clickable/draggable and shows chapter ticks plus the greyed front-matter zone.

**Files:**
- Modify: `client/src/TunnelReader.jsx` (bar markup + seek handlers)
- Modify: `client/src/index.css` (bar, ticks, zone, thumb)

- [ ] **Step 1: Add a bar ref and seek handlers**

After `const containerRef = useRef(null);` (`client/src/TunnelReader.jsx:11`), add:
```js
  const barRef = useRef(null);
  const barGestureRef = useRef(false);

  const seekToClientX = useCallback((clientX) => {
    const el = barRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const fraction = (clientX - rect.left) / rect.width;
    setCurrentIndex(fractionToIndex(fraction, words.length));
  }, [words.length]);

  const handleBarPointerDown = useCallback((e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    barGestureRef.current = true;
    setIsPlaying(false);
    setIsPaused(true);
    seekToClientX(e.clientX);
  }, [seekToClientX]);
  const handleBarPointerMove = useCallback((e) => {
    if (barGestureRef.current) seekToClientX(e.clientX);
  }, [seekToClientX]);
  const handleBarPointerUp = useCallback(() => {
    barGestureRef.current = false;
  }, []);
```

- [ ] **Step 2: Replace the progress bar markup**

Replace the `.progress-bar` block (`client/src/TunnelReader.jsx:318-323`) with:
```jsx
            <div
              className="progress-bar"
              ref={barRef}
              onPointerDown={handleBarPointerDown}
              onPointerMove={handleBarPointerMove}
              onPointerUp={handleBarPointerUp}
              onPointerCancel={handleBarPointerUp}
            >
              {contentStart.index > 0 && (
                <div
                  className="progress-frontmatter"
                  style={{ width: `${(contentStart.index / words.length) * 100}%` }}
                />
              )}
              <div className="progress-fill" style={{ width: `${progress}%` }} />
              {chapters.map((ch) => (
                <div
                  key={ch.index}
                  className="progress-tick"
                  style={{ left: `${(ch.index / words.length) * 100}%` }}
                />
              ))}
              <div className="progress-thumb" style={{ left: `${progress}%` }} />
            </div>
```

- [ ] **Step 3: Update styles**

In `client/src/index.css`, find the existing `.progress-bar` and `.progress-fill` rules and replace them with:
```css
.progress-bar {
  position: relative;
  height: 6px;
  background: #26262c;
  border-radius: 3px;
  cursor: pointer;
  touch-action: none; /* let the pointer handlers own horizontal drags */
}
.progress-frontmatter {
  position: absolute;
  top: 0; left: 0; height: 100%;
  border-radius: 3px 0 0 3px;
  background: repeating-linear-gradient(45deg, #3a3a42, #3a3a42 3px, #2c2c33 3px, #2c2c33 6px);
}
.progress-fill {
  position: absolute;
  top: 0; left: 0; height: 100%;
  background: #0a84ff;
  border-radius: 3px;
}
.progress-tick {
  position: absolute;
  top: -3px;
  width: 2px;
  height: 12px;
  margin-left: -1px;
  background: #6f6f77;
}
.progress-thumb {
  position: absolute;
  top: 50%;
  width: 12px;
  height: 12px;
  margin-left: -6px;
  transform: translateY(-50%);
  background: #fff;
  border-radius: 50%;
  box-shadow: 0 0 0 3px rgba(10,132,255,0.33);
  pointer-events: none;
}
```
(If the old `.progress-fill` had a `transition`, drop it — it lags during scrubbing.)

- [ ] **Step 4: Manually verify**

Run `cd client && npm run dev`, open a Gutenberg book.
Expected: chapter ticks appear along the bar; the front matter shows as a hatched zone at the far left; clicking or dragging anywhere on the bar jumps the reader to that point and pauses. On a chapter-less essay the bar has no ticks/zone but still seeks by position.

- [ ] **Step 5: Commit**

```bash
git add client/src/TunnelReader.jsx client/src/index.css
git commit -m "feat: interactive progress bar with chapter ticks and front-matter zone"
```

---

## Task 9: Reader — snap-to-chapter + chapter-name tooltip

Releasing near a tick snaps to it; hovering (desktop) or dragging (mobile) surfaces the chapter name.

**Files:**
- Modify: `client/src/TunnelReader.jsx` (snap on release, tooltip state + markup)
- Modify: `client/src/index.css` (tooltip)

- [ ] **Step 1: Add tooltip state**

After `const barGestureRef = useRef(false);` (from Task 8), add:
```js
  const [barTip, setBarTip] = useState(null); // { leftPct, label } | null
```

- [ ] **Step 2: Compute the tooltip from a clientX**

Add near the other bar helpers:
```js
  const showTipAtClientX = useCallback((clientX) => {
    const el = barRef.current;
    if (!el || chapters.length === 0) return;
    const rect = el.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const idx = fractionToIndex(fraction, words.length);
    const ch = currentChapter(chapters, idx);
    setBarTip({ leftPct: fraction * 100, label: ch ? ch.title : 'Front matter' });
  }, [chapters, words.length]);
```

- [ ] **Step 3: Snap on release; show the tip on down/move**

Replace `handleBarPointerUp` (from Task 8) with the snapping version, and add the tip call to the down/move handlers:
```js
  const handleBarPointerDown = useCallback((e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    barGestureRef.current = true;
    setIsPlaying(false);
    setIsPaused(true);
    seekToClientX(e.clientX);
    showTipAtClientX(e.clientX);
  }, [seekToClientX, showTipAtClientX]);
  const handleBarPointerMove = useCallback((e) => {
    if (barGestureRef.current) { seekToClientX(e.clientX); showTipAtClientX(e.clientX); }
  }, [seekToClientX, showTipAtClientX]);
  const handleBarPointerUp = useCallback(() => {
    barGestureRef.current = false;
    setCurrentIndex(prev => snapIndex(prev, chapters, words.length));
    setBarTip(null);
  }, [chapters, words.length]);
```
(These replace the same-named handlers added in Task 8.)

- [ ] **Step 4: Add hover handlers + render the tooltip**

Add three hover props to the `.progress-bar` element (alongside the pointer props from Task 8):
```jsx
              onPointerEnter={(e) => showTipAtClientX(e.clientX)}
              onMouseMove={(e) => { if (!barGestureRef.current) showTipAtClientX(e.clientX); }}
              onPointerLeave={() => { if (!barGestureRef.current) setBarTip(null); }}
```
And inside the `.progress-bar` div (after the `progress-thumb`), add:
```jsx
              {barTip && (
                <div className="chapter-tooltip" style={{ left: `${barTip.leftPct}%` }}>
                  {barTip.label}
                </div>
              )}
```

- [ ] **Step 5: Add tooltip styles**

Append to `client/src/index.css`:
```css
.chapter-tooltip {
  position: absolute;
  bottom: 16px;
  transform: translateX(-50%);
  max-width: 60vw;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  background: #17171d;
  color: #f2f2f5;
  border: 1px solid #2e2e36;
  border-radius: 6px;
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  pointer-events: none;
  z-index: 6;
}
```

- [ ] **Step 6: Manually verify**

Run `cd client && npm run dev`, open a Gutenberg book.
Expected (desktop): hovering the bar shows the chapter name at the cursor; dragging near a tick and releasing snaps exactly to that chapter. In responsive/touch mode a label rides the drag. No tooltip on a chapter-less essay.

- [ ] **Step 7: Commit**

```bash
git add client/src/TunnelReader.jsx client/src/index.css
git commit -m "feat: snap-to-chapter and chapter-name tooltip on the seek bar"
```

---

## Task 10: Reader — prev/next-chapter keyboard shortcuts

Desktop `[` / `]` jump between chapters; the hint line documents them.

**Files:**
- Modify: `client/src/TunnelReader.jsx` (keydown handler + hint text)

- [ ] **Step 1: Add a chapter-jump helper**

Near the other `useCallback`s (e.g. after `fastForward`, `client/src/TunnelReader.jsx:119`), add:
```js
  const jumpChapter = useCallback((dir) => {
    if (!chapters.length) return;
    setCurrentIndex(prev => {
      if (dir < 0) {
        let target = 0;
        for (const ch of chapters) { if (ch.index < prev - 1) target = ch.index; else break; }
        return target;
      }
      for (const ch of chapters) { if (ch.index > prev) return ch.index; }
      return prev;
    });
  }, [chapters]);
```

- [ ] **Step 2: Handle the keys**

In the `handleKeyDown` switch (`client/src/TunnelReader.jsx:124`), add before `default:`:
```js
        case 'BracketLeft':
          e.preventDefault();
          jumpChapter(-1);
          break;
        case 'BracketRight':
          e.preventDefault();
          jumpChapter(1);
          break;
```
And add `jumpChapter` to that effect's dependency array (`client/src/TunnelReader.jsx:160`):
```js
  }, [togglePlay, advance, reset, onBack, chunkSize, jumpChapter]);
```

- [ ] **Step 3: Update the keyboard hint**

Update the hint line (`client/src/TunnelReader.jsx:383-385`) — show the chapter keys only when chapters exist:
```jsx
          <div className="keyboard-hint">
            Space: Play/Pause • ← →: Navigate • ↑ ↓: Speed{chapters.length > 0 ? ' • [ ]: Chapter' : ''} • Home: Reset • Esc: Back
          </div>
```

- [ ] **Step 4: Manually verify**

Run `cd client && npm run dev`, open a Gutenberg book, press `]` and `[`.
Expected: `]` jumps to the next chapter start, `[` to the previous; the hint line shows "[ ]: Chapter". On a chapter-less essay the keys do nothing and the hint omits them.

- [ ] **Step 5: Run the full test suite + build**

Run:
```bash
cd client && npm test && npm run build
```
Expected: all tests PASS; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add client/src/TunnelReader.jsx
git commit -m "feat: prev/next-chapter keyboard shortcuts"
```

---

## Definition of done

- `cd client && npm test` passes (detection + nav helpers).
- Opening *A Christmas Carol* lands on the story's first words, not the title page; the intro pill recovers the front matter.
- The progress bar shows chapter ticks + a front-matter zone; clicking/dragging seeks; releasing near a tick snaps; hover/drag shows chapter names.
- `[` / `]` jump chapters on desktop.
- A chapter-less essay opens at word 0 and the bar still seeks smoothly by percentage.
- `cd client && npm run build` succeeds.

## Out of scope (per spec)

Shelf / many-books management; EPUB structured-TOC parsing; LLM-assisted detection.
