var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => LinkScraperPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var DEFAULT_SETTINGS = {
  outputFolder: "scraped-links",
  maxConcurrent: 3,
  timeout: 2e4,
  addBacklinks: true,
  skipDomains: "youtube.com, youtu.be, twitter.com, x.com, facebook.com",
  skipAlreadyScraped: true
};
var LinkScraperPlugin = class extends import_obsidian.Plugin {
  async onload() {
    await this.loadSettings();
    this.addRibbonIcon("link", "Link scraper", (evt) => {
      const menu = new import_obsidian.Menu();
      menu.addItem(
        (item) => item.setTitle("Scrape current note").setIcon("file-text").onClick(() => this.scrapeCurrentNote())
      );
      menu.addItem(
        (item) => item.setTitle("Scrape all links in vault").setIcon("vault").onClick(() => new ScraperModal(this.app, this).open())
      );
      menu.addSeparator();
      menu.addItem(
        (item) => item.setTitle("Open settings").setIcon("settings").onClick(() => {
          this.app.setting.open();
          this.app.setting.openTabById("link-scraper");
        })
      );
      menu.showAtMouseEvent(evt);
    });
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof import_obsidian.TFile && file.extension === "md") {
          menu.addItem((item) => {
            item.setTitle("Scrape links from this note").setIcon("link").onClick(async () => {
              const links = await this.extractLinksFromFile(file);
              if (links.length === 0) {
                new import_obsidian.Notice("No links found in this note");
                return;
              }
              const urls = [...new Set(links.map((l) => l.url))];
              new import_obsidian.Notice(`Found ${urls.length} links, scraping...`);
              await this.scrapeUrls(urls, file.path);
            });
          });
        }
      })
    );
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, view) => {
        const cursor = editor.getCursor();
        const line = editor.getLine(cursor.line);
        const urls = this.extractUrlsFromText(line);
        if (urls.length > 0) {
          menu.addItem((item) => {
            item.setTitle("Scrape link: " + urls[0].substring(0, 40) + "...").setIcon("link").onClick(async () => {
              const file = view.file;
              if (file) {
                await this.scrapeUrls(urls, file.path);
              }
            });
          });
        }
      })
    );
    this.addCommand({
      id: "scrape-current-note",
      name: "Scrape links from current note",
      callback: () => this.scrapeCurrentNote()
    });
    this.addCommand({
      id: "scrape-all-links",
      name: "Scrape all links from vault",
      callback: () => {
        new ScraperModal(this.app, this).open();
      }
    });
    this.addCommand({
      id: "scrape-link-under-cursor",
      name: "Scrape link under cursor",
      editorCallback: async (editor) => {
        var _a;
        const cursor = editor.getCursor();
        const line = editor.getLine(cursor.line);
        const urls = this.extractUrlsFromText(line);
        if (urls.length > 0) {
          await this.scrapeUrls(urls, ((_a = this.app.workspace.getActiveFile()) == null ? void 0 : _a.path) || "");
        } else {
          new import_obsidian.Notice("No link found in this line");
        }
      }
    });
    this.addSettingTab(new LinkScraperSettingTab(this.app, this));
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  // Extract URLs from text
  extractUrlsFromText(text) {
    const urls = [];
    const mdLinkRegex = /\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
    let match;
    while ((match = mdLinkRegex.exec(text)) !== null) {
      urls.push(match[2]);
    }
    const textWithoutMd = text.replace(mdLinkRegex, "");
    const rawUrlRegex = /(https?:\/\/[^\s<>[\]()"'`]+)/g;
    while ((match = rawUrlRegex.exec(textWithoutMd)) !== null) {
      const url = match[1].replace(/[.,;:]+$/, "");
      if (!urls.includes(url)) {
        urls.push(url);
      }
    }
    return urls;
  }
  // Extract links from file
  async extractLinksFromFile(file) {
    const links = [];
    const content = await this.app.vault.read(file);
    const urls = this.extractUrlsFromText(content);
    for (const url of urls) {
      links.push({
        url,
        sourceFile: file.path
      });
    }
    return links;
  }
  // Scan entire vault
  async scanVaultForLinks() {
    const allLinks = /* @__PURE__ */ new Map();
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      if (file.path.startsWith(this.settings.outputFolder))
        continue;
      const links = await this.extractLinksFromFile(file);
      for (const link of links) {
        if (!allLinks.has(link.url)) {
          allLinks.set(link.url, []);
        }
        allLinks.get(link.url).push(link);
      }
    }
    return allLinks;
  }
  // Scrape current note
  async scrapeCurrentNote() {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      new import_obsidian.Notice("No active note");
      return;
    }
    const links = await this.extractLinksFromFile(activeFile);
    if (links.length === 0) {
      new import_obsidian.Notice("No links found in this note");
      return;
    }
    const urls = [...new Set(links.map((l) => l.url))];
    new import_obsidian.Notice(`Found ${urls.length} links, scraping...`);
    await this.scrapeUrls(urls, activeFile.path);
  }
  // Check if domain should be skipped
  shouldSkipDomain(url) {
    try {
      const domain = new URL(url).hostname;
      const skipList = this.settings.skipDomains.split(",").map((d) => d.trim().toLowerCase());
      return skipList.some((skip) => domain.includes(skip));
    } catch (e) {
      return false;
    }
  }
  // Check if URL was already scraped (file exists)
  isAlreadyScraped(url) {
    if (!this.settings.skipAlreadyScraped)
      return false;
    const hash = this.hashUrl(url);
    const outputFolder = this.settings.outputFolder;
    const folder = this.app.vault.getAbstractFileByPath(outputFolder);
    if (folder instanceof import_obsidian.TFolder) {
      for (const file of folder.children) {
        if (file instanceof import_obsidian.TFile && file.name.includes(hash)) {
          return true;
        }
      }
    }
    return false;
  }
  // Scrape single URL
  async scrapeUrl(url) {
    var _a;
    const domain = new URL(url).hostname;
    if (this.isAlreadyScraped(url)) {
      return null;
    }
    if (this.shouldSkipDomain(url)) {
      return {
        url,
        title: "",
        description: "",
        content: "",
        domain,
        success: false,
        error: "Domain on skip list"
      };
    }
    try {
      const response = await (0, import_obsidian.requestUrl)({
        url,
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
      });
      if (response.status !== 200) {
        return {
          url,
          title: "",
          description: "",
          content: "",
          domain,
          success: false,
          error: `HTTP ${response.status}`
        };
      }
      const html = response.text;
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      let title = ((_a = doc.querySelector("title")) == null ? void 0 : _a.textContent) || "";
      if (!title) {
        const ogTitle = doc.querySelector('meta[property="og:title"]');
        title = (ogTitle == null ? void 0 : ogTitle.getAttribute("content")) || "";
      }
      let description = "";
      const metaDesc = doc.querySelector('meta[name="description"]');
      if (metaDesc) {
        description = metaDesc.getAttribute("content") || "";
      }
      if (!description) {
        const ogDesc = doc.querySelector('meta[property="og:description"]');
        description = (ogDesc == null ? void 0 : ogDesc.getAttribute("content")) || "";
      }
      const elementsToRemove = doc.querySelectorAll(
        "script, style, nav, footer, header, aside, noscript, iframe, svg"
      );
      elementsToRemove.forEach((el) => el.remove());
      const mainElement = doc.querySelector("main") || doc.querySelector("article") || doc.querySelector('[class*="content"]') || doc.querySelector('[id*="content"]') || doc.body;
      let content = "";
      if (mainElement) {
        content = mainElement.textContent || "";
        content = content.split("\n").map((line) => line.trim()).filter((line) => line.length > 2).slice(0, 150).join("\n\n");
        if (content.length > 15e3) {
          content = content.substring(0, 15e3) + "\n\n[... content truncated ...]";
        }
      }
      return {
        url,
        title: title.trim(),
        description: description.trim(),
        content,
        domain,
        success: true
      };
    } catch (e) {
      return {
        url,
        title: "",
        description: "",
        content: "",
        domain,
        success: false,
        error: String(e).substring(0, 200)
      };
    }
  }
  // Generate safe filename
  sanitizeFilename(name) {
    return name.replace(/[<>:"/\\|?*]/g, "_").replace(/\s+/g, " ").trim().substring(0, 80);
  }
  // Hash URL
  hashUrl(url) {
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
      const char = url.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).substring(0, 8);
  }
  // Save scraped content
  async saveScrapedContent(content, sourceFiles) {
    const outputFolder = this.settings.outputFolder;
    if (!await this.app.vault.adapter.exists(outputFolder)) {
      await this.app.vault.createFolder(outputFolder);
    }
    let filename;
    if (content.title) {
      filename = this.sanitizeFilename(content.title);
    } else {
      filename = this.sanitizeFilename(content.domain + "_" + this.hashUrl(content.url));
    }
    filename = `${filename}_${this.hashUrl(content.url)}.md`;
    const filePath = `${outputFolder}/${filename}`;
    const sources = [...new Set(sourceFiles.map((f) => `[[${f.replace(".md", "")}]]`))];
    const titleSafe = (content.title || content.url).replace(/"/g, "'");
    let mdContent = `---
url: "${content.url}"
title: "${titleSafe}"
domain: "${content.domain}"
scraped_at: "${(/* @__PURE__ */ new Date()).toISOString()}"
success: ${content.success}
source_notes: ${JSON.stringify(sources)}
---

# ${content.title || content.url}

> **Source:** ${content.url}
> **Scraped:** ${(/* @__PURE__ */ new Date()).toISOString().split("T")[0]}
> **Linked from:** ${sources.join(", ")}

`;
    if (content.success) {
      if (content.description) {
        mdContent += `## Description

${content.description}

`;
      }
      if (content.content) {
        mdContent += `## Content

${content.content}
`;
      } else {
        mdContent += `## Content

*Page has no text content (may use JavaScript)*
`;
      }
    } else {
      mdContent += `## Scraping error

Failed to scrape: **${content.error}**
`;
    }
    const existingFile = this.app.vault.getAbstractFileByPath(filePath);
    if (existingFile instanceof import_obsidian.TFile) {
      await this.app.vault.modify(existingFile, mdContent);
    } else {
      await this.app.vault.create(filePath, mdContent);
    }
    return filePath;
  }
  // Add backlink to note
  async addBacklinkToNote(notePath, scrapedPath, url) {
    if (!this.settings.addBacklinks)
      return;
    const file = this.app.vault.getAbstractFileByPath(notePath);
    if (!(file instanceof import_obsidian.TFile))
      return;
    const content = await this.app.vault.read(file);
    const scrapedName = scrapedPath.replace(".md", "").split("/").pop();
    const backlink = ` [[${scrapedPath.replace(".md", "")}|\u{1F4E5}]]`;
    if (content.includes(scrapedName))
      return;
    let newContent = content;
    const escapedUrl = this.escapeRegex(url);
    const mdPattern = new RegExp(
      "(\\[[^\\]]*\\]\\(" + escapedUrl + "\\))",
      "g"
    );
    newContent = newContent.replace(mdPattern, `$1${backlink}`);
    if (newContent === content) {
      newContent = content.replace(url, `${url}${backlink}`);
    }
    if (newContent !== content) {
      await this.app.vault.modify(file, newContent);
    }
  }
  escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  // Main scraping function
  async scrapeUrls(urls, sourceFile) {
    const notice = new import_obsidian.Notice(`Scraping ${urls.length} links...`, 0);
    let success = 0;
    let failed = 0;
    let skipped = 0;
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      notice.setMessage(`Scraping ${i + 1}/${urls.length}: ${new URL(url).hostname}`);
      const content = await this.scrapeUrl(url);
      if (content === null) {
        skipped++;
        continue;
      }
      if (content.success) {
        success++;
      } else {
        failed++;
      }
      const savedPath = await this.saveScrapedContent(content, [sourceFile]);
      if (savedPath && content.success) {
        await this.addBacklinkToNote(sourceFile, savedPath, url);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    notice.hide();
    new import_obsidian.Notice(`Done: ${success} scraped, ${skipped} skipped, ${failed} failed`);
  }
  // Scrape all links from vault
  async scrapeAllLinks(allLinks, progressCallback) {
    const urls = Array.from(allLinks.keys());
    let success = 0;
    let failed = 0;
    let skipped = 0;
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const domain = new URL(url).hostname;
      if (progressCallback) {
        progressCallback(i + 1, urls.length, domain, "scraping");
      }
      const content = await this.scrapeUrl(url);
      if (content === null) {
        skipped++;
        if (progressCallback) {
          progressCallback(i + 1, urls.length, domain, "skipped");
        }
        continue;
      }
      if (content.success) {
        success++;
      } else {
        failed++;
      }
      const sourceFiles = allLinks.get(url).map((l) => l.sourceFile);
      const savedPath = await this.saveScrapedContent(content, sourceFiles);
      if (savedPath && this.settings.addBacklinks) {
        for (const link of allLinks.get(url)) {
          await this.addBacklinkToNote(link.sourceFile, savedPath, url);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return { success, failed, skipped };
  }
};
var ScraperModal = class extends import_obsidian.Modal {
  constructor(app, plugin) {
    super(app);
    this.isRunning = false;
    this.plugin = plugin;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("link-scraper-modal");
    new import_obsidian.Setting(contentEl).setName("Scrape all links").setHeading();
    this.statusEl = contentEl.createEl("p", {
      text: "Click start to scan the vault and scrape all links.",
      cls: "link-scraper-status"
    });
    this.progressContainer = contentEl.createDiv({ cls: "link-scraper-progress link-scraper-hidden" });
    this.progressText = this.progressContainer.createDiv({ cls: "link-scraper-progress-text" });
    const barContainer = this.progressContainer.createDiv({ cls: "link-scraper-bar-container" });
    this.progressBarFill = barContainer.createDiv({ cls: "link-scraper-bar-fill" });
    this.progressStatus = this.progressContainer.createDiv({ cls: "link-scraper-progress-status" });
    const buttonContainer = contentEl.createDiv({ cls: "link-scraper-buttons" });
    this.startBtn = buttonContainer.createEl("button", {
      text: "Start",
      cls: "mod-cta"
    });
    this.startBtn.addEventListener("click", () => {
      void this.startScraping();
    });
    const cancelBtn = buttonContainer.createEl("button", { text: "Close" });
    cancelBtn.addEventListener("click", () => this.close());
  }
  async startScraping() {
    if (this.isRunning)
      return;
    this.isRunning = true;
    this.startBtn.disabled = true;
    this.statusEl.setText("Scanning vault...");
    this.progressContainer.removeClass("link-scraper-hidden");
    const allLinks = await this.plugin.scanVaultForLinks();
    const totalLinks = allLinks.size;
    if (totalLinks === 0) {
      this.statusEl.setText("No links found in the vault.");
      this.isRunning = false;
      this.startBtn.disabled = false;
      return;
    }
    this.statusEl.setText(`Found ${totalLinks} unique links, scraping...`);
    const result = await this.plugin.scrapeAllLinks(
      allLinks,
      (current, total, domain, status) => {
        const percent = Math.round(current / total * 100);
        const statusLabel = status === "skipped" ? "Skipped" : "Processing";
        this.progressText.setText(`${current}/${total} (${percent}%)`);
        this.progressBarFill.style.width = `${percent}%`;
        this.progressStatus.setText(`${statusLabel}: ${domain}`);
      }
    );
    this.statusEl.setText(
      `Done: ${result.success} scraped, ${result.skipped} skipped, ${result.failed} failed`
    );
    this.progressText.setText("Complete");
    this.progressStatus.setText(`Files saved in: ${this.plugin.settings.outputFolder}/`);
    this.isRunning = false;
    this.startBtn.disabled = false;
    this.startBtn.setText("Run again");
  }
  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
};
var LinkScraperSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian.Setting(containerEl).setName("Output folder").setDesc("Folder where scraped content will be saved").addText(
      (text) => text.setPlaceholder("Scraped-links").setValue(this.plugin.settings.outputFolder).onChange(async (value) => {
        this.plugin.settings.outputFolder = value || "scraped-links";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Add backlinks").setDesc("Automatically add [[link|\u{1F4E5}]] next to urls in original notes").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.addBacklinks).onChange(async (value) => {
        this.plugin.settings.addBacklinks = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Skip domains").setDesc("List of domains to skip (comma-separated)").addTextArea(
      (text) => text.setPlaceholder("Youtube.com, twitter.com").setValue(this.plugin.settings.skipDomains).onChange(async (value) => {
        this.plugin.settings.skipDomains = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Timeout (ms)").setDesc("Maximum time to wait for response").addText(
      (text) => text.setPlaceholder("20000").setValue(String(this.plugin.settings.timeout)).onChange(async (value) => {
        this.plugin.settings.timeout = parseInt(value) || 2e4;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Skip already scraped").setDesc("Skip urls that have already been scraped (file exists in output folder)").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.skipAlreadyScraped).onChange(async (value) => {
        this.plugin.settings.skipAlreadyScraped = value;
        await this.plugin.saveSettings();
      })
    );
  }
};
