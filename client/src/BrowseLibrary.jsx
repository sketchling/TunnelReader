import React, { useState, useCallback, useEffect } from 'react';

const API_URL = import.meta?.env?.DEV ? '' : `http://${window.location.hostname}:5000`;

const SOURCES = [
  { id: 'gutenberg', name: 'Gutenberg', type: 'opds' },
  { id: 'standardEbooks', name: 'Standard Ebooks', type: 'opds' },
  { id: 'openlibrary', name: 'Open Library', type: 'api' },
  { id: 'archive', name: 'Internet Archive', type: 'api' }
];

const GUTENBERG_GENRES = [
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

function BrowseLibrary({ onBookSelect }) {
  const [activeSource, setActiveSource] = useState('gutenberg');
  const [query, setQuery] = useState('');
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [selectedBook, setSelectedBook] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [page, setPage] = useState(1);
  const [activeCategory, setActiveCategory] = useState('fiction');
  const [showResults, setShowResults] = useState(false);
  
  const searchUrl = useCallback(() => {
    if (activeSource === 'gutenberg') {
      const search = activeCategory ? 
        GUTENBERG_GENRES.find(g => g.id === activeCategory)?.search || '' : '';
      return `/api/catalog/search?source=gutenberg&search=${encodeURIComponent(search)}&page=1`;
    } else if (activeSource === 'standardEbooks') {
      return `/api/catalog/search?source=standardEbooks&page=1`;
    } else if (activeSource === 'openlibrary') {
      return `/api/openlibrary/search?query=classic&page=1`;
    } else if (activeSource === 'archive') {
      return `/api/archive/search?query=classic&page=1`;
    }
    return '';
  }, [activeSource, activeCategory]);
  
  // Auto-load category results when Gutenberg source is selected
  useEffect(() => {
    setBooks([]);
    setShowResults(false);
    setQuery('');
    
    if (activeSource === 'gutenberg') {
      browseCategory(activeCategory || 'fiction', 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSource]);

  const browseCategory = useCallback(async (categoryId, pageNum = 1) => {
    if (!categoryId) return;
    setActiveCategory(categoryId);
    
    setLoading(true);
    setSearching(false);
    
    try {
      const genre = GUTENBERG_GENRES.find(g => g.id === categoryId);
      const search = genre?.search || categoryId;
      const endpoint = `/api/catalog/search?source=gutenberg&query=${encodeURIComponent(search)}&page=${pageNum}`;
      const response = await fetch(`${API_URL}${endpoint}`);
      const data = await response.json();
      
      if (data.success) {
        setBooks(data.books);
        setPage(pageNum);
        setShowResults(true);
      } else {
        setBooks([]);
      }
    } catch (err) {
      console.error('Browse error:', err);
      setBooks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const searchBooks = useCallback(async (searchQuery, pageNum = 1) => {
    if (!searchQuery.trim()) return;
    
    setSearching(true);
    setLoading(true);
    
    try {
      let endpoint = '';
      
      if (activeSource === 'gutenberg') {
        endpoint = `/api/catalog/search?source=gutenberg&query=${encodeURIComponent(searchQuery)}&page=${pageNum}`;
      } else if (activeSource === 'standardEbooks') {
        endpoint = `/api/catalog/search?source=standardEbooks&query=${encodeURIComponent(searchQuery)}&page=${pageNum}`;
      } else if (activeSource === 'openlibrary') {
        endpoint = `/api/openlibrary/search?query=${encodeURIComponent(searchQuery)}&page=${pageNum}`;
      } else if (activeSource === 'archive') {
        endpoint = `/api/archive/search?query=${encodeURIComponent(searchQuery)}&page=${pageNum}`;
      }
      
      const response = await fetch(`${API_URL}${endpoint}`);
      const data = await response.json();
      
      if (data.success) {
        setBooks(data.books);
        setPage(pageNum);
        setShowResults(true);
      } else {
        setBooks([]);
      }
    } catch (err) {
      console.error('Search error:', err);
      setBooks([]);
    } finally {
      setLoading(false);
      setSearching(false);
    }
  }, [activeSource]);

  const handleSearch = useCallback((e) => {
    e.preventDefault();
    searchBooks(query, 1);
  }, [query, searchBooks]);

  const handleBookClick = useCallback(async (book) => {
    setSelectedBook(book);
    setLoading(true);
    
    try {
      let details = {};
      
      if (activeSource === 'gutenberg') {
        const response = await fetch(`${API_URL}/api/catalog/book/gutenberg/${book.id}`);
        const data = await response.json();
        details = data.book || {};
        // Ensure textUrl is available
        if (!details.textUrl && details.formats?.['text/plain; charset=utf-8']) {
          details.textUrl = details.formats['text/plain; charset=utf-8'];
        }
      } else if (activeSource === 'standardEbooks') {
        const response = await fetch(`${API_URL}/api/catalog/book/standardEbooks/${book.id}`);
        const data = await response.json();
        details = data.book || {};
      } else if (activeSource === 'openlibrary') {
        const response = await fetch(`${API_URL}/api/openlibrary/book/${book.id}`);
        const data = await response.json();
        details = data.book || {};
      } else if (activeSource === 'archive') {
        const response = await fetch(`${API_URL}/api/archive/book/${book.id}`);
        const data = await response.json();
        details = data.book || {};
      }
      
      setSelectedBook(prev => ({ ...prev, ...details }));
    } catch (err) {
      console.error('Error getting book details:', err);
    } finally {
      setLoading(false);
    }
  }, [activeSource]);

  const handleReadBook = useCallback(async () => {
    if (!selectedBook) return;
    
    setDownloading(true);
    
    try {
      let downloadUrl = null;
      let textUrl = null;
      
      // Try EPUB or text download first (from any source)
      if (selectedBook.epubUrl) {
        downloadUrl = selectedBook.epubUrl;
      } else if (selectedBook.downloadUrls?.epub) {
        downloadUrl = selectedBook.downloadUrls.epub;
      } else if (selectedBook.downloadUrls?.text) {
        textUrl = selectedBook.downloadUrls.text;
      } else if (selectedBook.textUrl) {
        textUrl = selectedBook.textUrl;
      } else if (selectedBook.downloadUrls?.pdf) {
        downloadUrl = selectedBook.downloadUrls.pdf;
      }
      
      // Check for Open Library borrow-only book (no download URL)
      const borrowOnly = selectedBook.borrowUrl && !downloadUrl && !textUrl;
      
      if (borrowOnly) {
        alert('This book is available through Open Library borrowing. Opening it in your browser.');
        window.open(selectedBook.borrowUrl, '_blank');
        setDownloading(false);
        return;
      }
      
      const urlToUse = downloadUrl || textUrl;
      if (!urlToUse) {
        alert('No download format available for this book');
        setDownloading(false);
        return;
      }
      
      const response = await fetch(`${API_URL}/api/extract/external`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlToUse, title: selectedBook.title })
      });
        
      const data = await response.json();
          
      if (data.success) {
        onBookSelect(data.words, selectedBook.title);
      } else {
        alert('Failed to download book: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      console.error('Download error:', err);
      alert('Failed to download book');
    } finally {
      setDownloading(false);
    }
  }, [selectedBook, onBookSelect]);

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
      <div className="source-tabs">
        {SOURCES.map(source => (
          <button
            key={source.id}
            className={`tab-btn ${activeSource === source.id ? 'active' : ''}`}
            onClick={() => { setActiveSource(source.id); setBooks([]); setQuery(''); setCategories([]); }}
          >
            {source.name}
          </button>
        ))}
      </div>

      {activeSource === 'gutenberg' && (
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

      <form className="search-form" onSubmit={handleSearch}>
        <input
          type="text"
          className="search-input"
          placeholder={`Search ${SOURCES.find(s => s.id === activeSource)?.name}...`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" className="search-btn" disabled={searching || !query.trim()}>
          {searching ? 'Searching...' : 'Search'}
        </button>
      </form>

      {loading && !searching && (
        <div className="loading">Loading...</div>
      )}

      {!loading && books.length > 0 && (
        <div className="books-grid">
          {books.map((book, index) => (
            <div
              key={`${book.id}-${index}`}
              className="book-card"
              onClick={() => handleBookClick(book)}
            >
              {getCoverUrl(book) && (
                <img
                  src={getCoverUrl(book)}
                  alt={book.title}
                  className="book-cover"
                  onError={(e) => { e.target.style.display = 'none'; }}
                />
              )}
              <div className="book-info">
                <h3 className="book-title">{book.title}</h3>
                <p className="book-author">{book.authors}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && books.length === 0 && query && !searching && (
        <div className="no-results">No books found. Try a different search.</div>
      )}

      {!loading && books.length > 0 && (
        <div className="pagination">
          <button
            className="page-btn"
            onClick={() => searchBooks(query, page - 1)}
            disabled={page <= 1}
          >
            Previous
          </button>
          <span className="page-num">Page {page}</span>
          <button
            className="page-btn"
            onClick={() => searchBooks(query, page + 1)}
            disabled={books.length < 20}
          >
            Next
          </button>
        </div>
      )}

      {selectedBook && (
        <div className="book-modal" onClick={handleClose}>
          <div className="book-modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={handleClose}>&times;</button>
            
            {loading ? (
              <div className="loading">Loading book details...</div>
            ) : (
              <>
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
                    onClick={handleReadBook}
                    disabled={downloading}
                  >
                    {downloading ? 'Downloading...' : 'Read Now'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default BrowseLibrary;