# Chapter Engine — Design

**Date:** 2026-07-24
**Status:** Approved (pending spec review)
**Branch:** `feat/borrow-detection` (work will branch from here)

## Problem

TunnelReader turns any document into a flat stream of words for RSVP reading. Two consequences hurt long books:

1. **Every book opens on the front matter.** Gutenberg texts (and EPUB/PDF) begin with a title page, "Produced by…" credits, a table of contents, prefaces, and dedications. At 300 WPM that's several minutes of speed-reading indexes before the story starts. The server strips only the Gutenberg `*** START OF ***` license banner; everything after it still gets read.
2. **There is no way to skip through a long book.** The reader offers ±1 word (arrows), ±10 words (rewind/forward), and a 12px-per-word touch scrub. On a 100k-word book none of these can jump to chapter 5 or seek by percentage.

Both problems share one missing capability: the flat word stream has **no structure**. Detect where chapters begin and we solve both — auto-skip the intro *and* enable jump-to-chapter navigation.

## Goals

- Open a freshly-selected book at its first real chapter, **when we can detect that confidently**; otherwise open at the top and never guess wrong.
- Let the reader **skip through** a long book: seek by percentage and jump between chapters, with chapter names surfaced on interaction.
- Work uniformly across **every** source (Gutenberg `.txt`, EPUB, PDF, pasted text, URL articles) through a single code path.
- Degrade gracefully for documents with no detectable structure (essays, poetry, articles).

## Non-goals (explicit, for later or never)

- **Shelf / many-books management** (organising the saved list + catalog) — a separate fast-follow project with its own design.
- **EPUB structured-TOC parsing** — EPUBs ship a real TOC/spine we currently discard. A clean future accuracy boost for EPUBs only; not built now.
- **LLM-assisted detection** — overkill for a light, offline-friendly PWA.

## Decisions & rationale

| Decision | Choice | Why |
|---|---|---|
| Where detection runs | Client-side, in `processText.js` | It's the single tokenisation path for all sources; the word stream is already built there. Offline, instant, free. |
| Open behaviour | **Auto-skip only when confident**, else open at top | User choice. A heuristic miss must never drop the reader into the wrong place; a low-confidence result simply starts at word 0. |
| Detection method | **Client-side heuristics** on paragraph structure | Universal across sources; simple; its only failure mode (a miss) is made harmless by confident-only skipping. |
| Primary navigation | **Interactive progress bar** with chapter ticks | Always visible, gives real % scrubbing, and works even when sections are unnamed. Chapter names shown as tooltips (no separate drawer). |

## Architecture

Three files change; the server is untouched.

| File | Change |
|---|---|
| `client/src/processText.js` | Detect chapters + confident content-start. Return shape grows from an array to an object. |
| `client/src/App.jsx` | Destructure the new return; choose the opening position (fresh opens only). Pass `chapters`/`contentStart` to the reader. |
| `client/src/TunnelReader.jsx` | Interactive progress bar (ticks, drag-seek, snap, tooltip), current-chapter label, "intro skipped" pill, prev/next-chapter keys. |
| `client/src/index.css` | Styles for the new bar, ticks, front-matter zone, thumb, tooltip, and pill. |

## 1. Detection engine (`processText.js`)

### Return shape

`processText` currently returns `Word[]`. It will return:

```js
{
  words,        // Word[]  — unchanged word objects (index, original, beforeORP, …, endsParagraph)
  chapters,     // Chapter[] — [{ index, title }], index into words[], in reading order
  contentStart  // { index: number, confident: boolean }
}
```

`App.jsx` is the only caller (`App.jsx:24`); it will destructure accordingly and its empty check becomes `if (words.length === 0)`.

`chapters` and `contentStart` are **derived, not persisted** — `library.js` still stores only the raw text + `wordCount`, and detection re-runs on every open. Saved resume positions (word indices) remain valid.

### Algorithm

Detection runs on the **paragraph structure** the tokenizer already computes (the ` ` double-newline markers), before paragraphs are flattened into the word stream. Steps:

1. **Split into paragraphs** (as today). Track the word index at which each paragraph begins.
2. **Flag heading candidates.** A paragraph is a candidate when it is short (≤ `HEADING_MAX_WORDS` words) **and** matches any:
   - **Labeled heading:** `^(chapter|stave|part|book|section|canto|act|scene|letter)\s+(<number>|<roman>|<number-word>)\b` (case-insensitive).
   - **Named section:** `^(prologue|epilogue|introduction|preface|foreword|afterword|conclusion|interlude)\b` (case-insensitive).
   - **Bare roman numeral:** the whole trimmed line is `[IVXLCDM]{1,7}` with an optional trailing `.`.
   - **Bare number:** the whole trimmed line is `\d{1,3}` with an optional trailing `.`.
   - **ALL-CAPS short line:** the line has ≥ 1 letter and no lowercase letters (digits/punctuation/spaces allowed), e.g. `MARLEY'S GHOST`.
   - `<number-word>` = `one`…`twenty`, plus tens (`thirty`…`ninety`) and `hundred` — sufficient for chapter counts.
3. **Merge two-line titles.** When a labeled/roman/number candidate is immediately followed by another short candidate (typically ALL-CAPS), combine them into one title: `STAVE I.` + `MARLEY'S GHOST` → **"Stave I · Marley's Ghost"**.
4. **Confirm against the TOC trap.** A candidate becomes a **confirmed** chapter only if at least `MIN_PROSE_WORDS` words of body text follow it before the next candidate. This rejects:
   - stacked table-of-contents entries (heading after heading, little prose between),
   - the `CONTENTS` label itself (followed by TOC entries, not prose).
5. **Deduplicate.** Ignore a confirmed heading that sits within `MIN_CHAPTER_GAP` words of the previous confirmed one (guards against emphasis lines / repeated headers).
6. **Build `chapters`** as `{ index, title }` in reading order. `title` is normalised (collapse whitespace; title-case an ALL-CAPS line for display; keep the labeled form when present).

### Content start & confidence

- `contentStart.index` = the first confirmed chapter's word index (or `0` if none).
- `contentStart.confident = true` when **all** hold:
  - ≥ 1 confirmed chapter exists,
  - the first chapter starts after word 0 (there is front matter to skip),
  - it lands within the first `SKIP_MAX_FRACTION` of the book (guard against skipping deep on a bad match).
- Confidence gates **only the auto-skip**. Ticks render whenever `chapters` is non-empty, independent of confidence.

### Tunable constants (gather in one place at the top of the module)

| Constant | Value | Meaning |
|---|---|---|
| `HEADING_MAX_WORDS` | 7 | Max words for a paragraph to be a heading candidate |
| `MIN_PROSE_WORDS` | 40 | Prose words after a heading required to confirm it (TOC filter) |
| `MIN_CHAPTER_GAP` | 40 | Min words between two confirmed chapters |
| `SKIP_MAX_FRACTION` | 0.30 | Auto-skip only if content start is within the first 30% |

These are starting values, tuned against the test fixtures below.

## 2. Opening a book (`App.jsx`)

`openDocument(rawText, title, position = 0)` chooses the initial position:

- **Resuming** (`position > 0`): honour the saved position — **never** auto-skip over a reader's real progress.
- **Fresh open** (`position === 0`): start at `contentStart.confident ? contentStart.index : 0`. On a confident skip, **seed the saved position** to that index so the progress bar's percentage and the "Continue reading" resume point agree.

`chapters` and `contentStart` are passed to `TunnelReader` as props alongside the existing `words`/`initialPosition`.

## 3. Reader navigation (`TunnelReader.jsx`)

New props: `chapters: Chapter[]`, `contentStart: { index, confident }`.

The static progress bar becomes the primary navigator:

- **Ticks** at `chapters[i].index / words.length`.
- **Front-matter zone:** shade `0 → contentStart.index` distinctly (hatched/greyed) when `contentStart.index > 0`.
- **Seek by %:** click/tap the bar to jump to that fraction; drag the thumb to scrub coarsely. The existing 12px-per-word gesture-surface scrub stays for fine control. Scrubbing pauses playback (matching current gesture behaviour).
- **Snap:** on release within `SNAP_THRESHOLD_PCT` (~2%) of a tick, land exactly on the chapter start.
- **Tooltip / chapter name:**
  - Desktop: hovering the bar shows the name of the chapter under the cursor.
  - Mobile: a floating label rides above the thumb while dragging, showing the chapter name + %; tapping a tick jumps and briefly shows its name.
- **Current-chapter label** by the progress text: `Ch. II · Marley's Ghost`, derived as the last chapter whose `index ≤ currentIndex`.
- **"⏮ Intro skipped · tap to view" pill:** shown immediately after a confident auto-skip (i.e. while `currentIndex` is still at the skip landing and `contentStart.index > 0`); tapping sets `currentIndex = 0`. It clears once the reader advances. Getting back to chapter 1 is the first tick on the bar.
- **Keyboard (desktop):** `[` / `]` jump to previous / next chapter; added to the keyboard-hint line.

## 4. Fallbacks (all graceful)

| Situation | Result |
|---|---|
| No headings detected | `chapters: []`, `confident: false` → open at top; bar still %-scrubbable (a big win over 12px/word alone). |
| First chapter at word 0 (no front matter) | No skip; ticks still render. |
| First chapter beyond the 30% guard | Open at top (`confident:false`), but render all ticks for navigation. |

## 5. Testing

`processText` is a pure function → unit-test with fixtures (TDD). Success criteria:

- **A Christmas Carol** opening → 5 staves detected; `contentStart` at `STAVE I` (the prose start), **not** the `CONTENTS`/TOC line; `confident: true`.
- **Chapter-less essay** → `chapters: []`; `confident: false`; opens at word 0.
- **Stacked-TOC sample** (a CONTENTS block listing chapters, then the real chapters) → the TOC entries are **not** among `chapters`; the first confirmed chapter is the real one.
- **Two-line title book** (`STAVE I.` then `MARLEY'S GHOST`) → one chapter titled "Stave I · Marley's Ghost".
- **Book whose chapter 1 is at word 0** → chapter detected, `contentStart.index === 0`, no skip.

Reader interactions (seek, snap, tick tooltips, prev/next-chapter keys, intro pill) verified manually against a real Gutenberg book in the running app.

## 6. Success definition

A user opening *A Christmas Carol* lands on "Marley was dead…", not the title page; can drag the bar to any point, see chapter names as they scrub, and snap to any stave — while an essay with no chapters opens at its first word and scrubs smoothly by percentage.
