const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { extractFromPDF, extractFromURL, extractFromText } = require('./extractor');

const app = express();
const PORT = process.env.PORT || 5000;

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
    const allowedTypes = ['.pdf', '.txt', '.md', '.doc', '.docx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: PDF, TXT, MD, DOC, DOCX'));
    }
  }
});

app.use(cors());
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

// Process text into word objects with ORP info
function processText(text) {
  // Clean up text
  const cleaned = text
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s.,!?;:()-]/g, '')
    .trim();
  
  const words = cleaned.split(/\s+/).filter(w => w.length > 0);
  
  return words.map((word, index) => {
    // Calculate ORP (Optimal Recognition Point)
    // For most words, the ORP is roughly 1/3 from the start
    // Minimum of 1, maximum at length-1
    const orpIndex = Math.min(
      Math.max(1, Math.floor(word.length / 3)),
      word.length - 1
    );
    
    // Split word into: before ORP, ORP char, after ORP
    const beforeORP = word.slice(0, orpIndex);
    const orpChar = word[orpIndex];
    const afterORP = word.slice(orpIndex + 1);
    
    return {
      index,
      original: word,
      beforeORP,
      orpChar,
      afterORP,
      orpIndex,
      length: word.length
    };
  });
}

// Serve React app in production
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 TunnelReader server running on port ${PORT}`);
});
