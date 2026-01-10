# 🔗 Link Scraper - Obsidian Plugin

A plugin to automatically scrape content from all URL links in your Obsidian notes.

## Features

- 📂 **Vault scanning** - finds all URL links in your notes
- 🌐 **Content scraping** - downloads title, description and content from web pages
- 💾 **Save as notes** - saves scraped data as markdown files
- 🔙 **Backlinks** - automatically adds `[[link|📥]]` next to URLs in original notes
- ⏭️ **Skip already scraped** - avoids re-downloading links that were already scraped
- 📱 **Mobile support** - works on Obsidian mobile

## Installation

### From GitHub

```bash
cd /path/to/vault/.obsidian/plugins
git clone https://github.com/blazejkapala/obsidian-link-scraper.git link-scraper
```

Then enable the plugin in Obsidian: Settings → Community plugins → Link Scraper

### Manual Installation

1. Download `main.js`, `manifest.json`, `styles.css` from [Releases](https://github.com/blazejkapala/obsidian-link-scraper/releases)
2. Create folder `.obsidian/plugins/link-scraper/` in your vault
3. Copy the files there
4. Enable the plugin in Obsidian

### Build from Source

```bash
git clone https://github.com/blazejkapala/obsidian-link-scraper.git
cd obsidian-link-scraper
npm install
npm run build
```

## Usage

### 🔗 Ribbon Icon (Left Sidebar)
Click the link icon to open dropdown menu:
- **Scrape current note** - scrapes links from the active note
- **Scrape all links in vault** - opens progress window for full vault scan
- **Settings** - quick access to plugin settings

### 📁 File Context Menu
Right-click on any `.md` file in the file explorer:
- **"🔗 Scrape links from this note"**

### ✏️ Editor Context Menu
Right-click on a line containing a URL:
- **"🔗 Scrape link: https://..."**

### ⌨️ Commands (Ctrl+P / Cmd+P)
- **Scrape links from current note** - scans only the open note
- **Scrape all links from vault** - opens progress window
- **Scrape link under cursor** - scrapes only the link in current line

## Settings

| Setting | Description | Default |
|---------|-------------|---------|
| **Output folder** | Where to save scraped content | `scraped-links` |
| **Add backlinks** | Add `[[link\|📥]]` next to URLs in original notes | ✅ On |
| **Skip domains** | Domains to skip (comma-separated) | youtube.com, twitter.com, etc. |
| **Timeout** | Max wait time for response (ms) | 20000 |
| **Skip already scraped** | Don't re-download existing links | ✅ On |

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

## Progress Indicator

When scraping all links:
- Shows current progress (X/Y)
- Displays current domain being scraped
- Shows final stats: ✅ Scraped, ⏭️ Skipped, ❌ Failed

## Limitations

- Some sites may block requests (403 Forbidden)
- Paywalled content won't be scraped
- JavaScript-rendered pages may have limited content
- Domains like YouTube, Twitter are skipped by default (configurable)

## Changelog

### v0.2.0
- ✨ Dropdown menu on ribbon icon
- ✨ File context menu support
- ✨ Editor context menu support
- ✨ Skip already scraped URLs
- ✨ Mobile support

### v0.1.0
- 🎉 Initial release

## Author

**Błażej Kapała** - [GitHub](https://github.com/blazejkapala)

## License

MIT
