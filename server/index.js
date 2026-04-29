const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { extractFromPDF, extractFromURL, extractFromText, extractFromEPUB } = require('./extractor');

const app = express();
const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0';

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.pdf', '.txt', '.md', '.doc', '.docx', '.epub'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: PDF, TXT, MD, DOC, DOCX, EPUB'));
    }
  }
});

// CORS configuration - allow all origins in development
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../client/build')));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Extract text from uploaded file
app.post('/api/extract/file', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();
    
    let text = '';
    
    if (ext === '.pdf') {
      text = await extractFromPDF(filePath);
    } else if (ext === '.epub') {
      text = await extractFromEPUB(filePath);
    } else {
      // For txt, md, etc.
      text = fs.readFileSync(filePath, 'utf-8');
    }

    // Clean up uploaded file
    fs.unlinkSync(filePath);

    // Process text into words with metadata
    const words = processText(text);
    
    res.json({ 
      success: true, 
      wordCount: words.length,
      words: words
    });
  } catch (error) {
    console.error('File extraction error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Extract text from URL
app.post('/api/extract/url', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL required' });
    }

    const text = await extractFromURL(url);
    const words = processText(text);
    
    res.json({ 
      success: true, 
      wordCount: words.length,
      words: words
    });
  } catch (error) {
    console.error('URL extraction error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Extract from pasted text
app.post('/api/extract/text', (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Text required' });
    }

    const words = processText(text);
    
    res.json({ 
      success: true, 
      wordCount: words.length,
      words: words
    });
  } catch (error) {
    console.error('Text extraction error:', error);
    res.status(500).json({ error: error.message });
  }
});

// OPDS Catalog APIs
const CATALOGS = {
  gutenberg: 'https://gutendex.com/books/',
  standardEbooks: 'https://standardebooks.org/opds/all'
};

// Popular genres / bookshelves on Gutenberg for category browsing
const GUTENBERG_CATEGORIES = [
  { id: 'fiction', label: 'Fiction', search: 'fiction' },
  { id: 'science-fiction', label: 'Science Fiction', search: 'science fiction' },
  { id: 'mystery', label: 'Mystery', search: 'detective fiction' },
  { id: 'adventure', label: 'Adventure', search: 'adventure' },
  { id: 'romance', label: 'Romance', search: 'romance fiction' },
  { id: 'horror', label: 'Horror', search: 'horror tales' },
  { id: 'poetry', label: 'Poetry', search: 'poetry' },
  { id: 'history', label: 'History', search: 'history' },
  { id: 'philosophy', label: 'Philosophy', search: 'philosophy' },
  { id: 'children', label: "Children's", search: 'children fiction' },
  { id: 'fantasy', label: 'Fantasy', search: 'fantasy fiction' },
  { id: 'biography', label: 'Biography', search: 'biography' },
  { id: 'drama', label: 'Drama', search: 'drama' },
  { id: 'essays', label: 'Essays', search: 'essays' },
  { id: 'travel', label: 'Travel', search: 'travel' },
  { id: 'humor', label: 'Humor', search: 'humor' },
];

// Browse categories (returns curated Gutenberg genres)
app.get('/api/catalog/categories', (req, res) => {
  res.json({ success: true, categories: GUTENBERG_CATEGORIES });
});

// Search / browse OPDS catalogs
app.get('/api/catalog/search', async (req, res) => {
  try {
    const { source, query, page = 1, category } = req.query;
    
    if (!source || !CATALOGS[source]) {
      return res.status(400).json({ error: 'Invalid source. Use: gutenberg, standardEbooks' });
    }

    const catalogUrl = CATALOGS[source];
    let searchUrl = catalogUrl;
    
    if (source === 'gutenberg') {
      // Use either search query or category
      const search = query || GUTENBERG_CATEGORIES.find(c => c.id === category)?.search || '';
      searchUrl = `${catalogUrl}?search=${encodeURIComponent(search)}&page=${page}`;
    }

    const response = await axios.get(searchUrl, {
      timeout: 20000,
      maxRedirects: 5
    });

    let books = [];
    let moreBooks = null;
    
    if (source === 'gutenberg') {
      const data = response.data;
      books = (data.results || []).map(book => {
        const formats = book.formats || {};
        // Prefer plain text for reading — it's instant and needs no EPUB parsing
        const textUrl = formats['text/plain; charset=utf-8'] || formats['text/plain'] || null;
        const epubUrl = formats['application/epub+zip'] || 
                        Object.keys(formats).find(k => k.includes('epub')) ? 
                        formats[Object.keys(formats).find(k => k.includes('epub'))] : null;
        
        return {
          id: book.id?.toString(),
          title: book.title,
          authors: book.authors?.map(a => a.name).join(', ') || 'Unknown',
          formats,
          covers: formats['image/jpeg'] ? [formats['image/jpeg']] : [],
          downloads: book.download_count || 0,
          // Pass both URLs so client can let user choose, but default to text
          textUrl,
          epubUrl
        };
      });
      moreBooks = data.next;
    } else if (source === 'standardEbooks') {
      const xml = response.data;
      // Standard Ebooks OPDS uses Atom namespace — strip namespaces for easier parsing
      const strippedXml = xml.replace(/<(\/?)opds:/g, '<$1').replace(/<(\/?)atom:/g, '<$1');
      const $ = cheerio.load(strippedXml, { xmlMode: true });
      $('entry').each((i, el) => {
        const $el = $(el);
        const title = $el.find('title').eq(0).text().trim();
        const author = $el.find('author name').eq(0).text().trim();
        const id = $el.find('id').eq(0).text().trim();
        
        const links = [];
        $el.find('link').each((j, link) => {
          links.push({
            rel: $(link).attr('rel') || '',
            type: $(link).attr('type') || '',
            href: $(link).attr('href') || ''
          });
        });
        
        // Find EPUB download link
        const epubLink = links.find(l => 
          (l.rel.includes('acquisition') || l.rel.includes('http://opds-spec.org/acquisition')) && 
          (l.type.includes('epub') || l.type.includes('application/epub'))
        )?.href;
        
        // Cover image
        const cover = links.find(l => 
          l.rel.includes('http://opds-spec.org/image') || 
          l.rel.includes('image') && l.type.includes('image/jpeg')
        )?.href;
        
        if (title) {
          books.push({
            id: id || `${title}-${i}`,
            title,
            authors: author || 'Unknown',
            covers: cover ? [cover] : [],
            epubUrl: epubLink
          });
        }
      });
      
      // More link
      const moreLink = $('link[rel="next"]').attr('href');
      if (moreLink) moreBooks = moreLink.startsWith('http') ? moreLink : `https://standardebooks.org${moreLink}`;
    }

    // Include categories with response for client to display
    res.json({ success: true, books, categories: source === 'gutenberg' ? GUTENBERG_CATEGORIES : [], moreBooks, page: parseInt(page) });
  } catch (error) {
    console.error('Catalog search error:', error.message, error.response?.status);
    res.status(500).json({ error: `Failed to search catalog: ${error.message}` });
  }
});

// Get book details and download link
app.get('/api/catalog/book/:source/:id', async (req, res) => {
  try {
    const { source, id } = req.params;

    if (!CATALOGS[source]) {
      return res.status(400).json({ error: 'Invalid source' });
    }

    let bookData = {};

    if (source === 'gutenberg') {
      const response = await axios.get(`${CATALOGS.gutenberg}/${id}`, {
        timeout: 15000,
        headers: { 'User-Agent': 'TunnelReader/1.0' }
      });
      
      const book = response.data;
      const epubLink = book.formats?.['application/epub+zip'];
      const textPlainLink = book.formats?.['text/plain; charset=utf-8'] || book.formats?.['text/plain'];
      
      bookData = {
        id: book.id?.toString(),
        title: book.title,
        authors: book.authors?.map(a => a.name).join(', ') || 'Unknown',
        subjects: book.subjects || [],
        bookshelves: book.bookshelves || [],
        languages: book.languages || [],
        copyright: book.copyright,
        downloads: book.download_count,
        covers: book.formats?.['image/jpeg'] ? [book.formats['image/jpeg']] : [],
        epubUrl: epubLink,
        textUrl: textPlainLink
      };
    } else if (source === 'standardEbooks') {
      const response = await axios.get(`${CATALOGS.standardEbooks}/works/${id}`, {
        timeout: 15000,
        headers: { 'User-Agent': 'TunnelReader/1.0' }
      });
      
      const $ = cheerio.load(response.data);
      const links = [];
      $('link').each((i, el) => {
        links.push({
          type: $(el).attr('type'),
          href: $(el).attr('href')
        });
      });
      
      const epubLink = links.find(l => l.type?.includes('epub'))?.href || links.find(l => l.href?.endsWith('.epub'))?.href;
      
      bookData = {
        id,
        title: $('title').text(),
        authors: $('author name').text() || 'Unknown',
        covers: [],
        epubUrl: epubLink
      };
    }

    res.json({ success: true, book: bookData });
  } catch (error) {
    console.error('Book details error:', error);
    res.status(500).json({ error: 'Failed to get book details' });
  }
});

// Open Library API
app.get('/api/openlibrary/search', async (req, res) => {
  try {
    const { query, page = 1 } = req.query;
    
    if (!query) {
      return res.status(400).json({ error: 'Query required' });
    }

    const offset = (parseInt(page) - 1) * 20;
    const response = await axios.get(
      `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&offset=${offset}&limit=20`,
      { timeout: 15000 }
    );

    const docs = response.data.docs || [];
    const books = docs.map(doc => ({
      id: doc.key?.replace('/works/', '') || doc.id,
      title: doc.title,
      authors: doc.author_name?.join(', ') || 'Unknown',
      publishYear: doc.first_publish_year,
      coverId: doc.cover_i,
      hasFullText: doc.has_fulltext || false,
      ebookCount: doc.ebook_count_i || 0
    }));

    res.json({ 
      success: true, 
      books,
      page: parseInt(page),
      total: response.data.numFound
    });
  } catch (error) {
    console.error('Open Library search error:', error);
    res.status(500).json({ error: 'Failed to search Open Library' });
  }
});

// Get Open Library book details
app.get('/api/openlibrary/book/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get work info from Open Library
    const workResp = await axios.get(
      `https://openlibrary.org/works/${id}.json`,
      { timeout: 15000 }
    );
    const work = workResp.data;
    
    // Fetch editions to find IA identifier
    let iaIdentifier = null;
    let iaDownloadUrls = null;
    let coverId = null;
    
    try {
      const editionsResp = await axios.get(
        `https://openlibrary.org/works/${id}/editions.json?limit=10`,
        { timeout: 10000 }
      );
      const editions = (editionsResp.data.entries || []).filter(e => e.title);
      
      for (const ed of editions) {
        // Try multiple fields for IA identifier
        const iaId = ed.ia || ed.ia_id || ed.ocaid || 
                     (ed.identifiers?.ia?.[0]) || 
                     ed.identifiers?.archive_id?.[0];
        
        if (iaId) {
          iaIdentifier = typeof iaId === 'string' ? iaId : (Array.isArray(iaId) ? iaId[0] : null);
          if (!iaIdentifier) continue;
          
          // Get proper download URLs from IA
          try {
            const iaResp = await axios.get(`/api/archive/book/${iaIdentifier}`, { timeout: 10000 });
            if (iaResp.data.success && iaResp.data.book.downloadUrls) {
              iaDownloadUrls = iaResp.data.book.downloadUrls;
            }
          } catch (e) { /* IA lookup failed, proceed without */ }
          break;
        }
      }
      
      // Get cover from editions
      const covers = editions.map(e => e.covers || []).flat().filter(Boolean);
      if (covers.length > 0) coverId = covers[0];
    } catch (e) {
      console.log('OL editions lookup failed for', id);
    }
    
    res.json({
      success: true,
      book: {
        id,
        title: work.title || 'Unknown',
        description: typeof work.description === 'string' ? work.description : work.description?.value,
        authors: work.authors?.map(a => a.author?.title || a.name || a.key?.replace('/authors/', '') || 'Unknown').filter(Boolean).join(', ') || 'Unknown',
        firstPublishYear: work.first_publish_date || '',
        subjects: work.subjects || [],
        covers: [
          ...(coverId ? [`https://covers.openlibrary.org/b/id/${coverId}-L.jpg`] : []),
          ...(work.covers?.map(c => `https://covers.openlibrary.org/b/id/${c}-L.jpg`) || [])
        ],
        iaIdentifier,
        downloadUrls: iaDownloadUrls,
        readUrl: `https://openlibrary.org/works/${id}`,
        borrowUrl: iaIdentifier ? `https://openlibrary.org/borrow/ia:${iaIdentifier}` : `https://openlibrary.org/works/${id}`,
      }
    });
  } catch (error) {
    console.error('Open Library book error:', error);
    res.status(500).json({ error: 'Failed to get book details' });
  }
});

// Internet Archive API
app.get('/api/archive/search', async (req, res) => {
  try {
    const { query, page = 1 } = req.query;
    
    if (!query) {
      return res.status(400).json({ error: 'Query required' });
    }

    const response = await axios.get(
      `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=date&fl[]=downloads&rows=20&page=${page}&output=json`,
      { timeout: 15000 }
    );

    const docs = response.data.response.docs || [];
    const books = docs.map(doc => ({
      id: doc.identifier,
      title: doc.title,
      authors: doc.creator || 'Unknown',
      year: doc.date,
      downloads: doc.downloads,
      coverUrl: `https://archive.org/services/img/${doc.identifier}`
    }));

    res.json({ 
      success: true, 
      books,
      page: parseInt(page)
    });
  } catch (error) {
    console.error('Internet Archive search error:', error);
    res.status(500).json({ error: 'Failed to search Internet Archive' });
  }
});

// Get Internet Archive book details and download link
app.get('/api/archive/book/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const response = await axios.get(
      `https://archive.org/metadata/${id}`,
      { timeout: 15000 }
    );

    const meta = response.data;
    const files = meta.files || [];
    
    const epubFile = files.find(f => f.format === 'EPUB' || f.name?.endsWith('.epub'));
    const textFile = files.find(f => f.format === 'DjVuTXT' || f.format === 'Text' || f.name?.endsWith('.txt'));
    
    const downloadUrls = {
      epub: epubFile ? `https://archive.org/download/${id}/${epubFile.name}` : null,
      text: textFile ? `https://archive.org/download/${id}/${textFile.name}` : null,
      pdf: `https://archive.org/download/${id}/${id}_text.pdf`
    };

    res.json({
      success: true,
      book: {
        id,
        title: meta.title,
        authors: meta.creator || 'Unknown',
        description: meta.description,
        year: meta.date,
        downloads: meta.downloads,
        coverUrl: `https://archive.org/services/img/${id}`,
        downloadUrls
      }
    });
  } catch (error) {
    console.error('Internet Archive book error:', error);
    res.status(500).json({ error: 'Failed to get book details' });
  }
});

// Download and extract text from external URL
app.post('/api/extract/external', async (req, res) => {
  try {
    const { url, title } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL required' });
    }

    // Detect source type from URL
    const isEpub = url.toLowerCase().includes('.epub');
    const isGutenbergTxt = url.includes('gutenberg.org') && (url.includes('.txt'));
    const isIA = url.includes('archive.org/download/');
    
    let text;
    let tempFile;
    
    if (isEpub) {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 120000,
        headers: { 'User-Agent': 'TunnelReader/1.0' }
      });
      
      tempFile = path.join(__dirname, 'uploads', `${Date.now()}-temp.epub`);
      fs.writeFileSync(tempFile, response.data);
      text = await extractFromEPUB(tempFile);
      fs.unlinkSync(tempFile);
    } else if (isGutenbergTxt) {
      // Gutenberg .txt URLs return raw text with Project Gutenberg header
      const response = await axios.get(url, {
        timeout: 60000,
        headers: { 'User-Agent': 'TunnelReader/1.0' }
      });
      
      let rawText = response.data;
      
      // Strip BOM
      rawText = rawText.replace(/^\ufeff/, '');
      
      // Remove Gutenberg header/footer
      const startMarker = rawText.indexOf('*** START OF');
      const endMarker = rawText.indexOf('*** END OF');
      if (startMarker !== -1) {
        // Find the start of the actual text (after the marker header line)
        const textStart = rawText.indexOf('\n', startMarker);
        rawText = rawText.substring(textStart !== -1 ? textStart + 1 : startMarker);
      }
      if (endMarker !== -1) {
        rawText = rawText.substring(0, endMarker);
      }
      
      text = rawText.trim();
    } else {
      text = await extractFromURL(url);
    }

    const words = processText(text);
    
    res.json({ 
      success: true, 
      wordCount: words.length,
      words,
      title
    });
  } catch (error) {
    console.error('External extraction error:', error);
    res.status(500).json({ error: error.message || 'Failed to extract text from external source' });
  }
});

// Process text into word objects with ORP info
function processText(text) {
  // Clean up text
  const cleaned = text
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s.,!?;:()-]/g, '')
    .trim();
  
  const words = cleaned.split(/\s+/).filter(w => w.length > 0);
  
  return words.map((word, index) => {
    // Strip punctuation for length calculation
    const cleanWord = word.replace(/[.,!?;:()-]/g, '');
    const length = cleanWord.length;
    
    const isEven = length % 2 === 0;
    
    // With monospace font, centering is exact math:
    // - Odd: middle character (floor(n/2)) is exactly at center
    // - Even: character at n/2 puts the gap at visual center (standard RSVP)
    let middleIndex;
    let shiftRight = 0;
    
    if (isEven) {
      // Even: character at position n/2 (the first of the "right half")
      // This puts the visual center at the gap after this character
      middleIndex = length / 2;
    } else {
      // Odd: exact middle character
      middleIndex = Math.floor(length / 2);
    }
    
    // Split word into: before middle, middle char, after middle
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
      isEven,
      shiftRight
    };
  });
}

// Serve React app in production
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`🚀 TunnelReader server running on http://${HOST}:${PORT}`);
});
