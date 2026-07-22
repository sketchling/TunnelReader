// Reading library persisted in localStorage: resume position across sessions.

const KEY = 'tunnelreader:library';
const MAX_DOCS = 8;

// Stable id from content so reopening the same document resumes it (djb2 hash)
function hashText(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  }
  return 'doc-' + (h >>> 0).toString(36) + '-' + text.length;
}

export function getLibrary() {
  try {
    const raw = localStorage.getItem(KEY);
    const docs = raw ? JSON.parse(raw) : [];
    return Array.isArray(docs) ? docs : [];
  } catch {
    return [];
  }
}

function writeLibrary(docs) {
  localStorage.setItem(KEY, JSON.stringify(docs));
}

// Save (or refresh) a document. Returns its id, or null if it couldn't be stored.
export function saveDoc({ title, text, wordCount }) {
  const id = hashText(text);
  let docs = getLibrary().filter(d => d.id !== id);
  docs.unshift({ id, title, text, wordCount, position: 0, savedAt: Date.now() });
  docs = docs.slice(0, MAX_DOCS);

  // Quota handling: evict oldest docs until it fits (or nothing left to evict)
  while (docs.length > 0) {
    try {
      writeLibrary(docs);
      return id;
    } catch {
      docs.pop();
    }
  }
  return null;
}

export function updatePosition(id, position) {
  if (!id) return;
  try {
    const docs = getLibrary();
    const doc = docs.find(d => d.id === id);
    if (doc) {
      doc.position = position;
      writeLibrary(docs);
    }
  } catch {
    // Non-fatal: reading continues, resume just won't update
  }
}

export function removeDoc(id) {
  try {
    writeLibrary(getLibrary().filter(d => d.id !== id));
  } catch {
    // ignore
  }
}
