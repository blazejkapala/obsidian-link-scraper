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
	MarkdownView,
	Menu,
	Editor,
} from "obsidian";

// ============== Settings ==============
interface LinkScraperSettings {
	outputFolder: string;
	maxConcurrent: number;
	timeout: number;
	addBacklinks: boolean;
	skipDomains: string;
	skipAlreadyScraped: boolean;
}

const DEFAULT_SETTINGS: LinkScraperSettings = {
	outputFolder: "scraped-links",
	maxConcurrent: 3,
	timeout: 20000,
	addBacklinks: true,
	skipDomains: "youtube.com, youtu.be, twitter.com, x.com, facebook.com",
	skipAlreadyScraped: true,
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
		this.addRibbonIcon("link", "Link Scraper", (evt) => {
			const menu = new Menu();

			menu.addItem((item) =>
				item
					.setTitle("🔗 Scrape current note")
					.setIcon("file-text")
					.onClick(() => this.scrapeCurrentNote())
			);

			menu.addItem((item) =>
				item
					.setTitle("📚 Scrape all links in vault")
					.setIcon("vault")
					.onClick(() => new ScraperModal(this.app, this).open())
			);

			menu.addSeparator();

			menu.addItem((item) =>
				item
					.setTitle("⚙️ Settings")
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

		// File menu (right-click on file)
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (file instanceof TFile && file.extension === "md") {
					menu.addItem((item) => {
						item
							.setTitle("🔗 Scrape links from this note")
							.setIcon("link")
							.onClick(async () => {
								const links = await this.extractLinksFromFile(file);
								if (links.length === 0) {
									new Notice("No links found in this note");
									return;
								}
								const urls = [...new Set(links.map((l) => l.url))];
								new Notice(`Found ${urls.length} links. Scraping...`);
								await this.scrapeUrls(urls, file.path);
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
							.setTitle(`🔗 Scrape link: ${urls[0].substring(0, 40)}...`)
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
			editorCallback: (editor) => {
				const cursor = editor.getCursor();
				const line = editor.getLine(cursor.line);
				const urls = this.extractUrlsFromText(line);
				if (urls.length > 0) {
					this.scrapeUrls(urls, this.app.workspace.getActiveFile()?.path || "");
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

		// Raw URLs
		const rawUrlRegex = /(https?:\/\/[^\s<>\[\]()\"\'`]+)/g;
		while ((match = rawUrlRegex.exec(textWithoutMd)) !== null) {
			let url = match[1].replace(/[.,;:]+$/, ""); // remove trailing punctuation
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

	// Scan entire vault
	async scanVaultForLinks(): Promise<Map<string, ExtractedLink[]>> {
		const allLinks = new Map<string, ExtractedLink[]>();
		const files = this.app.vault.getMarkdownFiles();

		for (const file of files) {
			// Skip output folder
			if (file.path.startsWith(this.settings.outputFolder)) continue;

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
		new Notice(`Found ${urls.length} links. Scraping...`);

		await this.scrapeUrls(urls, activeFile.path);
	}

	// Check if domain should be skipped
	shouldSkipDomain(url: string): boolean {
		try {
			const domain = new URL(url).hostname;
			const skipList = this.settings.skipDomains
				.split(",")
				.map((d) => d.trim().toLowerCase());
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
				"script, style, nav, footer, header, aside, noscript, iframe, svg"
			);
			elementsToRemove.forEach((el) => el.remove());

			// Find main content
			let mainElement =
				doc.querySelector("main") ||
				doc.querySelector("article") ||
				doc.querySelector('[class*="content"]') ||
				doc.querySelector('[id*="content"]') ||
				doc.body;

			let content = "";
			if (mainElement) {
				content = mainElement.textContent || "";
				// Clean up
				content = content
					.split("\n")
					.map((line) => line.trim())
					.filter((line) => line.length > 2)
					.slice(0, 150)
					.join("\n\n");

				if (content.length > 15000) {
					content = content.substring(0, 15000) + "\n\n[... content truncated ...]";
				}
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

	// Generate safe filename
	sanitizeFilename(name: string): string {
		return name
			.replace(/[<>:\"\/\\|?*]/g, "_")
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
		const titleSafe = (content.title || content.url).replace(/\"/g, "'");

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
			mdContent += `## Scraping Error\n\n⚠️ Failed to scrape: **${content.error}**\n`;
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
		const backlink = ` [[${scrapedPath.replace(".md", "")}|📥]]`;

		// Check if backlink already exists
		if (content.includes(scrapedName!)) return;

		// Add backlink after URL
		let newContent = content;

		// For markdown links
		const mdPattern = new RegExp(
			`(\\[[^\\]]*\\]\\(${this.escapeRegex(url)}\\))`,
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
		new Notice(`✅ Scraped: ${success}, ⏭️ Skipped: ${skipped}, ❌ Failed: ${failed}`);
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

// ============== Progress Modal ==============
class ScraperModal extends Modal {
	plugin: LinkScraperPlugin;
	statusEl: HTMLElement;
	progressEl: HTMLElement;
	startBtn: HTMLButtonElement;
	isRunning = false;

	constructor(app: App, plugin: LinkScraperPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: "🔗 Link Scraper" });

		// Status
		this.statusEl = contentEl.createEl("p", {
			text: "Click Start to scan the vault and scrape all links.",
		});

		// Progress
		this.progressEl = contentEl.createEl("div", { cls: "link-scraper-progress" });
		this.progressEl.style.cssText =
			"margin: 20px 0; padding: 10px; background: var(--background-secondary); border-radius: 5px; display: none;";

		// Buttons
		const buttonContainer = contentEl.createEl("div", {
			cls: "link-scraper-buttons",
		});
		buttonContainer.style.cssText = "display: flex; gap: 10px; margin-top: 20px;";

		this.startBtn = buttonContainer.createEl("button", { text: "▶️ Start" });
		this.startBtn.style.cssText = "padding: 10px 20px; cursor: pointer;";
		this.startBtn.onclick = () => this.startScraping();

		const cancelBtn = buttonContainer.createEl("button", { text: "❌ Close" });
		cancelBtn.style.cssText = "padding: 10px 20px; cursor: pointer;";
		cancelBtn.onclick = () => this.close();
	}

	async startScraping() {
		if (this.isRunning) return;
		this.isRunning = true;
		this.startBtn.disabled = true;

		this.statusEl.setText("📂 Scanning vault...");
		this.progressEl.style.display = "block";

		const allLinks = await this.plugin.scanVaultForLinks();
		const totalLinks = allLinks.size;

		if (totalLinks === 0) {
			this.statusEl.setText("No links found in the vault.");
			this.isRunning = false;
			this.startBtn.disabled = false;
			return;
		}

		this.statusEl.setText(`Found ${totalLinks} unique links. Scraping...`);

		const result = await this.plugin.scrapeAllLinks(
			allLinks,
			(current, total, domain, status) => {
				const percent = Math.round((current / total) * 100);
				const statusIcon = status === "skipped" ? "⏭️" : "🔄";
				this.progressEl.innerHTML = `
					<div style="margin-bottom: 5px;">
						<strong>${current}/${total}</strong> (${percent}%)
					</div>
					<div style="background: var(--background-modifier-border); border-radius: 3px; height: 20px; overflow: hidden;">
						<div style="background: var(--interactive-accent); height: 100%; width: ${percent}%; transition: width 0.3s;"></div>
					</div>
					<div style="margin-top: 5px; font-size: 0.9em; color: var(--text-muted);">
						${statusIcon} ${domain}
					</div>
				`;
			}
		);

		this.statusEl.setText(
			`✅ Done! Scraped: ${result.success}, ⏭️ Skipped: ${result.skipped}, ❌ Failed: ${result.failed}`
		);
		this.progressEl.innerHTML = `
			<div style="text-align: center; color: var(--text-success);">
				<strong>Complete!</strong><br>
				Files saved in: ${this.plugin.settings.outputFolder}/
			</div>
		`;

		this.isRunning = false;
		this.startBtn.disabled = false;
		this.startBtn.setText("🔄 Run Again");
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

		containerEl.createEl("h2", { text: "Link Scraper - Settings" });

		new Setting(containerEl)
			.setName("Output folder")
			.setDesc("Folder where scraped content will be saved")
			.addText((text) =>
				text
					.setPlaceholder("scraped-links")
					.setValue(this.plugin.settings.outputFolder)
					.onChange(async (value) => {
						this.plugin.settings.outputFolder = value || "scraped-links";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Add backlinks")
			.setDesc("Automatically add [[link|📥]] next to URLs in original notes")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.addBacklinks)
					.onChange(async (value) => {
						this.plugin.settings.addBacklinks = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Skip domains")
			.setDesc("List of domains to skip (comma-separated)")
			.addTextArea((text) =>
				text
					.setPlaceholder("youtube.com, twitter.com")
					.setValue(this.plugin.settings.skipDomains)
					.onChange(async (value) => {
						this.plugin.settings.skipDomains = value;
						await this.plugin.saveSettings();
					})
			);

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
			.setDesc("Skip URLs that have already been scraped (file exists in output folder)")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.skipAlreadyScraped)
					.onChange(async (value) => {
						this.plugin.settings.skipAlreadyScraped = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
