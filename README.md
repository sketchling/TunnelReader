# TunnelReader

RSVP (Rapid Serial Visual Presentation) speed reading app with ORP (Optimal Recognition Point) anchoring.

Words appear one at a time with the first character fixed in red at the center, allowing your eye to stay stationary while reading at high speeds.

## Features

- 📄 **Upload files**: PDF, TXT, Markdown
- 🔗 **Load from URL**: Extract article content from web pages
- ✏️ **Paste text**: Direct text input
- ⚡ **Adjustable WPM**: 100–1000 words per minute
- 🎯 **Chunk size**: Display 1–5 words at once
- ⌨️ **Keyboard controls**: Space to play/pause, arrows to navigate
- 🎨 **Dark, focused UI**: Minimal distractions

## Quick Start

```bash
# Install dependencies
npm install
npm run install-client

# Start development server (runs both backend and frontend)
npm run dev
```

Then open http://localhost:3000

## Manual Start

```bash
# Terminal 1: Backend
npm run server

# Terminal 2: Frontend
npm run client
```

## How It Works

**ORP (Optimal Recognition Point)**: For each word, the "recognition point" (usually around 1/3 through the word) is calculated and displayed in red at a fixed position on screen. Your eye doesn't move — the words come to you.

This eliminates saccades (eye movements between words) and can significantly increase reading speed with practice.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `←` | Previous word |
| `→` | Next word |
| `↑` | Increase speed (+50 WPM) |
| `↓` | Decrease speed (-50 WPM) |
| `Home` | Reset to beginning |
| `Esc` | Back to upload |

## Tech Stack

- **Frontend**: React + Vite
- **Backend**: Node.js + Express
- **PDF Parsing**: pdf-parse
- **Web Scraping**: cheerio + axios

## Deployment

```bash
# Build for production
npm run build

# Start production server
npm start
```

## License

MIT
