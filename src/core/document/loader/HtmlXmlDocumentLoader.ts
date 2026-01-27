import type { App } from 'obsidian';
import { TFile } from 'obsidian';
import type { DocumentLoader } from './types';
import type { DocumentType, Document, ResourceSummary } from '@/core/document/types';
import { generateContentHash } from '@/core/utils/hash-utils';
import type { Chunk } from '@/service/search/index/types';
import type { ChunkingSettings } from '@/app/settings/types';
import { generateUuidWithoutHyphens, generateDocIdFromPath } from '@/core/utils/id-utils';
import type { AIServiceManager } from '@/service/chat/service-manager';
import { getDefaultDocumentSummary } from './helper/DocumentLoaderHelpers';

/**
 * HTML/XML Document Loader
 * 
 * Handles reading and chunking of HTML and XML files within the vault. 
 * It employs a regex-based strategy to identify "meaningful" tags (like headers, sections, and paragraphs) 
 * to guide the chunking process, ensuring semantic boundaries are respected when possible.
 * 
 * HTML/XML 文档加载器
 * 
 * 处理库中 HTML 和 XML 文件的读取和分块。
 * 它采用基于正则表达式的策略来识别“有意义”的标签（如标题、章节和段落），
 * 以指导分块过程，确保在可能的情况下遵循语义边界。
 */
export class HtmlXmlDocumentLoader implements DocumentLoader {
	// Tags considered meaningful for structural splitting
	// 被认为对结构化拆分有意义的标签
	private static readonly MEANINGFUL_TAGS = ['div', 'section', 'article', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'td', 'th'];
	private readonly tagPattern: RegExp;

	constructor(
		private readonly app: App,
		private readonly aiServiceManager?: AIServiceManager
	) {
		// Initialize regex pattern once in constructor to detect opening and closing tags
		// 在构造函数中初始化正则表达式，用于检测开头和结尾标签
		const tagsPattern = HtmlXmlDocumentLoader.MEANINGFUL_TAGS.join('|');
		this.tagPattern = new RegExp(`(<(?:${tagsPattern})[^>]*>)([\\s\\S]*?)(</(?:${tagsPattern})>)`, 'gi');
	}

	/**
	 * Returns the type of document handled by this loader.
	 * 返回此加载器处理的文档类型：'html'。
	 */
	getDocumentType(): DocumentType {
		return 'html';
	}

	/**
	 * Returns the list of supported file extensions.
	 * 返回支持的文件扩展名列表。
	 */
	getSupportedExtensions(): string[] {
		return ['html', 'htm', 'xml'];
	}

	/**
	 * Reads an HTML/XML file by its path and converts it into a Document object.
	 * 根据路径读取 HTML/XML 文件并将其转换为 Document 对象。
	 */
	async readByPath(path: string): Promise<Document | null> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!file || !(file instanceof TFile)) return null;
		if (!this.getSupportedExtensions().includes(file.extension.toLowerCase())) return null;
		return await this.readHtmlXmlFile(file);
	}

	/**
	 * Splits the HTML/XML content into smaller chunks.
	 * Uses structural tags to segment the content before applying size constraints.
	 * 
	 * 将 HTML/XML 内容拆分为较小的分块。
	 * 在应用大小限制之前，使用结构化标签对内容进行分割。
	 */
	async chunkContent(
		doc: Document,
		settings: ChunkingSettings,
	): Promise<Chunk[]> {
		const content = doc.sourceFileInfo.content;
		const maxChunkSize = settings.maxChunkSize;
		const overlap = settings.chunkOverlap;
		const minSize = settings.minDocumentSizeForChunking;

		// Skip chunking if document is smaller than the minimum threshold
		if (content.length <= minSize) {
			return [{
				docId: doc.id,
				content: content,
			}];
		}

		// Split by meaningful tags while respecting size constraints
		const chunks: Chunk[] = [];
		let chunkIndex = 0;

		// Extract text content from HTML/XML by splitting on meaningful tags
		// This is a simplified approach - for production, consider using a proper HTML parser
		const segments: string[] = [];
		let lastIndex = 0;
		let match;

		// Reset regex lastIndex to ensure fresh matching
		this.tagPattern.lastIndex = 0;
		while ((match = this.tagPattern.exec(content)) !== null) {
			// Add text before the tag
			if (match.index > lastIndex) {
				const beforeText = content.substring(lastIndex, match.index);
				if (beforeText.trim()) {
					segments.push(beforeText.trim());
				}
			}
			// Add the tag content (text between opening and closing tags)
			const tagContent = match[2]?.trim();
			if (tagContent) {
				segments.push(tagContent);
			}
			lastIndex = this.tagPattern.lastIndex;
		}

		// Add remaining content after the last matched tag
		if (lastIndex < content.length) {
			const remaining = content.substring(lastIndex).trim();
			if (remaining) {
				segments.push(remaining);
			}
		}

		// If no segments found, fall back to simple size-based splitting
		if (segments.length === 0) {
			let start = 0;
			while (start < content.length) {
				const end = Math.min(start + maxChunkSize, content.length);
				const chunkContent = content.substring(start, end);
				chunks.push({
					docId: doc.id,
					content: chunkContent,
					chunkId: generateUuidWithoutHyphens(),
					chunkIndex: chunkIndex++,
				});
				start = end - overlap;
				if (start >= content.length) break;
			}
			return chunks;
		}

		// Group segments into chunks respecting size constraints and adding overlap
		let currentChunk = '';
		for (const segment of segments) {
			// If a single segment itself is too large, split it further
			if (segment.length > maxChunkSize) {
				// Save current chunk first if it exists
				if (currentChunk.length > 0) {
					chunks.push({
						docId: doc.id,
						content: currentChunk,
						chunkId: generateUuidWithoutHyphens(),
						chunkIndex: chunkIndex++,
					});
					currentChunk = '';
				}
				// Split large segment based on maxChunkSize
				let segStart = 0;
				while (segStart < segment.length) {
					const segEnd = Math.min(segStart + maxChunkSize, segment.length);
					const chunkContent = segment.substring(segStart, segEnd);
					chunks.push({
						docId: doc.id,
						content: chunkContent,
						chunkId: generateUuidWithoutHyphens(),
						chunkIndex: chunkIndex++,
					});
					segStart = segEnd - overlap;
					if (segStart >= segment.length) break;
				}
			} else if (currentChunk.length + segment.length > maxChunkSize && currentChunk.length > 0) {
				// Current chunk is full, save it and start new one with overlap from previous
				chunks.push({
					docId: doc.id,
					content: currentChunk,
					chunkId: generateUuidWithoutHyphens(),
					chunkIndex: chunkIndex++,
				});
				const overlapText = currentChunk.slice(-overlap);
				currentChunk = overlapText + '\n' + segment;
			} else {
				// Accumulate segment into current chunk
				currentChunk += (currentChunk ? '\n' : '') + segment;
			}
		}

		// Save any remaining accumulated content as the final chunk
		if (currentChunk.length > 0) {
			chunks.push({
				docId: doc.id,
				content: currentChunk,
				chunkId: generateUuidWithoutHyphens(),
				chunkIndex: chunkIndex++,
			});
		}

		return chunks;
	}

	/**
	 * Scans the vault for HTML/XML files.
	 * 扫描库中的 HTML/XML 文件。
	 */
	async *scanDocuments(params?: { limit?: number; batchSize?: number }): AsyncGenerator<Array<{ path: string; mtime: number; type: DocumentType }>> {
		const limit = params?.limit ?? Infinity;
		const batchSize = params?.batchSize ?? 100;

		const supportedExts = this.getSupportedExtensions();
		const files = this.app.vault.getFiles()
			.filter(f => supportedExts.includes(f.extension.toLowerCase()))
			.slice(0, limit);
		let batch: Array<{ path: string; mtime: number; type: DocumentType }> = [];

		for (const file of files) {
			batch.push({
				path: file.path,
				mtime: file.stat.mtime,
				type: 'html',
			});
			if (batch.length >= batchSize) {
				yield batch;
				batch = [];
			}
		}
		if (batch.length) yield batch;
	}

	/**
	 * Get summary for an HTML/XML document.
	 * 获取 HTML/XML 文档的摘要。
	 */
	async getSummary(
		source: Document | string,
		provider?: string,
		modelId?: string
	): Promise<ResourceSummary> {
		if (!this.aiServiceManager) {
			throw new Error('HtmlXmlDocumentLoader requires AIServiceManager to generate summaries');
		}
		if (typeof source === 'string') {
			throw new Error('HtmlXmlDocumentLoader.getSummary requires a Document, not a string');
		}
		return getDefaultDocumentSummary(source, this.aiServiceManager, provider, modelId);
	}

	/**
	 * Internal method to read file content and wrap it in a Document object.
	 * 内部方法：读取文件内容并将其封装在 Document 对象中。
	 */
	private async readHtmlXmlFile(file: TFile): Promise<Document | null> {
		try {
			const content = await this.app.vault.cachedRead(file);
			const contentHash = generateContentHash(content);

			return {
				id: generateDocIdFromPath(file.path),
				type: 'html',
				sourceFileInfo: {
					path: file.path,
					name: file.name,
					extension: file.extension,
					size: file.stat.size,
					mtime: file.stat.mtime,
					ctime: file.stat.ctime,
					content,
				},
				cacheFileInfo: {
					path: file.path,
					name: file.name,
					extension: file.extension,
					size: file.stat.size,
					mtime: file.stat.mtime,
					ctime: file.stat.ctime,
					content,
				},
				metadata: {
					title: file.basename,
					tags: [],
				},
				contentHash,
				references: {
					outgoing: [],
					incoming: [],
				},
				lastProcessedAt: Date.now(),
			};
		} catch {
			return null;
		}
	}
}

