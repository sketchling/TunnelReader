// Tokenize raw text into word objects with ORP metadata.
// Runs client-side so the server only ships plain text (~10x smaller payloads).

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

// True ORP (Optimal Recognition Point), Spritz-style:
// the eye recognises words fastest when anchored ~1/3 in, not at the centre.
// Position is calculated on letter/digit characters only.
function orpPosition(cleanLength) {
  if (cleanLength <= 1) return 0;
  if (cleanLength <= 5) return 1;
  if (cleanLength <= 9) return 2;
  if (cleanLength <= 13) return 3;
  return 4;
}

// Map the nth letter/digit character of a word back to its index in the
// original string (so leading punctuation like `("word` doesn't misalign the ORP).
function mapCleanIndexToOriginal(word, cleanIndex) {
  let seen = -1;
  for (let i = 0; i < word.length; i++) {
    if (/[\p{L}\p{N}]/u.test(word[i])) {
      seen++;
      if (seen === cleanIndex) return i;
    }
  }
  // No letter/digit characters at all (e.g. "—" or "..."): anchor the middle
  return Math.floor(word.length / 2);
}

// Process text into word objects with ORP info
export function processText(text) {
  // Normalise whitespace but preserve paragraph breaks; strip only
  // control and zero-width characters (keeps apostrophes, quotes,
  // dashes, and non-ASCII letters intact).
  const cleaned = text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u200B-\u200D\uFEFF]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\u2029') // paragraph break marker
    .replace(/\n/g, ' ')
    .trim();

  const paragraphs = cleaned.split('\u2029');
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
}
