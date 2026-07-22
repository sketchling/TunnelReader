// Tokenize raw text into word objects with ORP metadata.
// Runs client-side so the server only ships plain text (~10x smaller payloads).

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
  const words = [];

  paragraphs.forEach((para, pIndex) => {
    const paraWords = para.split(/\s+/).filter(w => w.length > 0);
    paraWords.forEach((word, wIndex) => {
      words.push({
        word,
        endsParagraph: pIndex < paragraphs.length - 1 && wIndex === paraWords.length - 1
      });
    });
  });

  return words.map(({ word, endsParagraph }, index) => {
    // Letters/digits only for ORP position calculation
    const cleanWord = word.replace(/[^\p{L}\p{N}]/gu, '');
    const length = cleanWord.length;

    const orpClean = orpPosition(length);
    const middleIndex = mapCleanIndexToOriginal(word, orpClean);

    const beforeORP = word.slice(0, middleIndex);
    const orpChar = word[middleIndex];
    const afterORP = word.slice(middleIndex + 1);

    return {
      index,
      original: word,
      beforeORP,
      orpChar,
      afterORP,
      orpIndex: middleIndex,
      length,
      endsParagraph
    };
  });
}
