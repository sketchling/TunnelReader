import React, { useState } from 'react';

// Generated fallback cover (editorial style): a tasteful colour base with the
// title and author set on it, shown instantly while any real cover art loads
// on top. Missing or broken art simply leaves the generated cover in place.

// Curated, muted bases that read well with warm off-white text.
const COVER_BASES = [
  '#33415c', '#6a2634', '#16514a', '#8a3f26',
  '#2c3363', '#472a4f', '#5a4a1e', '#3a4a2e',
  '#334a4a', '#5c2f3a', '#3d3a5c', '#7a4420',
];

// Deterministic base from title+author, so a given book always looks the same.
function baseColor(seed) {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) + h + seed.charCodeAt(i)) | 0;
  return COVER_BASES[Math.abs(h) % COVER_BASES.length];
}

function BookCover({ title, authors, cover }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const base = baseColor(`${title}|${authors}`);

  return (
    <div className="book-cover-wrap" style={{ background: base }}>
      <div className="gen-cover">
        <div className="gen-frame" />
        <div className="gen-title">{title}</div>
        <div className="gen-author">{authors}</div>
      </div>
      {cover && !failed && (
        <img
          src={cover}
          alt=""
          className={`book-cover-img ${loaded ? 'loaded' : ''}`}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

export default BookCover;
