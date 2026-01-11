import {
	App,
	Plugin,
	PluginSettingTab,
	Setting,
	Notice,
	TFile,
	TFolder,
	requestUrl,
	Modal,
	Menu,
	AbstractInputSuggest,
	TAbstractFile,
} from "obsidian";

// ============== Folder Suggester ==============
class FolderSuggest extends AbstractInputSuggest<TFolder> {
	private inputEl: HTMLInputElement;

	constructor(app: App, inputEl: HTMLInputElement) {
		super(app, inputEl);
		this.inputEl = inputEl;
	}

	getSuggestions(inputStr: string): TFolder[] {
		const folders: TFolder[] = [];
		const lowerInput = inputStr.toLowerCase();
		
		// Get current value to check for comma-separated input
		const currentValue = this.inputEl.value;
		const lastComma = currentValue.lastIndexOf(",");
		const searchTerm = lastComma >= 0 
			? currentValue.substring(lastComma + 1).trim().toLowerCase()
			: lowerInput;

		const walkFolders = (folder: TAbstractFile) => {
			if (folder instanceof TFolder) {
				if (folder.path.toLowerCase().includes(searchTerm) || searchTerm === "") {
					folders.push(folder);
				}
				for (const child of folder.children) {
					walkFolders(child);
				}
			}
		};

		walkFolders(this.app.vault.getRoot());
		
		return folders.slice(0, 20); // Limit to 20 suggestions
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.createEl("div", { text: folder.path || "/" });
	}

	selectSuggestion(folder: TFolder): void {
		const currentValue = this.inputEl.value;
		const lastComma = currentValue.lastIndexOf(",");
		
		if (lastComma >= 0) {
			// Append to existing list
			const prefix = currentValue.substring(0, lastComma + 1);
			this.inputEl.value = `${prefix} ${folder.path}`;
		} else {
			this.inputEl.value = folder.path;
		}
		
		this.inputEl.trigger("input");
		this.close();
	}
}

// ============== Settings ==============
interface LinkScraperSettings {
	outputFolder: string;
	maxConcurrent: number;
	timeout: number;
	addBacklinks: boolean;
	backlinkText: string;
	skipDomains: string;
	skipDomainsWhenExternal: string;
	skipAlreadyScraped: boolean;
	useExternalScraper: boolean;
	externalScraperUrl: string;
	externalScraperApiKey: string;
	includeFolders: string;
	excludeFolders: string;
}

const DEFAULT_SETTINGS: LinkScraperSettings = {
	outputFolder: "scraped-links",
	maxConcurrent: 3,
	timeout: 20000,
	addBacklinks: true,
	backlinkText: "scraped",
	skipDomains: "",
	skipDomainsWhenExternal: "",
	skipAlreadyScraped: true,
	useExternalScraper: false,
	externalScraperUrl: "https://r.jina.ai/",
	externalScraperApiKey: "",
	includeFolders: "",
	excludeFolders: "",
};

// ============== Types ==============
interface ExtractedLink {
	url: string;
	sourceFile: string;
	linkText?: string;
}

interface ScrapedContent {
	url: string;
	title: string;
	description: string;
	content: string;
	domain: string;
	success: boolean;
	error?: string;
}

// ============== Main Plugin ==============
export default class LinkScraperPlugin extends Plugin {
	settings: LinkScraperSettings;

	async onload() {
		await this.loadSettings();

		// Ribbon icon with dropdown menu
		this.addRibbonIcon("link", "Link scraper", (evt) => {
			const menu = new Menu();

			menu.addItem((item) =>
				item
					.setTitle("Scrape current note")
					.setIcon("file-text")
					.onClick(() => this.scrapeCurrentNote())
			);

			menu.addItem((item) =>
				item
					.setTitle("Scrape folder...")
					.setIcon("folder")
					.onClick(() => new FolderPickerModal(this.app, this).open())
			);

			menu.addItem((item) =>
				item
					.setTitle("Scrape all links in vault")
					.setIcon("vault")
					.onClick(() => new ScraperModal(this.app, this).open())
			);

			menu.addSeparator();

			menu.addItem((item) =>
				item
					.setTitle("Open settings")
					.setIcon("settings")
					.onClick(() => {
						// @ts-ignore
						this.app.setting.open();
						// @ts-ignore
						this.app.setting.openTabById("link-scraper");
					})
			);

			menu.showAtMouseEvent(evt);
		});

		// File menu (right-click on file or folder)
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				// For markdown files
				if (file instanceof TFile && file.extension === "md") {
					menu.addItem((item) => {
						item
							.setTitle("Scrape links from this note")
							.setIcon("link")
							.onClick(async () => {
								const links = await this.extractLinksFromFile(file);
								if (links.length === 0) {
									new Notice("No links found in this note");
									return;
								}
								const urls = [...new Set(links.map((l) => l.url))];
								new Notice(`Found ${urls.length} links, scraping...`);
								await this.scrapeUrls(urls, file.path);
							});
					});
				}
				
				// For folders
				if (file instanceof TFolder) {
					menu.addItem((item) => {
						item
							.setTitle("Scrape links from this folder")
							.setIcon("link")
							.onClick(() => {
								new ScraperModal(this.app, this, file.path).open();
							});
					});
				}
			})
		);

		// Editor menu (right-click in editor)
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor, view) => {
				const cursor = editor.getCursor();
				const line = editor.getLine(cursor.line);
				const urls = this.extractUrlsFromText(line);

				if (urls.length > 0) {
					menu.addItem((item) => {
						item
							.setTitle("Scrape link: " + urls[0].substring(0, 40) + "...")
							.setIcon("link")
							.onClick(async () => {
								const file = view.file;
								if (file) {
									await this.scrapeUrls(urls, file.path);
								}
							});
					});
				}
			})
		);

		// Command: Scrape links from current note
		this.addCommand({
			id: "scrape-current-note",
			name: "Scrape links from current note",
			callback: () => this.scrapeCurrentNote(),
		});

		// Command: Scrape all links from vault
		this.addCommand({
			id: "scrape-all-links",
			name: "Scrape all links from vault",
			callback: () => {
				new ScraperModal(this.app, this).open();
			},
		});

		// Command: Scrape link under cursor
		this.addCommand({
			id: "scrape-link-under-cursor",
			name: "Scrape link under cursor",
			editorCallback: async (editor) => {
				const cursor = editor.getCursor();
				const line = editor.getLine(cursor.line);
				const urls = this.extractUrlsFromText(line);
				if (urls.length > 0) {
					await this.scrapeUrls(urls, this.app.workspace.getActiveFile()?.path || "");
				} else {
					new Notice("No link found in this line");
				}
			},
		});

		// Settings tab
		this.addSettingTab(new LinkScraperSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// Extract URLs from text
	extractUrlsFromText(text: string): string[] {
		const urls: string[] = [];
		
		// Markdown links [text](url)
		const mdLinkRegex = /\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
		let match;
		while ((match = mdLinkRegex.exec(text)) !== null) {
			urls.push(match[2]);
		}

		// Remove markdown links to avoid duplicates
		const textWithoutMd = text.replace(mdLinkRegex, "");

		// Raw URLs - note: [ doesn't need escaping inside character class
		const rawUrlRegex = /(https?:\/\/[^\s<>[\]()"'`]+)/g;
		while ((match = rawUrlRegex.exec(textWithoutMd)) !== null) {
			const url = match[1].replace(/[.,;:]+$/, ""); // remove trailing punctuation
			if (!urls.includes(url)) {
				urls.push(url);
			}
		}

		return urls;
	}

	// Extract links from file
	async extractLinksFromFile(file: TFile): Promise<ExtractedLink[]> {
		const links: ExtractedLink[] = [];
		const content = await this.app.vault.read(file);
		const urls = this.extractUrlsFromText(content);

		for (const url of urls) {
			links.push({
				url,
				sourceFile: file.path,
			});
		}

		return links;
	}

	// Check if file should be included based on folder settings
	shouldIncludeFile(filePath: string): boolean {
		// Always exclude output folder
		if (filePath.startsWith(this.settings.outputFolder)) {
			return false;
		}

		// Check exclude folders
		const excludeFolders = this.settings.excludeFolders
			.split(",")
			.map((f) => f.trim())
			.filter((f) => f.length > 0);
		
		for (const folder of excludeFolders) {
			if (filePath.startsWith(folder) || filePath.startsWith(folder + "/")) {
				return false;
			}
		}

		// Check include folders (if specified)
		const includeFolders = this.settings.includeFolders
			.split(",")
			.map((f) => f.trim())
			.filter((f) => f.length > 0);
		
		if (includeFolders.length > 0) {
			// Must be in one of the include folders
			return includeFolders.some((folder) => 
				filePath.startsWith(folder) || filePath.startsWith(folder + "/")
			);
		}

		return true;
	}

	// Scan vault or specific folder
	async scanVaultForLinks(folderPath: string | null = null): Promise<Map<string, ExtractedLink[]>> {
		const allLinks = new Map<string, ExtractedLink[]>();
		const files = this.app.vault.getMarkdownFiles();

		for (const file of files) {
			// If specific folder is requested, check if file is in that folder
			if (folderPath !== null) {
				if (!file.path.startsWith(folderPath) && !file.path.startsWith(folderPath + "/")) {
					continue;
				}
			}
			
			// Check folder inclusion/exclusion (from settings)
			if (!this.shouldIncludeFile(file.path)) continue;

			const links = await this.extractLinksFromFile(file);
			for (const link of links) {
				if (!allLinks.has(link.url)) {
					allLinks.set(link.url, []);
				}
				allLinks.get(link.url)!.push(link);
			}
		}

		return allLinks;
	}

	// Scrape current note
	async scrapeCurrentNote() {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice("No active note");
			return;
		}

		const links = await this.extractLinksFromFile(activeFile);
		if (links.length === 0) {
			new Notice("No links found in this note");
			return;
		}

		const urls = [...new Set(links.map((l) => l.url))];
		new Notice(`Found ${urls.length} links, scraping...`);

		await this.scrapeUrls(urls, activeFile.path);
	}

	// Check if domain should be skipped
	shouldSkipDomain(url: string): boolean {
		try {
			const domain = new URL(url).hostname.toLowerCase();
			
			// Use different skip list depending on scraper mode
			const skipListSetting = this.settings.useExternalScraper 
				? this.settings.skipDomainsWhenExternal 
				: this.settings.skipDomains;
			
			const skipList = skipListSetting
				.split(",")
				.map((d) => d.trim().toLowerCase())
				.filter((d) => d.length > 0);
			
			return skipList.some((skip) => domain.includes(skip));
		} catch {
			return false;
		}
	}

	// Check if URL was already scraped (file exists)
	isAlreadyScraped(url: string): boolean {
		if (!this.settings.skipAlreadyScraped) return false;
		
		const hash = this.hashUrl(url);
		const outputFolder = this.settings.outputFolder;
		const folder = this.app.vault.getAbstractFileByPath(outputFolder);
		
		if (folder instanceof TFolder) {
			for (const file of folder.children) {
				if (file instanceof TFile && file.name.includes(hash)) {
					return true;
				}
			}
		}
		return false;
	}

	// Scrape single URL
	async scrapeUrl(url: string): Promise<ScrapedContent | null> {
		const domain = new URL(url).hostname;

		// Skip already scraped
		if (this.isAlreadyScraped(url)) {
			return null; // null means skip
		}

		if (this.shouldSkipDomain(url)) {
			return {
				url,
				title: "",
				description: "",
				content: "",
				domain,
				success: false,
				error: "Domain on skip list",
			};
		}

		// Use external scraper API if enabled
		if (this.settings.useExternalScraper) {
			return this.scrapeWithExternalApi(url, domain);
		}

		try {
			const response = await requestUrl({
				url,
				method: "GET",
				headers: {
					"User-Agent":
						"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
					Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
				},
			});

			if (response.status !== 200) {
				return {
					url,
					title: "",
					description: "",
					content: "",
					domain,
					success: false,
					error: `HTTP ${response.status}`,
				};
			}

			const html = response.text;

			// Parse HTML
			const parser = new DOMParser();
			const doc = parser.parseFromString(html, "text/html");

			// Title
			let title = doc.querySelector("title")?.textContent || "";
			if (!title) {
				const ogTitle = doc.querySelector('meta[property="og:title"]');
				title = ogTitle?.getAttribute("content") || "";
			}

			// Description
			let description = "";
			const metaDesc = doc.querySelector('meta[name="description"]');
			if (metaDesc) {
				description = metaDesc.getAttribute("content") || "";
			}
			if (!description) {
				const ogDesc = doc.querySelector('meta[property="og:description"]');
				description = ogDesc?.getAttribute("content") || "";
			}

			// Content - remove unnecessary elements
			const elementsToRemove = doc.querySelectorAll(
				"script, style, nav, footer, header, aside, noscript, iframe, svg, form, [role='navigation'], .sidebar, .widget, .comments, .advertisement, .ad, .menu, .nav, .navigation, .breadcrumb, .related-posts, .share-buttons, .social-share"
			);
			elementsToRemove.forEach((el) => el.remove());

			// Helper function to extract and clean text from element
			const extractText = (el: Element | null): string => {
				if (!el) return "";
				let text = el.textContent || "";
				return text
					.split("\n")
					.map((line) => line.trim())
					.filter((line) => line.length > 2)
					.join("\n\n");
			};

			// Try multiple selectors and pick the one with most content
			const selectors = [
				"article .entry-content",
				"article .post-content",
				".entry-content",
				".post-content",
				".article-content",
				".page-content",
				'[itemprop="articleBody"]',
				".elementor-widget-theme-post-content",
				"main article",
				"article",
				"main",
				'[role="main"]',
				".elementor-section",
				'[class*="content"]:not([class*="sidebar"]):not([class*="header"]):not([class*="footer"])',
			];

			let content = "";
			let maxLength = 0;

			// First pass: try specific content selectors
			for (const selector of selectors) {
				try {
					const el = doc.querySelector(selector);
					const text = extractText(el);
					if (text.length > maxLength) {
						maxLength = text.length;
						content = text;
					}
				} catch {
					// Skip invalid selectors
				}
			}

			// If content is too short (less than 500 chars), fall back to body
			if (content.length < 500) {
				const bodyText = extractText(doc.body);
				if (bodyText.length > content.length) {
					content = bodyText;
				}
			}

			// Limit by characters (50000 chars ~ 8000-10000 words)
			if (content.length > 50000) {
				content = content.substring(0, 50000) + "\n\n[... content truncated ...]";
			}

			return {
				url,
				title: title.trim(),
				description: description.trim(),
				content,
				domain,
				success: true,
			};
		} catch (e) {
			return {
				url,
				title: "",
				description: "",
				content: "",
				domain,
				success: false,
				error: String(e).substring(0, 200),
			};
		}
	}

	// Scrape using external API (Jina Reader, Firecrawl, etc.)
	async scrapeWithExternalApi(url: string, domain: string): Promise<ScrapedContent> {
		try {
			const apiUrl = this.settings.externalScraperUrl;
			const apiKey = this.settings.externalScraperApiKey;

			// Build request URL - Jina Reader style (prepend URL)
			let requestUrlStr = apiUrl;
			if (apiUrl.includes("r.jina.ai") || apiUrl.endsWith("/")) {
				requestUrlStr = apiUrl + url;
			} else {
				// Custom API - assume it takes URL as query param
				requestUrlStr = apiUrl + "?url=" + encodeURIComponent(url);
			}

			const headers: Record<string, string> = {
				"Accept": "text/plain, application/json",
				"User-Agent": "ObsidianLinkScraper/1.0",
			};

			// Add API key if provided
			if (apiKey) {
				headers["Authorization"] = `Bearer ${apiKey}`;
				headers["X-API-Key"] = apiKey;
			}

			const response = await requestUrl({
				url: requestUrlStr,
				method: "GET",
				headers,
			});

			if (response.status !== 200) {
				return {
					url,
					title: "",
					description: "",
					content: "",
					domain,
					success: false,
					error: `External API error: HTTP ${response.status}`,
				};
			}

			const text = response.text;

			// Try to parse as JSON first (some APIs return JSON)
			try {
				const json = JSON.parse(text);
				return {
					url,
					title: json.title || json.data?.title || "",
					description: json.description || json.data?.description || "",
					content: json.content || json.data?.content || json.markdown || json.data?.markdown || json.text || "",
					domain,
					success: true,
				};
			} catch {
				// Not JSON, treat as plain text/markdown (Jina Reader returns markdown)
			}

			// Parse Jina Reader markdown response
			let title = "";
			let content = text;

			// Jina Reader format: Title: ...\nURL Source: ...\n\nContent...
			const lines = text.split("\n");
			if (lines[0]?.startsWith("Title:")) {
				title = lines[0].replace("Title:", "").trim();
			}

			// Find where actual content starts (after metadata)
			let contentStartIndex = 0;
			for (let i = 0; i < Math.min(10, lines.length); i++) {
				if (lines[i] === "" && i > 0) {
					contentStartIndex = i + 1;
					break;
				}
			}
			content = lines.slice(contentStartIndex).join("\n").trim();

			// Limit content length
			if (content.length > 50000) {
				content = content.substring(0, 50000) + "\n\n[... content truncated ...]";
			}

			return {
				url,
				title,
				description: "",
				content,
				domain,
				success: true,
			};
		} catch (e) {
			return {
				url,
				title: "",
				description: "",
				content: "",
				domain,
				success: false,
				error: `External API error: ${String(e).substring(0, 200)}`,
			};
		}
	}

	// Generate safe filename
	sanitizeFilename(name: string): string {
		return name
			.replace(/[<>:"/\\|?*]/g, "_")
			.replace(/\s+/g, " ")
			.trim()
			.substring(0, 80);
	}

	// Hash URL
	hashUrl(url: string): string {
		let hash = 0;
		for (let i = 0; i < url.length; i++) {
			const char = url.charCodeAt(i);
			hash = (hash << 5) - hash + char;
			hash = hash & hash;
		}
		return Math.abs(hash).toString(16).substring(0, 8);
	}

	// Save scraped content
	async saveScrapedContent(
		content: ScrapedContent,
		sourceFiles: string[]
	): Promise<string | null> {
		// Ensure output folder exists
		const outputFolder = this.settings.outputFolder;
		if (!(await this.app.vault.adapter.exists(outputFolder))) {
			await this.app.vault.createFolder(outputFolder);
		}

		// Filename
		let filename: string;
		if (content.title) {
			filename = this.sanitizeFilename(content.title);
		} else {
			filename = this.sanitizeFilename(content.domain + "_" + this.hashUrl(content.url));
		}
		filename = `${filename}_${this.hashUrl(content.url)}.md`;
		const filePath = `${outputFolder}/${filename}`;

		// Backlinks to sources
		const sources = [...new Set(sourceFiles.map((f) => `[[${f.replace(".md", "")}]]`))];
		const titleSafe = (content.title || content.url).replace(/"/g, "'");

		// File content
		let mdContent = `---
url: "${content.url}"
title: "${titleSafe}"
domain: "${content.domain}"
scraped_at: "${new Date().toISOString()}"
success: ${content.success}
source_notes: ${JSON.stringify(sources)}
---

# ${content.title || content.url}

> **Source:** ${content.url}
> **Scraped:** ${new Date().toISOString().split("T")[0]}
> **Linked from:** ${sources.join(", ")}

`;

		if (content.success) {
			if (content.description) {
				mdContent += `## Description\n\n${content.description}\n\n`;
			}
			if (content.content) {
				mdContent += `## Content\n\n${content.content}\n`;
			} else {
				mdContent += `## Content\n\n*Page has no text content (may use JavaScript)*\n`;
			}
		} else {
			mdContent += `## Scraping error\n\nFailed to scrape: **${content.error}**\n`;
		}

		// Save file
		const existingFile = this.app.vault.getAbstractFileByPath(filePath);
		if (existingFile instanceof TFile) {
			await this.app.vault.modify(existingFile, mdContent);
		} else {
			await this.app.vault.create(filePath, mdContent);
		}

		return filePath;
	}

	// Add backlink to note
	async addBacklinkToNote(notePath: string, scrapedPath: string, url: string) {
		if (!this.settings.addBacklinks) return;

		const file = this.app.vault.getAbstractFileByPath(notePath);
		if (!(file instanceof TFile)) return;

		const content = await this.app.vault.read(file);
		const scrapedName = scrapedPath.replace(".md", "").split("/").pop();
		const linkText = this.settings.backlinkText || "scraped";
		const backlink = ` [[${scrapedPath.replace(".md", "")}|${linkText}]]`;

		// Check if backlink already exists
		if (content.includes(scrapedName!)) return;

		// Add backlink after URL
		let newContent = content;

		// For markdown links - build pattern without unnecessary escapes
		const escapedUrl = this.escapeRegex(url);
		const mdPattern = new RegExp(
			"(\\[[^\\]]*\\]\\(" + escapedUrl + "\\))",
			"g"
		);
		newContent = newContent.replace(mdPattern, `$1${backlink}`);

		// For raw URLs (if no markdown match)
		if (newContent === content) {
			newContent = content.replace(url, `${url}${backlink}`);
		}

		if (newContent !== content) {
			await this.app.vault.modify(file, newContent);
		}
	}

	escapeRegex(str: string): string {
		return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}

	// Main scraping function
	async scrapeUrls(urls: string[], sourceFile: string) {
		const notice = new Notice(`Scraping ${urls.length} links...`, 0);

		let success = 0;
		let failed = 0;
		let skipped = 0;

		for (let i = 0; i < urls.length; i++) {
			const url = urls[i];
			notice.setMessage(`Scraping ${i + 1}/${urls.length}: ${new URL(url).hostname}`);

			const content = await this.scrapeUrl(url);

			// null means already scraped - skip
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

			// Small pause to avoid overloading
			await new Promise((resolve) => setTimeout(resolve, 500));
		}

		notice.hide();
		new Notice(`Done: ${success} scraped, ${skipped} skipped, ${failed} failed`);
	}

	// Scrape all links from vault
	async scrapeAllLinks(
		allLinks: Map<string, ExtractedLink[]>,
		progressCallback?: (current: number, total: number, domain: string, status: string) => void
	) {
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

			// null means already scraped - skip
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

			const sourceFiles = allLinks.get(url)!.map((l) => l.sourceFile);
			const savedPath = await this.saveScrapedContent(content, sourceFiles);

			if (savedPath && this.settings.addBacklinks) {
				for (const link of allLinks.get(url)!) {
					await this.addBacklinkToNote(link.sourceFile, savedPath, url);
				}
			}

			// Pause
			await new Promise((resolve) => setTimeout(resolve, 300));
		}

		return { success, failed, skipped };
	}
}

// ============== Folder Picker Modal ==============
class FolderPickerModal extends Modal {
	plugin: LinkScraperPlugin;
	
	constructor(app: App, plugin: LinkScraperPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("link-scraper-modal");

		new Setting(contentEl).setName("Select folder to scrape").setHeading();

		const folderList = contentEl.createDiv({ cls: "link-scraper-folder-list" });
		
		// Get all folders
		const folders: TFolder[] = [];
		const walkFolders = (folder: TAbstractFile) => {
			if (folder instanceof TFolder && folder.path !== this.plugin.settings.outputFolder) {
				folders.push(folder);
				for (const child of folder.children) {
					walkFolders(child);
				}
			}
		};
		walkFolders(this.app.vault.getRoot());

		// Sort folders alphabetically
		folders.sort((a, b) => a.path.localeCompare(b.path));

		// Create folder buttons
		for (const folder of folders) {
			const folderItem = folderList.createDiv({ cls: "link-scraper-folder-item" });
			folderItem.createSpan({ text: folder.path || "/ (root)" });
			folderItem.addEventListener("click", () => {
				this.close();
				new ScraperModal(this.app, this.plugin, folder.path).open();
			});
		}

		// Close button
		const buttonContainer = contentEl.createDiv({ cls: "link-scraper-buttons" });
		const cancelBtn = buttonContainer.createEl("button", { text: "Cancel" });
		cancelBtn.addEventListener("click", () => this.close());
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// ============== Progress Modal ==============
class ScraperModal extends Modal {
	plugin: LinkScraperPlugin;
	folderPath: string | null;
	statusEl: HTMLElement;
	progressContainer: HTMLElement;
	progressText: HTMLElement;
	progressBar: HTMLElement;
	progressBarFill: HTMLElement;
	progressStatus: HTMLElement;
	startBtn: HTMLButtonElement;
	isRunning = false;

	constructor(app: App, plugin: LinkScraperPlugin, folderPath: string | null = null) {
		super(app);
		this.plugin = plugin;
		this.folderPath = folderPath;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("link-scraper-modal");

		// Title - different based on scope
		const title = this.folderPath 
			? `Scrape links from: ${this.folderPath}`
			: "Scrape all links";
		new Setting(contentEl).setName(title).setHeading();

		// Status
		const scopeText = this.folderPath ? `folder "${this.folderPath}"` : "vault";
		this.statusEl = contentEl.createEl("p", {
			text: `Click start to scan the ${scopeText} and scrape all links.`,
			cls: "link-scraper-status"
		});

		// Progress container
		this.progressContainer = contentEl.createDiv({ cls: "link-scraper-progress link-scraper-hidden" });
		
		this.progressText = this.progressContainer.createDiv({ cls: "link-scraper-progress-text" });
		
		const barContainer = this.progressContainer.createDiv({ cls: "link-scraper-bar-container" });
		this.progressBarFill = barContainer.createDiv({ cls: "link-scraper-bar-fill" });
		
		this.progressStatus = this.progressContainer.createDiv({ cls: "link-scraper-progress-status" });

		// Buttons
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
		if (this.isRunning) return;
		this.isRunning = true;
		this.startBtn.disabled = true;

		const scopeText = this.folderPath ? `folder "${this.folderPath}"` : "vault";
		this.statusEl.setText(`Scanning ${scopeText}...`);
		this.progressContainer.removeClass("link-scraper-hidden");

		const allLinks = await this.plugin.scanVaultForLinks(this.folderPath);
		const totalLinks = allLinks.size;

		if (totalLinks === 0) {
			this.statusEl.setText(`No links found in the ${scopeText}.`);
			this.isRunning = false;
			this.startBtn.disabled = false;
			return;
		}

		this.statusEl.setText(`Found ${totalLinks} unique links, scraping...`);

		const result = await this.plugin.scrapeAllLinks(
			allLinks,
			(current, total, domain, status) => {
				const percent = Math.round((current / total) * 100);
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
}

// ============== Settings Tab ==============
class LinkScraperSettingTab extends PluginSettingTab {
	plugin: LinkScraperPlugin;

	constructor(app: App, plugin: LinkScraperPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// Folder settings section
		new Setting(containerEl).setName("Folder scope").setHeading();

		new Setting(containerEl)
			.setName("Output folder")
			.setDesc("Folder where scraped content will be saved (also excluded from scanning)")
			.addText((text) => {
				text
					.setPlaceholder("scraped-links")
					.setValue(this.plugin.settings.outputFolder)
					.onChange(async (value) => {
						this.plugin.settings.outputFolder = value || "scraped-links";
						await this.plugin.saveSettings();
					});
				new FolderSuggest(this.app, text.inputEl);
			});

		new Setting(containerEl)
			.setName("Include folders")
			.setDesc("Only scan these folders (comma-separated, empty = all). Start typing to see suggestions.")
			.addText((text) => {
				text
					.setPlaceholder("Notes, Projects, Archive")
					.setValue(this.plugin.settings.includeFolders)
					.onChange(async (value) => {
						this.plugin.settings.includeFolders = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.addClass("link-scraper-wide-input");
				new FolderSuggest(this.app, text.inputEl);
			});

		new Setting(containerEl)
			.setName("Exclude folders")
			.setDesc("Skip these folders (comma-separated). Output folder is always excluded.")
			.addText((text) => {
				text
					.setPlaceholder("Templates, Daily Notes")
					.setValue(this.plugin.settings.excludeFolders)
					.onChange(async (value) => {
						this.plugin.settings.excludeFolders = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.addClass("link-scraper-wide-input");
				new FolderSuggest(this.app, text.inputEl);
			});

		// Backlinks section
		new Setting(containerEl).setName("Backlinks").setHeading();

		new Setting(containerEl)
			.setName("Add backlinks")
			.setDesc("Automatically add [[link|text]] next to urls in original notes")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.addBacklinks)
					.onChange(async (value) => {
						this.plugin.settings.addBacklinks = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Backlink text")
			.setDesc("Text displayed for backlink (e.g. 'scraped', '📥', 'archived')")
			.addText((text) =>
				text
					.setPlaceholder("scraped")
					.setValue(this.plugin.settings.backlinkText)
					.onChange(async (value) => {
						this.plugin.settings.backlinkText = value || "scraped";
						await this.plugin.saveSettings();
					})
			);

		// Domain filtering section
		new Setting(containerEl).setName("Domain filtering").setHeading();

		new Setting(containerEl)
			.setName("Skip domains (local scraper)")
			.setDesc("Domains to skip when using built-in scraper (comma-separated)")
			.addTextArea((text) =>
				text
					.setPlaceholder("youtube.com, facebook.com, twitter.com")
					.setValue(this.plugin.settings.skipDomains)
					.onChange(async (value) => {
						this.plugin.settings.skipDomains = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Skip domains (external API)")
			.setDesc("Domains to skip when using external API (fewer needed - Jina handles YouTube, Facebook)")
			.addTextArea((text) =>
				text
					.setPlaceholder("Leave empty to scrape all")
					.setValue(this.plugin.settings.skipDomainsWhenExternal)
					.onChange(async (value) => {
						this.plugin.settings.skipDomainsWhenExternal = value;
						await this.plugin.saveSettings();
					})
			);

		// General settings
		new Setting(containerEl).setName("General").setHeading();

		new Setting(containerEl)
			.setName("Timeout (ms)")
			.setDesc("Maximum time to wait for response")
			.addText((text) =>
				text
					.setPlaceholder("20000")
					.setValue(String(this.plugin.settings.timeout))
					.onChange(async (value) => {
						this.plugin.settings.timeout = parseInt(value) || 20000;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Skip already scraped")
			.setDesc("Skip urls that have already been scraped (file exists in output folder)")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.skipAlreadyScraped)
					.onChange(async (value) => {
						this.plugin.settings.skipAlreadyScraped = value;
						await this.plugin.saveSettings();
					})
			);

		// External scraper section
		new Setting(containerEl).setName("External scraper API").setHeading();

		new Setting(containerEl)
			.setName("Use external scraper")
			.setDesc("Use external API for better extraction (handles YouTube, Facebook, JS-heavy sites)")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.useExternalScraper)
					.onChange(async (value) => {
						this.plugin.settings.useExternalScraper = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Scraper API url")
			.setDesc("API endpoint (default: Jina Reader - free, no key required)")
			.addText((text) =>
				text
					.setPlaceholder("https://r.jina.ai/")
					.setValue(this.plugin.settings.externalScraperUrl)
					.onChange(async (value) => {
						this.plugin.settings.externalScraperUrl = value || "https://r.jina.ai/";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("API key (optional)")
			.setDesc("API key for services that require authentication")
			.addText((text) =>
				text
					.setPlaceholder("Enter API key")
					.setValue(this.plugin.settings.externalScraperApiKey)
					.onChange(async (value) => {
						this.plugin.settings.externalScraperApiKey = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
