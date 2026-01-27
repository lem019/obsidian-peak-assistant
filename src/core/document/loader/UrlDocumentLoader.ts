import type { App } from 'obsidian';
import type { DocumentLoader } from './types';
import type { DocumentType, Document, ResourceSummary } from '@/core/document/types';
import { generateContentHash } from '@/core/utils/hash-utils';
import { PlaywrightWebBaseLoader } from '@langchain/community/document_loaders/web/playwright';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import type { Chunk } from '@/service/search/index/types';
import type { ChunkingSettings } from '@/app/settings/types';
import { generateUuidWithoutHyphens, generateDocIdFromPath } from '@/core/utils/id-utils';
import type { AIServiceManager } from '@/service/chat/service-manager';
import { getDefaultDocumentSummary } from './helper/DocumentLoaderHelpers';

/**
 * URL Document Loader
 * 
 * Specifically designed to fetch and process web content using Playwright via LangChain. 
 * Unlike other loaders, this doesn't correspond to a file in the vault, but rather an 
 * external web resource. It's used for web indexing and online search results.
 * 
 * URL 文档加载器
 * 
 * 专门设计用于通过 LangChain 使用 Playwright 获取和处理网页内容。
 * 与其他加载器不同，它不对应于库中的文件，而是外部网络资源。
 * 它用于网络索引和在线搜索结果。
 */
export class UrlDocumentLoader implements DocumentLoader {
	// Playwright configuration for browser automation
	// 用于浏览器自动化的 Playwright 配置
	private readonly playwrightConfig = {
		launchOptions: {
			headless: true, // Run in headless mode (no UI)
		},
		gotoOptions: {
			waitUntil: 'domcontentloaded' as const, // Wait for basic DOM content to load
		},
	};

	constructor(
		private readonly app: App,
		private readonly aiServiceManager?: AIServiceManager
	) { }

	/**
	 * Returns the type of document handled by this loader: 'url'.
	 * 返回此加载器处理的文档类型：'url'。
	 */
	getDocumentType(): DocumentType {
		return 'url';
	}

	/**
	 * Returns the list of supported "extensions" (simulated via .url).
	 * 返回支持的“扩展名”列表（通过 .url 模拟）。
	 */
	getSupportedExtensions(): string[] {
		return ['url'];
	}

	/**
	 * Fetches the URL content. For URLs, the 'path' argument is the URL itself.
	 * 获取 URL 内容。对于 URL，“path”参数就是 URL 本身。
	 */
	async readByPath(path: string, genCacheContent?: boolean): Promise<Document | null> {
		// Validate that the path is actually a valid URL
		// 验证路径是否确实是有效的 URL
		if (!this.isValidUrl(path)) return null;
		return await this.readUrl(path, genCacheContent);
	}

	/**
	 * Splits the loaded web content into chunks using RecursiveCharacterTextSplitter.
	 * 使用 RecursiveCharacterTextSplitter 将加载的网页内容拆分为分块。
	 */
	async chunkContent(
		doc: Document,
		settings: ChunkingSettings,
	): Promise<Chunk[]> {
		const content = doc.cacheFileInfo.content;
		const minSize = settings.minDocumentSizeForChunking;

		// Keep small pages as a single chunk
		// 将较小的页面保留为单个分块
		if (content.length <= minSize) {
			return [{
				docId: doc.id,
				content: content,
			}];
		}

		const splitter = new RecursiveCharacterTextSplitter({
			chunkSize: settings.maxChunkSize,
			chunkOverlap: settings.chunkOverlap,
		});

		const langchainDocs = await splitter.createDocuments([content]);
		const chunks: Chunk[] = [];
		for (let i = 0; i < langchainDocs.length; i++) {
			const langchainDoc = langchainDocs[i];
			chunks.push({
				docId: doc.id,
				content: langchainDoc.pageContent,
				chunkId: generateUuidWithoutHyphens(),
				chunkIndex: i,
			});
		}

		return chunks;
	}

	/**
	 * URLs are not stored as files in the vault, so scanning is skipped.
	 * URL 不作为文件存储在库中，因此跳过扫描。
	 */
	async *scanDocuments(params?: { limit?: number; batchSize?: number }): AsyncGenerator<Array<{ path: string; mtime: number; type: DocumentType }>> {
		// URLs are not files in the vault, so this returns empty
		// URL 不是库中的文件，因此返回空
		yield [];
	}

	/**
	 * Generates an AI summary for the fetched web content.
	 * 为获取的网页内容生成 AI 摘要。
	 */
	async getSummary(
		source: Document | string,
		provider?: string,
		modelId?: string
	): Promise<ResourceSummary> {
		if (!this.aiServiceManager) {
			throw new Error('UrlDocumentLoader requires AIServiceManager to generate summaries');
		}
		if (typeof source === 'string') {
			throw new Error('UrlDocumentLoader.getSummary requires a Document, not a string');
		}
		return getDefaultDocumentSummary(source, this.aiServiceManager, provider, modelId);
	}

	/**
	 * Validates if a string is a properly formatted URL.
	 * 验证字符串是否为格式正确的 URL。
	 */
	private isValidUrl(url: string): boolean {
		try {
			new URL(url);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Internal method to perform URL loading via Playwright.
	 * 通过 Playwright 执行 URL 加载的内部方法。
	 */
	private async readUrl(url: string, genCacheContent?: boolean): Promise<Document | null> {
		if (!this.isValidUrl(url)) {
			return null;
		}

		try {
			let content = '';
			const contentHash = generateContentHash(url);
			let title = '';
			
			// If we need to fetch the actual content (not just a placeholder)
			// 如果我们需要获取实际内容（而不仅仅是占位符）
			if (genCacheContent) {
				const loader = new PlaywrightWebBaseLoader(url, this.playwrightConfig);

				// Perform the browser navigation and content extraction
				// 执行浏览器导航和内容提取
				const docs = await loader.load();
				content = docs.map(doc => doc.pageContent).join('\n\n');

				// Generate a readable title from the URL
				// 从 URL 生成可读的标题
				const urlObj = new URL(url);
				title = urlObj.hostname + urlObj.pathname;
			}

			// Construct a Document object representing the external URL
			// 构造一个代表外部 URL 的 Document 对象
			return {
				id: generateDocIdFromPath(url),
				type: 'url',
				sourceFileInfo: {
					path: url,
					name: url,
					extension: 'url',
					size: content.length,
					mtime: Date.now(),
					ctime: Date.now(),
					content: '', // No local source content for remote URLs
				},
				cacheFileInfo: {
					path: url,
					name: url,
					extension: 'url',
					size: content.length,
					mtime: Date.now(),
					ctime: Date.now(),
					content, // The extracted web content is stored in cache
				},
				metadata: {
					title: title,
					tags: [],
				},
				contentHash,
				references: {
					outgoing: [],
					incoming: [],
				},
				lastProcessedAt: Date.now(),
			};
		} catch (error) {
			console.error('Error loading URL:', url, error);
			return null;
		}
	}
}

