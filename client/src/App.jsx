import React, { useState, useCallback, useEffect, useRef } from 'react';
import TunnelReader from './TunnelReader';
import BrowseLibrary from './BrowseLibrary';
import { processText } from './processText';
import { getLibrary, saveDoc, updatePosition, removeDoc } from './library';

const API_URL = ''; // Use relative paths - Vite proxy handles it

function App() {
  const [view, setView] = useState('upload'); // 'upload' | 'reader'
  const [words, setWords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('file'); // 'file' | 'url' | 'text' | 'browse'
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [bookTitle, setBookTitle] = useState('');
  const [docId, setDocId] = useState(null);
  const [startPosition, setStartPosition] = useState(0);
  const [savedDocs, setSavedDocs] = useState(() => getLibrary());

  // Single path for opening any document: tokenize, persist, enter reader
  const openDocument = useCallback((rawText, title, position = 0) => {
    const processed = processText(rawText);
    if (processed.length === 0) {
      setError('No readable text found');
      return;
    }
    const id = saveDoc({ title: title || 'Untitled', text: rawText, wordCount: processed.length });
    if (id && position > 0) updatePosition(id, position);
    setWords(processed);
    setBookTitle(title || '');
    setDocId(id);
    setStartPosition(Math.min(position, processed.length - 1));
    setView('reader');
  }, []);

  const handleProgress = useCallback((position) => {
    updatePosition(docId, position);
  }, [docId]);

  const handleFileUpload = useCallback(async (file) => {
    if (!file) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await fetch(`${API_URL}/api/extract/file`, {
        method: 'POST',
        body: formData
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to extract text');
      }
      
      openDocument(data.text, file.name.replace(/\.[^.]+$/, ''));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [openDocument]);

  const loadFromUrl = useCallback(async (urlString) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${API_URL}/api/extract/url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlString })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to extract text');
      }
      
      openDocument(data.text, new URL(urlString).hostname);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [openDocument]);

  const handleUrlLoad = useCallback(() => {
    if (!url.trim()) return;
    loadFromUrl(url.trim());
  }, [url, loadFromUrl]);

  // Share-target intake: /share?share_url=...&share_text=... (from the PWA
  // share sheet). Some apps put the URL in the text field, so check both.
  const shareHandledRef = useRef(false);
  useEffect(() => {
    if (shareHandledRef.current) return;
    shareHandledRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const isShare = window.location.pathname === '/share';
    if (!isShare) return;

    const sharedText = params.get('share_text') || '';
    const sharedTitle = params.get('share_title') || '';
    const urlInText = sharedText.match(/https?:\/\/\S+/)?.[0];
    const sharedUrl = params.get('share_url') || urlInText;

    window.history.replaceState({}, '', '/');

    if (sharedUrl) {
      loadFromUrl(sharedUrl);
    } else if (sharedText.trim()) {
      openDocument(sharedText.trim(), sharedTitle || 'Shared text');
    }
  }, [loadFromUrl, openDocument]);

  const handleTextLoad = useCallback(() => {
    if (!text.trim()) return;
    setError(null);
    // Pasted text needs no server round-trip: tokenize locally
    const title = text.trim().split(/\s+/).slice(0, 5).join(' ');
    openDocument(text.trim(), title);
  }, [text, openDocument]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    
    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileUpload(file);
    }
  }, [handleFileUpload]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleBack = useCallback(() => {
    setView('upload');
    setWords([]);
    setBookTitle('');
    setDocId(null);
    setStartPosition(0);
    setError(null);
    setSavedDocs(getLibrary()); // refresh Continue Reading list
  }, []);

  const handleBookSelect = useCallback((bookText, title = '') => {
    openDocument(bookText, title || 'Book');
  }, [openDocument]);

  const handleResume = useCallback((doc) => {
    openDocument(doc.text, doc.title, doc.position);
  }, [openDocument]);

  const handleRemoveDoc = useCallback((e, id) => {
    e.stopPropagation();
    removeDoc(id);
    setSavedDocs(getLibrary());
  }, []);

  // Drag and drop visual feedback
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDropWrapper = useCallback((e) => {
    setIsDragOver(false);
    handleDrop(e);
  }, [handleDrop]);

  if (view === 'reader') {
    return (
      <TunnelReader
        words={words}
        onBack={handleBack}
        title={bookTitle}
        initialPosition={startPosition}
        onProgress={handleProgress}
      />
    );
  }

  return (
    <div className="app">
      <header className="header">
        <h1 className="logo">TunnelReader</h1>
      </header>

      <main className="upload-section">
        {savedDocs.length > 0 && (
          <div className="continue-section">
            <h2 className="continue-title">Continue reading</h2>
            <div className="continue-list">
              {savedDocs.map(doc => {
                const pct = doc.wordCount > 0
                  ? Math.min(100, Math.round((doc.position / doc.wordCount) * 100))
                  : 0;
                return (
                  <button key={doc.id} className="continue-item" onClick={() => handleResume(doc)}>
                    <span className="continue-item-title">{doc.title}</span>
                    <span className="continue-item-meta">
                      {pct}% · {doc.wordCount.toLocaleString()} words
                    </span>
                    <span
                      className="continue-item-remove"
                      role="button"
                      aria-label="Remove from library"
                      onClick={(e) => handleRemoveDoc(e, doc.id)}
                    >
                      ✕
                    </span>
                    <span className="continue-item-bar" style={{ width: `${pct}%` }} />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="upload-tabs">
          <button 
            className={`tab-btn ${activeTab === 'file' ? 'active' : ''}`}
            onClick={() => setActiveTab('file')}
          >
            📄 Upload File
          </button>
          <button 
            className={`tab-btn ${activeTab === 'url' ? 'active' : ''}`}
            onClick={() => setActiveTab('url')}
          >
            🔗 From URL
          </button>
          <button 
            className={`tab-btn ${activeTab === 'text' ? 'active' : ''}`}
            onClick={() => setActiveTab('text')}
          >
            ✏️ Paste Text
          </button>
          <button 
            className={`tab-btn ${activeTab === 'browse' ? 'active' : ''}`}
            onClick={() => setActiveTab('browse')}
          >
            📚 Browse Library
          </button>
        </div>

        {error && (
          <div className="error">
            {error}
          </div>
        )}

        {activeTab === 'file' && (
          <div 
            className={`upload-area ${isDragOver ? 'dragover' : ''}`}
            onDrop={handleDropWrapper}
            onDragOver={handleDragOver}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onClick={() => document.getElementById('file-input').click()}
          >
            <input
              id="file-input"
              type="file"
              className="file-input"
              accept=".pdf,.epub,.docx,.doc,.rtf,.odt,.html,.htm,.txt,.md,.markdown,.text"
              onChange={(e) => handleFileUpload(e.target.files[0])}
            />
            <h3>Drop a file here, or click to browse</h3>
            <p style={{ color: '#888', marginTop: '0.5rem' }}>
              Supports PDF, EPUB, Word, RTF, ODT, HTML, TXT, MD (max 10MB)
            </p>
          </div>
        )}

        {activeTab === 'url' && (
          <div>
            <input
              type="url"
              className="url-input"
              placeholder="https://example.com/article"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleUrlLoad()}
            />
            <button 
              className="load-btn" 
              onClick={handleUrlLoad}
              disabled={loading || !url.trim()}
            >
              {loading ? 'Loading...' : 'Load Article'}
            </button>
          </div>
        )}

        {activeTab === 'text' && (
          <div>
            <textarea
              className="text-input"
              placeholder="Paste your text here..."
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button 
              className="load-btn" 
              onClick={handleTextLoad}
              disabled={loading || !text.trim()}
            >
              {loading ? 'Processing...' : 'Start Reading'}
            </button>
          </div>
        )}

        {activeTab === 'browse' && (
          <BrowseLibrary onBookSelect={handleBookSelect} savedDocs={savedDocs} onResume={handleResume} />
        )}
      </main>
    </div>
  );
}

export default App;
