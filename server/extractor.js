const fs = require('fs');
const dns = require('dns').promises;
const net = require('net');
const pdfParse = require('pdf-parse');
const cheerio = require('cheerio');
const axios = require('axios');
const AdmZip = require('adm-zip');

// --- SSRF protection -------------------------------------------------------
// User-supplied URLs must not be able to reach internal/private addresses.

function isPrivateIP(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) ||           // link-local
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  const lower = ip.toLowerCase();
  // Normalise IPv4-mapped IPv6 — dotted (::ffff:10.0.0.1) or hex (::ffff:a00:1) form
  const v4Mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Mapped) return isPrivateIP(v4Mapped[1]);
  const v4MappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (v4MappedHex) {
    const hi = parseInt(v4MappedHex[1], 16);
    const lo = parseInt(v4MappedHex[2], 16);
    return isPrivateIP(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
  }
  return (
    lower === '::' || lower === '::1' ||
    lower.startsWith('fc') || lower.startsWith('fd') || // unique local
    lower.startsWith('fe8') || lower.startsWith('fe9') ||
    lower.startsWith('fea') || lower.startsWith('feb')  // link-local
  );
}

async function assertPublicUrl(urlStr) {
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error('Invalid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are allowed');
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(hostname)) {
    if (isPrivateIP(hostname)) throw new Error('URL resolves to a private address');
    return;
  }
  const addresses = await dns.lookup(hostname, { all: true });
  if (addresses.some(({ address }) => isPrivateIP(address))) {
    throw new Error('URL resolves to a private address');
  }
}

// Re-validate every redirect hop (follow-redirects hook used by axios).
// beforeRedirect is synchronous, so this only catches literal-IP redirects;
// the initial request is fully DNS-validated by assertPublicUrl.
function blockPrivateRedirects(options) {
  const hostname = (options.hostname || options.host || '').replace(/^\[|\]$/g, '');
  if (net.isIP(hostname) && isPrivateIP(hostname)) {
    throw new Error('Redirect to private address blocked');
  }
}
// ---------------------------------------------------------------------------

// Extract text from PDF file
async function extractFromPDF(filePath) {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    return data.text;
  } catch (error) {
    console.error('PDF extraction error:', error);
    throw new Error('Failed to extract text from PDF');
  }
}

// Extract text from URL (article extraction)
async function extractFromURL(url) {
  try {
    await assertPublicUrl(url);

    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TunnelReader/1.0)'
      },
      beforeRedirect: blockPrivateRedirects
    });
    
    const html = response.data;
    const $ = cheerio.load(html);
    
    // Remove script and style elements
    $('script, style, nav, header, footer, aside, .advertisement, .ads').remove();
    
    // Try to find main content
    // Priority: article tag, main tag, content classes, then fall back to body
    let content = '';
    
    const selectors = [
      'article',
      'main',
      '[role="main"]',
      '.content',
      '.article-content',
      '.post-content',
      '.entry-content',
      '#content',
      'body'
    ];
    
    for (const selector of selectors) {
      const element = $(selector).first();
      if (element.length && element.text().trim().length > 200) {
        content = element.text();
        break;
      }
    }
    
    // Clean up extracted text (preserve paragraph breaks for pacing)
    content = content
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    
    if (!content || content.length < 100) {
      throw new Error('Could not extract meaningful content from URL');
    }
    
    return content;
  } catch (error) {
    console.error('URL extraction error:', error);
    if (error.code === 'ECONNABORTED') {
      throw new Error('URL request timed out');
    }
    if (error.response) {
      throw new Error(`HTTP error ${error.response.status}: ${error.response.statusText}`);
    }
    throw new Error('Failed to fetch or extract content from URL');
  }
}

// Extract from plain text (passthrough)
function extractFromText(text) {
  return text.trim();
}

// Extract text from EPUB file using adm-zip
async function extractFromEPUB(filePath) {
  try {
    const zip = new AdmZip(filePath);
    const entries = zip.getEntries();
    
    let textContent = '';
    const htmlFiles = [];
    
    for (const entry of entries) {
      const entryName = entry.entryName;
      if (entryName.endsWith('.xhtml') || entryName.endsWith('.html') || entryName.endsWith('.htm')) {
        if (!entryName.includes('toc') && !entryName.includes('nav')) {
          htmlFiles.push(entry.getData().toString('utf8'));
        }
      }
    }
    
    for (const html of htmlFiles) {
      const $ = cheerio.load(html);
      $('script, style').remove();
      textContent += $.text() + '\n\n';
    }
    
    if (!textContent || textContent.length < 100) {
      for (const entry of entries) {
        const entryName = entry.entryName;
        if (entryName.endsWith('.xhtml') || entryName.endsWith('.html') || entryName.endsWith('.htm')) {
          const html = entry.getData().toString('utf8');
          const $ = cheerio.load(html);
          $('script, style').remove();
          textContent += $.text() + '\n\n';
        }
      }
    }
    
    textContent = textContent
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    
    if (!textContent || textContent.length < 100) {
      throw new Error('Could not extract text from EPUB');
    }
    
    return textContent;
  } catch (error) {
    console.error('EPUB extraction error:', error);
    throw new Error('Failed to extract text from EPUB');
  }
}

// Extract text from DOC / DOCX (word-extractor handles both formats)
async function extractFromDOC(filePath) {
  const WordExtractor = require('word-extractor');
  const extractor = new WordExtractor();
  const doc = await extractor.extract(filePath);
  const text = doc.getBody();
  if (!text || !text.trim()) {
    throw new Error('Could not extract text from Word document');
  }
  return text;
}

// Remove RTF groups (any nesting depth) whose content is not body text
function stripRtfGroups(rtf) {
  const HEADER_GROUPS = /^\{\\(?:\*|fonttbl|colortbl|stylesheet|info|generator|listtable|listoverridetable)/;
  let out = '';
  let i = 0;
  while (i < rtf.length) {
    if (rtf[i] === '{' && HEADER_GROUPS.test(rtf.slice(i, i + 24))) {
      let depth = 0;
      while (i < rtf.length) {
        if (rtf[i] === '\\' ) { i += 2; continue; } // skip escaped char
        if (rtf[i] === '{') depth++;
        if (rtf[i] === '}') { depth--; if (depth === 0) { i++; break; } }
        i++;
      }
    } else {
      out += rtf[i++];
    }
  }
  return out;
}

// Extract text from RTF: minimal converter covering standard word-processor
// output (hex/unicode escapes, paragraph marks, header groups)
function extractFromRTF(filePath) {
  const rtf = fs.readFileSync(filePath, 'latin1');
  if (!rtf.startsWith('{\\rtf')) {
    throw new Error('Not a valid RTF file');
  }
  let text = stripRtfGroups(rtf)
    // escaped literals before any brace/control stripping
    .replace(/\\\\/g, '\u0001').replace(/\\\{/g, '\u0002').replace(/\\\}/g, '\u0003')
    // unicode escapes first, consuming their legacy fallback (\u233\'e9 or \u233?)
    .replace(/\\u(-?\d+)\s?(?:\\'[0-9a-fA-F]{2}|\?)?/g,
      (m, n) => String.fromCodePoint(((parseInt(n, 10) % 65536) + 65536) % 65536))
    // then bare hex escapes (\'e9 → é)
    .replace(/\\'([0-9a-fA-F]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16)))
    // paragraph/line marks
    .replace(/\\(?:par|line|sect|page)d?\b/g, '\n')
    .replace(/\\tab\b/g, ' ')
    // remaining control words and groups
    .replace(/\\[a-zA-Z]+-?\d*[ ]?/g, '')
    .replace(/[{}]/g, '')
    .replace(/\u0001/g, '\\').replace(/\u0002/g, '{').replace(/\u0003/g, '}');

  text = text.replace(/[ \t]+/g, ' ').replace(/ \n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!text) {
    throw new Error('Could not extract text from RTF');
  }
  return text;
}

// Extract text from ODT (zip containing content.xml)
function extractFromODT(filePath) {
  const zip = new AdmZip(filePath);
  const entry = zip.getEntry('content.xml');
  if (!entry) {
    throw new Error('Not a valid ODT file');
  }
  const xml = entry.getData().toString('utf8');
  const text = xml
    .replace(/<text:line-break[^>]*\/>/g, '\n')
    .replace(/<text:tab[^>]*\/>/g, ' ')
    .replace(/<text:s[^>]*\/>/g, ' ')
    .replace(/<\/text:(?:p|h)>/g, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) {
    throw new Error('Could not extract text from ODT');
  }
  return text;
}

// Extract text from a local HTML file (same cleanup family as URL extraction)
function extractFromHTMLFile(filePath) {
  const html = fs.readFileSync(filePath, 'utf8');
  const $ = cheerio.load(html);
  $('script, style, nav, header, footer, aside').remove();
  // Mark block boundaries so paragraphs survive cheerio's text() flattening
  $('p, h1, h2, h3, h4, h5, h6, li, br, div, article, section').each((_, el) => {
    $(el).append('\u2029');
  });
  const scope = $('body').length ? $('body') : $.root();
  const text = scope.text()
    .replace(/\u2029+/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) {
    throw new Error('Could not extract text from HTML file');
  }
  return text;
}

module.exports = {
  extractFromPDF,
  extractFromURL,
  extractFromText,
  extractFromEPUB,
  extractFromDOC,
  extractFromRTF,
  extractFromODT,
  extractFromHTMLFile,
  assertPublicUrl,
  blockPrivateRedirects
};
