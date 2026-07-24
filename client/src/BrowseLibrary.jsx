import React, { useState, useCallback, useEffect, useRef } from 'react';
import BookCover from './BookCover';

const API_URL = ''; // Same origin: Vite proxy in dev, Express serves the build in prod

// All catalogs are searched together; source is an implementation detail.
// Standard Ebooks is omitted: its OPDS feed now returns 401, so querying it
// only wasted a request per search.
const SOURCE_IDS = ['gutenberg', 'openlibrary', 'archive'];

const SEARCH_ENDPOINTS = {
  gutenberg: (q, p) => `/api/catalog/search?source=gutenberg&query=${encodeURIComponent(q)}&page=${p}`,
  openlibrary: (q, p) => `/api/openlibrary/search?query=${encodeURIComponent(q)}&page=${p}`,
  archive: (q, p) => `/api/archive/search?query=${encodeURIComponent(q)}&page=${p}`
};

const DETAIL_ENDPOINTS = {
  gutenberg: (id) => `/api/catalog/book/gutenberg/${id}`,
  openlibrary: (id) => `/api/openlibrary/book/${id}`,
  archive: (id) => `/api/archive/book/${id}`
};

// The Library pill isolates results to one catalog (or searches all).
const LIBRARY_SOURCES = [
  { id: 'all', label: 'All libraries' },
  { id: 'gutenberg', label: 'Project Gutenberg' },
  { id: 'openlibrary', label: 'Open Library' },
  { id: 'archive', label: 'Internet Archive' },
];

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
  const [librarySource, setLibrarySource] = useState('all'); // 'all' | source id
  const [openMenu, setOpenMenu] = useState(null);             // 'genres' | 'library' | null
  const [mode, setMode] = useState('browse');                 // 'browse' | 'search'

  // Discard out-of-order responses from stale searches
  const requestIdRef = useRef(0);

  // Fetch a single catalog's results, tagged with their source.
  const fetchOne = useCallback((source, term, pageNum) => {
    // Non-Gutenberg catalogs have no empty-query "popular"; use a broad default.
    const q = (term === '' && source !== 'gutenberg') ? 'classic literature' : term;
    return fetch(`${API_URL}${SEARCH_ENDPOINTS[source](q, pageNum)}`)
      .then(r => r.json())
      .then(data => (data.success ? data.books || [] : []).map(b => ({ ...b, source })))
      .catch(() => []);
  }, []);

  // Single fetch+merge path for both genre browsing and searching. On a fresh
  // view each catalog's results render the moment they arrive, so one slow
  // source (e.g. a Gutendex timeout) never blocks the whole shelf.
  const load = useCallback((term, pageNum, append, sources) => {
    const requestId = ++requestIdRef.current;

    // Internet Archive has no real "popular" and its broad-term results are
    // noisy, so keep it out of the default shelf unless it's the isolated source.
    const effective = (term === '' && sources.length > 1)
      ? sources.filter(s => s !== 'archive')
      : sources;

    if (append) {
      setLoadingMore(true);
      Promise.all(effective.map(s => fetchOne(s, term, pageNum))).then(resultsBySource => {
        if (requestId !== requestIdRef.current) return; // stale
        setBooks(prev => [...prev, ...mergeResults(resultsBySource, new Set(prev.map(dedupeKey)))]);
        setPage(pageNum);
        setLoadingMore(false);
      });
      return;
    }

    setLoading(true);
    setPage(pageNum);
    const resultsBySource = effective.map(() => []);
    let settled = 0;
    effective.forEach((source, i) => {
      fetchOne(source, term, pageNum).then(list => {
        if (requestId !== requestIdRef.current) return; // stale
        resultsBySource[i] = list;
        settled += 1;
        setBooks(mergeResults(resultsBySource));
        // Reveal as soon as any catalog has results; drop the spinner once done.
        if (list.length > 0 || settled === effective.length) setLoading(false);
      });
    });
  }, [fetchOne]);

  const sourcesFor = (scope) => (scope === 'all' ? SOURCE_IDS : [scope]);

  const loadGenre = useCallback((genreId, pageNum = 1, append = false) => {
    setActiveCategory(genreId);
    setMode('browse');
    const genre = GUTENBERG_GENRES.find(g => g.id === genreId) || GUTENBERG_GENRES[0];
    load(genre.search, pageNum, append, sourcesFor(librarySource));
  }, [librarySource, load]);

  const runSearch = useCallback((term, pageNum = 1, append = false) => {
    setMode('search');
    load(term, pageNum, append, sourcesFor(librarySource));
  }, [librarySource, load]);

  // Initial shelf
  useEffect(() => {
    loadGenre('popular', 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Search-as-you-type: debounce, min 2 chars; clearing returns to the shelf
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      if (mode === 'search') loadGenre(activeCategory, 1);
      return;
    }
    const timer = setTimeout(() => runSearch(trimmed, 1), 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Changing the library scope re-runs the current view (skip the first mount).
  const firstScope = useRef(true);
  useEffect(() => {
    if (firstScope.current) { firstScope.current = false; return; }
    const trimmed = query.trim();
    if (mode === 'search' && trimmed.length >= 2) runSearch(trimmed, 1);
    else loadGenre(activeCategory, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [librarySource]);

  const loadMore = useCallback(() => {
    if (mode === 'search') {
      runSearch(query.trim(), page + 1, true);
    } else {
      loadGenre(activeCategory, page + 1, true);
    }
  }, [mode, query, page, activeCategory, runSearch, loadGenre]);

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

  // Lending-only book: hand off to the official reader (Open Library / Archive)
  // to borrow, rather than attempting a download that would 401.
  const openReader = useCallback((book) => {
    const url = book.readerUrl
      || (book.source === 'openlibrary' ? `https://openlibrary.org/works/${book.id}`
        : book.source === 'archive' ? `https://archive.org/details/${book.id}` : null);
    if (url) window.open(url, '_blank', 'noopener');
  }, []);

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

      const urlToUse = downloadUrl || textUrl;
      // No readable URL (lending-only, or nothing available): send to borrowing
      if (!urlToUse) {
        openReader(full);
        return;
      }

      const response = await fetch(`${API_URL}/api/extract/external`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlToUse, title: full.title })
      });

      const data = await response.json();

      if (data.locked) {
        // Looked open but the scan is access-restricted — hand off to borrowing
        openReader(full);
      } else if (data.success) {
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
  }, [fetchDetails, onBookSelect, openReader]);

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
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck="false"
      />

      <div className="browse-controls">
        <button
          className={`lib-pill ${openMenu === 'genres' ? 'open' : ''}`}
          onClick={() => setOpenMenu(openMenu === 'genres' ? null : 'genres')}
        >
          {GUTENBERG_GENRES.find(g => g.id === activeCategory)?.label || 'Popular'}
          <span className="caret" aria-hidden="true">▾</span>
        </button>
        <button
          className={`lib-pill ${openMenu === 'library' ? 'open' : ''}`}
          onClick={() => setOpenMenu(openMenu === 'library' ? null : 'library')}
        >
          {LIBRARY_SOURCES.find(s => s.id === librarySource)?.label || 'All libraries'}
          <span className="caret" aria-hidden="true">▾</span>
        </button>
      </div>

      {openMenu === 'genres' && (
        <div className="lib-menu lib-menu-2col">
          {GUTENBERG_GENRES.map(g => (
            <button
              key={g.id}
              className={`lib-menu-item ${activeCategory === g.id ? 'active' : ''}`}
              onClick={() => { setOpenMenu(null); setQuery(''); loadGenre(g.id, 1); }}
            >
              {g.label}
            </button>
          ))}
        </div>
      )}

      {openMenu === 'library' && (
        <div className="lib-menu">
          {LIBRARY_SOURCES.map(s => (
            <button
              key={s.id}
              className={`lib-menu-item ${librarySource === s.id ? 'active' : ''}`}
              onClick={() => { setOpenMenu(null); setLibrarySource(s.id); }}
            >
              {s.label}
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
                  else if (book.access === 'borrow') openReader(book);
                  else readBook(book);
                }}
              >
                <BookCover title={book.title} authors={book.authors} cover={getCoverUrl(book)} />
                <div className="book-info">
                  <h3 className="book-title">{book.title}</h3>
                  <p className="book-author">{book.authors}</p>
                  {savedDoc ? (
                    <span className="book-resume-badge">Resume · {savedPct}%</span>
                  ) : book.access === 'borrow' && (
                    <span className="book-borrow-badge">Borrow ↗</span>
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
              {selectedBook.access === 'borrow' ? (
                <button
                  className="read-btn"
                  onClick={() => { handleClose(); openReader(selectedBook); }}
                >
                  Borrow ↗
                </button>
              ) : (
                <button
                  className="read-btn"
                  onClick={() => { handleClose(); readBook(selectedBook); }}
                  disabled={!!downloadingKey}
                >
                  {downloadingKey ? 'Downloading...' : 'Read Now'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default BrowseLibrary;
