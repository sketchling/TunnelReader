import React, { useState, useCallback, useEffect, useRef } from 'react';

const API_URL = ''; // Same origin: Vite proxy in dev, Express serves the build in prod

// All catalogs are searched together; source is an implementation detail.
const SOURCE_IDS = ['gutenberg', 'standardEbooks', 'openlibrary', 'archive'];

const SEARCH_ENDPOINTS = {
  gutenberg: (q, p) => `/api/catalog/search?source=gutenberg&query=${encodeURIComponent(q)}&page=${p}`,
  standardEbooks: (q, p) => `/api/catalog/search?source=standardEbooks&query=${encodeURIComponent(q)}&page=${p}`,
  openlibrary: (q, p) => `/api/openlibrary/search?query=${encodeURIComponent(q)}&page=${p}`,
  archive: (q, p) => `/api/archive/search?query=${encodeURIComponent(q)}&page=${p}`
};

const DETAIL_ENDPOINTS = {
  gutenberg: (id) => `/api/catalog/book/gutenberg/${id}`,
  standardEbooks: (id) => `/api/catalog/book/standardEbooks/${id}`,
  openlibrary: (id) => `/api/openlibrary/book/${id}`,
  archive: (id) => `/api/archive/book/${id}`
};

const GUTENBERG_GENRES = [
  { id: 'popular', label: 'Popular', search: '' }, // empty query = Gutendex popularity order
  { id: 'fiction', label: 'Fiction', search: 'fiction' },
  { id: 'science-fiction', label: 'Science Fiction', search: 'science fiction' },
  { id: 'mystery', label: 'Mystery', search: 'detective fiction' },
  { id: 'adventure', label: 'Adventure', search: 'adventure fiction' },
  { id: 'romance', label: 'Romance', search: 'romance fiction' },
  { id: 'horror', label: 'Horror', search: 'horror fiction' },
  { id: 'poetry', label: 'Poetry', search: 'poetry' },
  { id: 'history', label: 'History', search: 'history' },
  { id: 'philosophy', label: 'Philosophy', search: 'philosophy' },
  { id: 'children', label: 'Children', search: 'children literature' },
  { id: 'fantasy', label: 'Fantasy', search: 'fantasy fiction' },
  { id: 'biography', label: 'Biography', search: 'biography autobiography' },
  { id: 'drama', label: 'Drama', search: 'drama' },
  { id: 'essays', label: 'Essays', search: 'essays' },
  { id: 'travel', label: 'Travel', search: 'travel' },
  { id: 'humor', label: 'Humor', search: 'humor satire' },
];

// Dedupe across catalogs: same title + author = same book.
// Author tokens are sorted so "Stoker, Bram" matches "Bram Stoker".
function dedupeKey(book) {
  const title = String(book.title || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const authorTokens = String(book.authors || '')
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter(Boolean)
    .sort()
    .join(' ');
  return `${title}|${authorTokens}`;
}

// Round-robin interleave results from each source, keeping first occurrence
function mergeResults(resultsBySource, existingKeys = new Set()) {
  const seen = new Set(existingKeys);
  const merged = [];
  const maxLen = Math.max(0, ...resultsBySource.map(r => r.length));
  for (let i = 0; i < maxLen; i++) {
    for (const list of resultsBySource) {
      const book = list[i];
      if (!book) continue;
      const key = dedupeKey(book);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(book);
    }
  }
  return merged;
}

// Normalized title for matching browse results against the saved library
function normTitle(title) {
  return String(title || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function BrowseLibrary({ onBookSelect, savedDocs = [], onResume }) {
  const savedByTitle = React.useMemo(() => {
    const map = new Map();
    for (const doc of savedDocs) map.set(normTitle(doc.title), doc);
    return map;
  }, [savedDocs]);

  const [query, setQuery] = useState('');
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedBook, setSelectedBook] = useState(null);
  const [downloadingKey, setDownloadingKey] = useState(null);
  const [page, setPage] = useState(1);
  const [activeCategory, setActiveCategory] = useState('popular');
  const [mode, setMode] = useState('category'); // 'category' | 'search'

  // Discard out-of-order responses from stale searches
  const requestIdRef = useRef(0);

  // One search box, every catalog: query all sources in parallel and merge
  const searchAllSources = useCallback(async (searchQuery, pageNum) => {
    const fetches = SOURCE_IDS.map(async (source) => {
      try {
        const response = await fetch(`${API_URL}${SEARCH_ENDPOINTS[source](searchQuery, pageNum)}`);
        const data = await response.json();
        if (!data.success) return [];
        return (data.books || []).map(b => ({ ...b, source }));
      } catch {
        return [];
      }
    });
    return Promise.all(fetches);
  }, []);

  const runSearch = useCallback(async (searchQuery, pageNum = 1, append = false) => {
    const requestId = ++requestIdRef.current;
    append ? setLoadingMore(true) : setLoading(true);

    const resultsBySource = await searchAllSources(searchQuery, pageNum);
    if (requestId !== requestIdRef.current) return; // stale

    setBooks(prev => {
      if (!append) return mergeResults(resultsBySource);
      const existingKeys = new Set(prev.map(dedupeKey));
      return [...prev, ...mergeResults(resultsBySource, existingKeys)];
    });
    setPage(pageNum);
    setMode('search');
    setLoading(false);
    setLoadingMore(false);
  }, [searchAllSources]);

  const browseCategory = useCallback(async (categoryId, pageNum = 1, append = false) => {
    if (!categoryId) return;
    const requestId = ++requestIdRef.current;
    setActiveCategory(categoryId);
    append ? setLoadingMore(true) : setLoading(true);

    try {
      const genre = GUTENBERG_GENRES.find(g => g.id === categoryId);
      const search = genre ? genre.search : categoryId;
      const endpoint = `/api/catalog/search?source=gutenberg&query=${encodeURIComponent(search)}&page=${pageNum}`;
      const response = await fetch(`${API_URL}${endpoint}`);
      const data = await response.json();
      if (requestId !== requestIdRef.current) return; // stale

      const tagged = (data.success ? data.books || [] : []).map(b => ({ ...b, source: 'gutenberg' }));
      setBooks(prev => {
        if (!append) return tagged;
        const existingKeys = new Set(prev.map(dedupeKey));
        return [...prev, ...tagged.filter(b => !existingKeys.has(dedupeKey(b)))];
      });
      setPage(pageNum);
      setMode('category');
    } catch (err) {
      console.error('Browse error:', err);
      if (!append) setBooks([]);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  // Initial shelf
  useEffect(() => {
    browseCategory('popular', 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Search-as-you-type: debounce, min 2 chars; clearing returns to the shelf
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      if (mode === 'search') browseCategory(activeCategory, 1);
      return;
    }
    const timer = setTimeout(() => runSearch(trimmed, 1), 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const loadMore = useCallback(() => {
    if (mode === 'search') {
      runSearch(query.trim(), page + 1, true);
    } else {
      browseCategory(activeCategory, page + 1, true);
    }
  }, [mode, query, page, activeCategory, runSearch, browseCategory]);

  const fetchDetails = useCallback(async (book) => {
    const endpoint = DETAIL_ENDPOINTS[book.source]?.(book.id);
    if (!endpoint) return book;
    const response = await fetch(`${API_URL}${endpoint}`);
    const data = await response.json();
    const details = data.book || {};
    // Ensure textUrl is available (Gutenberg)
    if (!details.textUrl && details.formats?.['text/plain; charset=utf-8']) {
      details.textUrl = details.formats['text/plain; charset=utf-8'];
    }
    return { ...book, ...details };
  }, []);

  const resolveDownloadUrl = (book) => {
    let downloadUrl = null;
    let textUrl = null;

    // Try EPUB or text download first (from any source)
    if (book.epubUrl) {
      downloadUrl = book.epubUrl;
    } else if (book.downloadUrls?.epub) {
      downloadUrl = book.downloadUrls.epub;
    } else if (book.downloadUrls?.text) {
      textUrl = book.downloadUrls.text;
    } else if (book.textUrl) {
      textUrl = book.textUrl;
    } else if (book.downloadUrls?.pdf) {
      downloadUrl = book.downloadUrls.pdf;
    }
    return { downloadUrl, textUrl };
  };

  // One tap to read: fetch details if needed, download, straight into the reader
  const readBook = useCallback(async (book) => {
    const key = dedupeKey(book);
    setDownloadingKey(key);

    try {
      let full = book;
      let { downloadUrl, textUrl } = resolveDownloadUrl(full);
      if (!downloadUrl && !textUrl) {
        full = await fetchDetails(book);
        ({ downloadUrl, textUrl } = resolveDownloadUrl(full));
      }

      // Open Library borrow-only book (no download URL)
      if (full.borrowUrl && !downloadUrl && !textUrl) {
        alert('This book is available through Open Library borrowing. Opening it in your browser.');
        window.open(full.borrowUrl, '_blank');
        return;
      }

      const urlToUse = downloadUrl || textUrl;
      if (!urlToUse) {
        alert('No download format available for this book');
        return;
      }

      const response = await fetch(`${API_URL}/api/extract/external`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlToUse, title: full.title })
      });

      const data = await response.json();

      if (data.success) {
        onBookSelect(data.text, full.title);
      } else {
        alert('Failed to download book: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      console.error('Download error:', err);
      alert('Failed to download book');
    } finally {
      setDownloadingKey(null);
    }
  }, [fetchDetails, onBookSelect]);

  // Info icon: open the details modal (the old two-step path, now optional)
  const openDetails = useCallback(async (e, book) => {
    e.stopPropagation();
    setSelectedBook(book);
    try {
      const full = await fetchDetails(book);
      setSelectedBook(prev => (prev && dedupeKey(prev) === dedupeKey(full) ? full : prev));
    } catch (err) {
      console.error('Error getting book details:', err);
    }
  }, [fetchDetails]);

  const handleClose = useCallback(() => {
    setSelectedBook(null);
  }, []);

  const getCoverUrl = (book) => {
    if (book.covers?.length > 0) {
      return book.covers[0];
    }
    if (book.coverId) {
      return `https://covers.openlibrary.org/b/id/${book.coverId}-M.jpg`;
    }
    if (book.coverUrl) {
      return book.coverUrl;
    }
    return null;
  };

  return (
    <div className="browse-library">
      <input
        type="search"
        className="search-input search-input-full"
        placeholder="Search all libraries…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autocorrect="off"
        autoCapitalize="none"
        spellCheck="false"
      />

      {query.trim().length < 2 && (
        <div className="category-chips">
          {GUTENBERG_GENRES.map(g => (
            <button
              key={g.id}
              className={`chip ${activeCategory === g.id ? 'active' : ''}`}
              onClick={() => browseCategory(g.id, 1)}
            >
              {g.label}
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="loading">Loading...</div>
      )}

      {!loading && books.length > 0 && (
        <div className="books-grid">
          {books.map((book, index) => {
            const key = dedupeKey(book);
            const isDownloading = downloadingKey === key;
            const savedDoc = savedByTitle.get(normTitle(book.title));
            const savedPct = savedDoc && savedDoc.wordCount > 0
              ? Math.min(100, Math.round((savedDoc.position / savedDoc.wordCount) * 100))
              : 0;
            return (
              <div
                key={`${book.source}-${book.id}-${index}`}
                className={`book-card ${isDownloading ? 'downloading' : ''}`}
                onClick={() => {
                  if (downloadingKey) return;
                  if (savedDoc && onResume) onResume(savedDoc);
                  else readBook(book);
                }}
              >
                {getCoverUrl(book) && (
                  <img
                    src={getCoverUrl(book)}
                    alt={book.title}
                    className="book-cover"
                    loading="lazy"
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                )}
                <div className="book-info">
                  <h3 className="book-title">{book.title}</h3>
                  <p className="book-author">{book.authors}</p>
                  {savedDoc && (
                    <span className="book-resume-badge">Resume · {savedPct}%</span>
                  )}
                </div>
                <button
                  className="book-info-btn"
                  aria-label="Book details"
                  onClick={(e) => openDetails(e, book)}
                >
                  ⓘ
                </button>
                {isDownloading && <div className="book-downloading">Downloading…</div>}
              </div>
            );
          })}
        </div>
      )}

      {!loading && books.length === 0 && query.trim().length >= 2 && (
        <div className="no-results">No books found. Try a different search.</div>
      )}

      {!loading && books.length > 0 && (
        <div className="pagination">
          <button className="page-btn" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}

      {selectedBook && (
        <div className="book-modal" onClick={handleClose}>
          <div className="book-modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={handleClose}>&times;</button>

            {getCoverUrl(selectedBook) && (
              <img
                src={getCoverUrl(selectedBook)}
                alt={selectedBook.title}
                className="modal-cover"
                onError={(e) => { e.target.style.display = 'none'; }}
              />
            )}
            <h2 className="modal-title">{selectedBook.title}</h2>
            <p className="modal-author">{selectedBook.authors}</p>
            {selectedBook.subjects && selectedBook.subjects.length > 0 && (
              <p className="modal-subjects">{selectedBook.subjects.slice(0, 5).join(', ')}</p>
            )}

            <div className="modal-actions">
              <button
                className="read-btn"
                onClick={() => { handleClose(); readBook(selectedBook); }}
                disabled={!!downloadingKey}
              >
                {downloadingKey ? 'Downloading...' : 'Read Now'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default BrowseLibrary;
