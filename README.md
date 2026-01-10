# 🔗 Link Scraper - Obsidian Plugin

A plugin to automatically scrape content from all URL links in your Obsidian notes.

## Features

- 📂 **Vault scanning** - finds all URL links in your notes
- 🌐 **Content scraping** - downloads title, description and content from web pages
- 💾 **Save as notes** - saves scraped data as markdown files
- 🔙 **Backlinks** - automatically adds `[[link|📥]]` next to URLs in original notes

## Installation

### Manual Installation

1. Build the plugin:
   ```bash
   cd obsidian-link-scraper-plugin
   npm install
   npm run build
   ```
2. Copy `main.js`, `manifest.json` and `styles.css` to `.obsidian/plugins/link-scraper/` in your vault
3. Enable the plugin in Obsidian: Settings → Community plugins

### Quick Install (without building)

1. Create folder `.obsidian/plugins/link-scraper/` in your vault
2. Copy these files there:
   - `manifest.json`
   - `main.ts` (rename to `main.js` after building, or build first)
   - `styles.css`

## Usage

### Ribbon Icon
Click the 🔗 icon in the left sidebar to open the scraper window.

### Commands (Ctrl+P / Cmd+P)
- **Scrape links from current note** - scans only the open note
- **Scrape all links from vault** - opens progress window
- **Scrape link under cursor** - scrapes only the link in current line

## Settings

- **Output folder** - where to save scraped content (default: `scraped-links`)
- **Add backlinks** - whether to add `[[link|📥]]` to original notes
- **Skip domains** - list of domains to skip (e.g. youtube, twitter)
- **Timeout** - maximum wait time for response

## Saved File Format

```markdown
---
url: "https://example.com/article"
title: "Article Title"
domain: "example.com"
scraped_at: "2025-01-10T12:00:00"
source_notes: ["[[NoteA]]", "[[NoteB]]"]
---

# Article Title

> **Source:** https://example.com/article
> **Scraped:** 2025-01-10
> **Linked from:** [[NoteA]], [[NoteB]]

## Description
Meta description from the page...

## Content
Main article content...
```

## Limitations

- Some sites may block requests (403 Forbidden)
- Paywalled content won't be scraped
- JavaScript-rendered pages may have limited content
- Domains like YouTube, Twitter are skipped by default (configurable in settings)

## License

MIT
