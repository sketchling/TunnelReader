const fs = require('fs');
const pdfParse = require('pdf-parse');
const cheerio = require('cheerio');
const axios = require('axios');

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

module.exports = {
  extractFromPDF,
  extractFromURL,
  extractFromText
};
