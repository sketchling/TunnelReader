import React, { useState, useCallback, useEffect, useRef } from 'react';

function TunnelReader({ words, onBack, title, initialPosition = 0, onProgress }) {
  const [currentIndex, setCurrentIndex] = useState(initialPosition);
  const [isPlaying, setIsPlaying] = useState(false);
  const [wpm, setWpm] = useState(300);
  const [chunkSize, setChunkSize] = useState(1);
  const [isPaused, setIsPaused] = useState(initialPosition > 0);
  
  const intervalRef = useRef(null);
  const containerRef = useRef(null);

  // Report reading position: throttled while reading, flushed on unmount
  const progressRef = useRef({ index: initialPosition, lastSent: 0 });
  useEffect(() => {
    progressRef.current.index = currentIndex;
    if (!onProgress) return;
    const now = Date.now();
    if (now - progressRef.current.lastSent > 2000) {
      progressRef.current.lastSent = now;
      onProgress(currentIndex);
    }
  }, [currentIndex, onProgress]);
  useEffect(() => {
    return () => { if (onProgress) onProgress(progressRef.current.index); };
  }, [onProgress]);

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
    
    // True ORP for the chunk (same logic as server): position calculated on
    // letter/digit characters only, then mapped back to the original string.
    const length = combined.replace(/[^\p{L}\p{N}]/gu, '').length;
    let orpClean;
    if (length <= 1) orpClean = 0;
    else if (length <= 5) orpClean = 1;
    else if (length <= 9) orpClean = 2;
    else if (length <= 13) orpClean = 3;
    else orpClean = 4;
    
    let middleIndex = Math.floor(combined.length / 2);
    let seen = -1;
    for (let i = 0; i < combined.length; i++) {
      if (/[\p{L}\p{N}]/u.test(combined[i])) {
        seen++;
        if (seen === orpClean) { middleIndex = i; break; }
      }
    }
    
    return {
      original: combined,
      beforeORP: combined.slice(0, middleIndex),
      orpChar: combined[middleIndex],
      afterORP: combined.slice(middleIndex + 1),
      orpIndex: middleIndex,
      length,
      endsParagraph: chunk.some(w => w.endsParagraph)
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

  // Touch gestures on the word zone: tap = play/pause, horizontal drag = scrub.
  // Pointer events cover mouse, touch, and pencil (iOS 13+).
  const gestureRef = useRef(null);
  const SCRUB_PX_PER_WORD = 12; // drag distance per word scrubbed
  const TAP_THRESHOLD = 10;     // px of movement before a tap becomes a drag

  const handlePointerDown = useCallback((e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    gestureRef.current = { startX: e.clientX, startIndex: currentIndex, scrubbing: false };
  }, [currentIndex]);

  const handlePointerMove = useCallback((e) => {
    const g = gestureRef.current;
    if (!g) return;
    const dx = e.clientX - g.startX;
    if (!g.scrubbing && Math.abs(dx) > TAP_THRESHOLD) {
      g.scrubbing = true;
      setIsPlaying(false); // pause while scrubbing
      setIsPaused(true);
    }
    if (g.scrubbing) {
      // Drag right rewinds, drag left advances (timeline convention)
      const delta = Math.round(dx / SCRUB_PX_PER_WORD) * chunkSize;
      setCurrentIndex(Math.max(0, Math.min(words.length - 1, g.startIndex - delta)));
    }
  }, [chunkSize, words.length]);

  const handlePointerEnd = useCallback((e) => {
    const g = gestureRef.current;
    gestureRef.current = null;
    if (!g) return;
    // A clean tap (no drag, not a cancel) toggles play/pause
    if (!g.scrubbing && e.type === 'pointerup') {
      togglePlay();
    }
  }, [togglePlay]);

  // Smart pacing: how long should this word linger, relative to base delay?
  const getPacingMultiplier = useCallback((display) => {
    if (!display) return 1;
    const text = display.original;
    let m = 1;

    // Punctuation pauses (allow trailing quotes/brackets after the mark)
    if (/[.!?…]["'”’)\]]*$/.test(text)) m = 2.0;        // sentence end
    else if (/[,;:—–]["'”’)\]]*$/.test(text)) m = 1.5;  // clause break

    // Paragraph break: the longest breath
    if (display.endsParagraph) m = Math.max(m, 2.5);

    // Numbers take longer to parse than words of the same length
    if (/\d/.test(text)) m = Math.max(m, 1.5);

    // Long words need more recognition time (+8% per char over 8)
    if (display.length > 8) m += (display.length - 8) * 0.08;

    return m;
  }, []);

  // Playback with smart variable delay
  useEffect(() => {
    if (!isPlaying) {
      if (intervalRef.current) {
        clearTimeout(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    const delay = getDelay();
    const currentWord = getCurrentDisplay();
    const wordDelay = delay * getPacingMultiplier(currentWord);

    intervalRef.current = setTimeout(() => {
      advance();
    }, wordDelay);

    return () => {
      if (intervalRef.current) {
        clearTimeout(intervalRef.current);
      }
    };
  }, [isPlaying, currentIndex, getDelay, advance, getCurrentDisplay, getPacingMultiplier]);

  // Auto-focus container on mount
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.focus();
    }
  }, []);

  const currentWord = getCurrentDisplay();
  const progress = words.length > 0 ? ((currentIndex / words.length) * 100) : 0;
  const estimatedTime = Math.ceil((words.length - currentIndex) / wpm);

  // When paused, show the surrounding sentence so the reader can re-anchor.
  const getPauseContext = () => {
    if (!isPaused || !currentWord || words.length === 0) return null;
    const endsSentence = (w) => /[.!?…]["'”’)\]]*$/.test(w.original);
    const MAX_REACH = 30; // cap either side so run-on sentences stay readable

    let start = currentIndex;
    while (start > 0 && currentIndex - start < MAX_REACH && !endsSentence(words[start - 1])) start--;
    let end = currentIndex;
    while (end < words.length - 1 && end - currentIndex < MAX_REACH && !endsSentence(words[end])) end++;

    return { start, end };
  };
  const pauseContext = getPauseContext();

  return (
    <div className="app" ref={containerRef} tabIndex={0}>
      <button className="back-btn" onClick={onBack}>
        ← Back
      </button>

      <div className="reader-container">
        <div
          className="gesture-surface"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
        />

        <div className="word-display">
          {/* Fixed ORP anchor guide */}
          <div className="orp-anchor" />
          
          {currentWord ? (
            <span className="word-wrapper">
              <span className="word-before">{currentWord.beforeORP}</span>
              <span className="word-orp">{currentWord.orpChar}</span>
              <span className="word-after">{currentWord.afterORP}</span>
            </span>
          ) : (
            <span style={{ color: '#666' }}>Done!</span>
          )}
        </div>

        {pauseContext && (
          <div className="context-view">
            {words.slice(pauseContext.start, pauseContext.end + 1).map((w, i) => {
              const idx = pauseContext.start + i;
              const isCurrent = idx >= currentIndex && idx < currentIndex + chunkSize;
              return (
                <span key={idx} className={isCurrent ? 'context-word current' : 'context-word'}>
                  {w.original}{' '}
                </span>
              );
            })}
          </div>
        )}

        <div className="bottom-ui">
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

          <div className="keyboard-hint">
            Space: Play/Pause • ← →: Navigate • ↑ ↓: Speed • Home: Reset • Esc: Back
          </div>
        </div>
      </div>

      {/* Baseline guide */}
      <div className="baseline-guide" />


    </div>
  );
}

export default TunnelReader;
