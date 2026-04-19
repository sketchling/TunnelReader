import React, { useState, useCallback, useEffect, useRef } from 'react';
import TunnelReader from './TunnelReader';

function App() {
  const [view, setView] = useState('upload'); // 'upload' | 'reader'
  const [words, setWords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('file'); // 'file' | 'url' | 'text'
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');

  const handleFileUpload = useCallback(async (file) => {
    if (!file) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await fetch('/api/extract/file', {
        method: 'POST',
        body: formData
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to extract text');
      }
      
      setWords(data.words);
      setView('reader');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleUrlLoad = useCallback(async () => {
    if (!url.trim()) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/extract/url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to extract text');
      }
      
      setWords(data.words);
      setView('reader');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [url]);

  const handleTextLoad = useCallback(async () => {
    if (!text.trim()) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/extract/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim() })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to process text');
      }
      
      setWords(data.words);
      setView('reader');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [text]);

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
    setError(null);
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
    return <TunnelReader words={words} onBack={handleBack} />;
  }

  return (
    <div className="app">
      <header className="header">
        <h1 className="logo">TunnelReader</h1>
      </header>

      <main className="upload-section">
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
              accept=".pdf,.txt,.md"
              onChange={(e) => handleFileUpload(e.target.files[0])}
            />
            <h3>Drop a file here, or click to browse</h3>
            <p style={{ color: '#888', marginTop: '0.5rem' }}>
              Supports PDF, TXT, MD (max 10MB)
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
      </main>
    </div>
  );
}

export default App;
