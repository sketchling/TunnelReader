const fs = require('fs');
const pdfParse = require('pdf-parse');
const cheerio = require('cheerio');
const axios = require('axios');
const AdmZip = require('adm-zip');

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
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TunnelReader/1.0)'
      }
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
    
    // Clean up extracted text
    content = content
      .replace(/\s+/g, ' ')
      .replace(/\n+/g, '\n')
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
      .replace(/\s+/g, ' ')
      .replace(/\n+/g, '\n')
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

module.exports = {
  extractFromPDF,
  extractFromURL,
  extractFromText,
  extractFromEPUB
};
