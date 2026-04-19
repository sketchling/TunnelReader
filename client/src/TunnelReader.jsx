import React, { useState, useCallback, useEffect, useRef } from 'react';

function TunnelReader({ words, onBack }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [wpm, setWpm] = useState(300);
  const [chunkSize, setChunkSize] = useState(1);
  const [isPaused, setIsPaused] = useState(false);
  
  const intervalRef = useRef(null);
  const containerRef = useRef(null);

  // Calculate delay based on WPM
  const getDelay = useCallback(() => {
    return (60000 / wpm) / chunkSize;
  }, [wpm, chunkSize]);

  // Get current word(s) to display
  const getCurrentDisplay = useCallback(() => {
    if (currentIndex >= words.length) {
      return null;
    }
    
    if (chunkSize === 1) {
      return words[currentIndex];
    }
    
    // For multi-word chunks, combine them
    const chunk = words.slice(currentIndex, currentIndex + chunkSize);
    if (chunk.length === 0) return null;
    
    const combined = chunk.map(w => w.original).join(' ');
    
    // Calculate ORP for the combined chunk
    const totalLength = combined.length;
    const orpIndex = Math.min(
      Math.max(1, Math.floor(totalLength / 3)),
      totalLength - 1
    );
    
    return {
      original: combined,
      beforeORP: combined.slice(0, orpIndex),
      orpChar: combined[orpIndex],
      afterORP: combined.slice(orpIndex + 1),
      orpIndex,
      length: totalLength
    };
  }, [words, currentIndex, chunkSize]);

  // Advance to next word(s)
  const advance = useCallback(() => {
    setCurrentIndex(prev => {
      const next = prev + chunkSize;
      if (next >= words.length) {
        setIsPlaying(false);
        setIsPaused(false);
        return prev;
      }
      return next;
    });
  }, [chunkSize, words.length]);

  // Handle play/pause
  const togglePlay = useCallback(() => {
    if (currentIndex >= words.length) {
      setCurrentIndex(0);
      setIsPlaying(true);
      setIsPaused(false);
    } else {
      setIsPlaying(prev => !prev);
      setIsPaused(prev => prev ? false : true);
    }
  }, [currentIndex, words.length]);

  // Reset to beginning
  const reset = useCallback(() => {
    setIsPlaying(false);
    setIsPaused(false);
    setCurrentIndex(0);
  }, []);

  // Rewind
  const rewind = useCallback(() => {
    setCurrentIndex(prev => Math.max(0, prev - 10 * chunkSize));
  }, [chunkSize]);

  // Fast forward
  const fastForward = useCallback(() => {
    setCurrentIndex(prev => Math.min(words.length - 1, prev + 10 * chunkSize));
  }, [chunkSize, words.length]);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e) => {
      switch (e.code) {
        case 'Space':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          setCurrentIndex(prev => Math.max(0, prev - chunkSize));
          break;
        case 'ArrowRight':
          e.preventDefault();
          advance();
          break;
        case 'ArrowUp':
          e.preventDefault();
          setWpm(prev => Math.min(1000, prev + 50));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setWpm(prev => Math.max(100, prev - 50));
          break;
        case 'Home':
          e.preventDefault();
          reset();
          break;
        case 'Escape':
          e.preventDefault();
          onBack();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, advance, reset, onBack, chunkSize]);

  // Playback interval
  useEffect(() => {
    if (isPlaying) {
      const delay = getDelay();
      intervalRef.current = setInterval(() => {
        advance();
      }, delay);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isPlaying, getDelay, advance]);

  // Auto-focus container on mount
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.focus();
    }
  }, []);

  const currentWord = getCurrentDisplay();
  const progress = words.length > 0 ? ((currentIndex / words.length) * 100) : 0;
  const estimatedTime = Math.ceil((words.length - currentIndex) / wpm);

  return (
    <div className="app" ref={containerRef} tabIndex={0}>
      <button className="back-btn" onClick={onBack}>
        ← Back
      </button>

      <div className="reader-container">
        <div className="word-display">
          {currentWord ? (
            <span className="word">
              <span className="word-before">{currentWord.beforeORP}</span>
              <span className="word-orp">{currentWord.orpChar}</span>
              <span className="word-after">{currentWord.afterORP}</span>
            </span>
          ) : (
            <span style={{ color: '#666' }}>Done!</span>
          )}
        </div>

        <div className="progress-container">
          <div className="progress-bar">
            <div 
              className="progress-fill" 
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="progress-text">
            Word {currentIndex + 1} of {words.length} • ~{estimatedTime} min remaining
          </div>
        </div>

        <div className="controls">
          <div className="control-buttons">
            <button className="control-btn" onClick={rewind} title="Rewind 10 words">
              ⏪
            </button>
            <button className="control-btn" onClick={reset} title="Reset (Home)">
              ⏮
            </button>
            <button 
              className="control-btn primary" 
              onClick={togglePlay}
              title="Play/Pause (Space)"
            >
              {isPlaying ? '⏸' : '▶'}
            </button>
            <button className="control-btn" onClick={fastForward} title="Forward 10 words">
              ⏩
            </button>
          </div>

          <div className="sliders">
            <div className="slider-group">
              <label className="slider-label">
                Speed: <strong>{wpm} WPM</strong>
              </label>
              <input
                type="range"
                className="slider"
                min="100"
                max="1000"
                step="25"
                value={wpm}
                onChange={(e) => setWpm(Number(e.target.value))}
                title="Arrow Up/Down to adjust"
              />
            </div>

            <div className="slider-group">
              <label className="slider-label">
                Words at once: <strong>{chunkSize}</strong>
              </label>
              <input
                type="range"
                className="slider"
                min="1"
                max="5"
                step="1"
                value={chunkSize}
                onChange={(e) => setChunkSize(Number(e.target.value))}
              />
            </div>
          </div>
        </div>
      </div>

      <div style={{
        position: 'fixed',
        bottom: '10px',
        right: '10px',
        fontSize: '0.75rem',
        color: '#444'
      }}>
        Space: Play/Pause • ← →: Navigate • ↑ ↓: Speed • Home: Reset • Esc: Back
      </div>
    </div>
  );
}

export default TunnelReader;
