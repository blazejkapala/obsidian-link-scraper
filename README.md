# 🔗 Link Scraper - Obsidian Plugin

A plugin to automatically scrape content from all URL links in your Obsidian notes.

## Features

- 📂 **Vault/folder scanning** - finds all URL links in your notes
- 🌐 **Content scraping** - downloads title, description and content from web pages
- 🤖 **External API support** - use Jina AI Reader for better extraction (JS-heavy sites, YouTube, etc.)
- 💾 **Save as notes** - saves scraped data as markdown files
- 🔙 **Customizable backlinks** - adds `[[link|(scraped)]]` next to URLs (text configurable)
- ⏭️ **Skip already scraped** - avoids re-downloading links that were already scraped
- 📁 **Folder filtering** - include/exclude specific folders from scanning
- ⏸️ **Background scraping** - pause, resume, cancel with progress panel
- 📊 **Status bar progress** - mini progress bar like Obsidian's sync
- 📱 **Mobile support** - works on Obsidian mobile

## Installation

### From Community Plugins (Recommended)

1. Open Settings → Community plugins
2. Click "Browse" and search for "Link Scraper"
3. Install and enable

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
- **Scrape current note** - scrapes links from the active note (with progress panel)
- **Scrape folder...** - pick a folder to scan
- **Scrape all links in vault** - opens progress window for full vault scan
- **View progress** - reopen progress panel if scraping is running
- **Open settings** - quick access to plugin settings

### 📁 File/Folder Context Menu
Right-click on any `.md` file or folder in the file explorer:
- **Scrape links from this note** - for markdown files
- **Scrape links from this folder** - for folders

### ✏️ Editor Context Menu
Right-click on a line containing a URL:
- **Scrape link: https://...**

### ⌨️ Commands (Ctrl+P / Cmd+P)
- **Scrape links from current note** - scans only the open note
- **Scrape all links from vault** - opens progress window
- **Scrape link under cursor** - scrapes only the link in current line
- **View scraping progress** - reopen progress panel

### 📊 Progress Panel
When scraping multiple links:
- **Progress bar** with percentage and count (e.g., `15/100`)
- **Current URL** being processed
- **Statistics** - success, skipped, failed counts
- **Scrollable log** of all processed items
- **Pause/Resume** - pause and continue later
- **Cancel** - stop and save remaining URLs for later
- **Minimize** - close panel, scraping continues in background

### 📈 Status Bar
When scraping runs in background:
- Mini progress bar in bottom-right corner
- Shows icon (🔗 running, ⏸ paused), count, and visual bar
- Click to reopen full progress panel

## Settings

### General

| Setting | Description | Default |
|---------|-------------|---------|
| **Output folder** | Where to save scraped content | `scraped-links` |
| **Add backlinks** | Add reference next to URLs in original notes | ✅ On |
| **Backlink text** | Text shown in backlinks (e.g., "scraped", "📥") | `scraped` |
| **Skip already scraped** | Don't re-download existing links | ✅ On |
| **Timeout** | Max wait time for response (ms) | 20000 |

### Folder Filtering

| Setting | Description | Default |
|---------|-------------|---------|
| **Include folders** | Only scan these folders (comma-separated, empty = all) | (empty) |
| **Exclude folders** | Skip these folders (comma-separated) | (empty) |

### Domain Filtering

| Setting | Description | Default |
|---------|-------------|---------|
| **Skip domains** | Domains to skip (comma-separated) | youtube.com, twitter.com, x.com, facebook.com, instagram.com, linkedin.com |
| **Skip domains only for built-in** | Only skip domains when using built-in scraper | ✅ On |

### External API (Optional)

| Setting | Description | Default |
|---------|-------------|---------|
| **Use external scraper** | Use external API for better extraction | ❌ Off |
| **API URL** | Scraper endpoint (Jina AI format) | `https://r.jina.ai/` |
| **API key** | Authorization key (if required) | (empty) |

**Recommended:** [Jina AI Reader](https://jina.ai/reader/) - free tier available, handles JavaScript-rendered pages, YouTube transcripts, and more.

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

## Tips

- **For JS-heavy sites** (SPAs, React apps): Enable external API scraping
- **For YouTube**: Use Jina AI Reader - it extracts video transcripts
- **For paywalled content**: External APIs may have better results
- **Large vaults**: Use folder filtering to process in batches
- **Slow connections**: Increase timeout in settings

## Limitations

- Some sites may block requests (403 Forbidden)
- Paywalled content may not be fully scraped
- JavaScript-rendered pages need external API for full content
- Rate limiting may occur with many requests

## Changelog

### v0.7.0
- ✨ Progress panel for single note scraping
- ✨ Mini progress bar in status bar
- ✨ Click status bar to reopen progress panel

### v0.6.0
- ✨ Background scraping with pause/resume/cancel
- ✨ Detailed progress panel with log

### v0.5.0
- ✨ Folder filtering (include/exclude folders)
- ✨ Customizable backlink text

### v0.4.0
- ✨ External API support (Jina AI Reader)
- ✨ Better content extraction

### v0.3.0
- ✨ Folder scraping support
- ✨ Folder picker modal

### v0.2.0
- ✨ Dropdown menu on ribbon icon
- ✨ File/folder context menu support
- ✨ Editor context menu support
- ✨ Skip already scraped URLs
- ✨ Mobile support

### v0.1.0
- 🎉 Initial release

## Author

**Błażej Kapała** - [GitHub](https://github.com/blazejkapala)

## License

MIT
