import type { App } from 'obsidian';
import { TFile } from 'obsidian';
import type { DocumentLoader } from './types';
import type { DocumentType, Document, ResourceSummary } from '@/core/document/types';
import { generateContentHash } from '@/core/utils/hash-utils';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import type { Chunk } from '@/service/search/index/types';
import type { ChunkingSettings } from '@/app/settings/types';
import { generateUuidWithoutHyphens, generateDocIdFromPath } from '@/core/utils/id-utils';
import type { AIServiceManager } from '@/service/chat/service-manager';
import { getDefaultDocumentSummary } from './helper/DocumentLoaderHelpers';

/**
 * Excalidraw Document Loader
 * 
 * Specifically designed to handle Excalidraw files within Obsidian. 
 * Supports both legacy .excalidraw files and the newer .excalidraw.md format.
 * For markdown-based Excalidraw files, it filters out the embedded JSON diagram data 
 * to extract only the human-readable text labels and notes.
 * 
 * Excalidraw 文档加载器
 * 
 * 专门设计用于处理 Obsidian 中的 Excalidraw 文件。
 * 支持旧版的 .excalidraw 文件和较新的 .excalidraw.md 格式。
 * 对于基于 Markdown 的 Excalidraw 文件，它会过滤掉嵌入的 JSON 图表数据，仅提取可读的文本标签和笔记。
 */
export class ExcalidrawDocumentLoader implements DocumentLoader {
	constructor(
		private readonly app: App,
		private readonly aiServiceManager?: AIServiceManager
	) {}

	/**
	 * Returns the type of document handled by this loader.
	 * 返回此加载器处理的文档类型：'excalidraw'。
	 */
	getDocumentType(): DocumentType {
		return 'excalidraw';
	}

	/**
	 * Returns the list of supported file extensions.
	 * 返回支持的文件扩展名列表。
	 */
	getSupportedExtensions(): string[] {
		return ['excalidraw', 'excalidraw.md'];
	}

	/**
	 * Check if a file path matches any of the supported extensions.
	 * For excalidraw, we check the full path suffix since extensions can be compound.
	 * 
	 * 检查路径是否匹配支持的扩展名。由于存在复合扩展名（如 .excalidraw.md），使用 endsWith 进行检查。
	 */
	private isSupportedPath(path: string): boolean {
		const supportedExts = this.getSupportedExtensions();
		return supportedExts.some(ext => path.endsWith('.' + ext));
	}

	/**
	 * Determines if a markdown file is an Excalidraw plugin file by checking its frontmatter.
	 * 通过检查 Frontmatter，判断一个 Markdown 文件是否为 Excalidraw 插件文件。
	 */
	private isExcalidrawMarkdown(content: string): boolean {
		const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
		if (frontmatterMatch) {
			const frontmatter = frontmatterMatch[1];
			return /^plugin:\s*excalidraw-plugin/m.test(frontmatter) || /^excalidraw-plugin/m.test(frontmatter);
		}
		return false;
	}

	/**
	 * Reads an Excalidraw file and returns a Document object.
	 * 读取 Excalidraw 文件并返回 Document 对象。
	 */
	async readByPath(filePath: string): Promise<Document | null> {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!file || !(file instanceof TFile)) return null;
		if (!this.isSupportedPath(filePath)) return null;
		return await this.readExcalidrawFile(file);
	}

	/**
	 * Splits the Excalidraw text content into smaller chunks.
	 * 将 Excalidraw 文本内容拆分为较小的分块。
	 */
	async chunkContent(
		doc: Document,
		settings: ChunkingSettings,
	): Promise<Chunk[]> {
		const content = doc.sourceFileInfo.content;
		const minSize = settings.minDocumentSizeForChunking;

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
	 * Scans the vault for Excalidraw files.
	 * 扫描库中的 Excalidraw 文件。
	 */
	async *scanDocuments(params?: { limit?: number; batchSize?: number }): AsyncGenerator<Array<{ path: string; mtime: number; type: DocumentType }>> {
		const limit = params?.limit ?? Infinity;
		const batchSize = params?.batchSize ?? 100;

		const files = this.app.vault.getFiles()
			.filter(f => this.isSupportedPath(f.path))
			.slice(0, limit);
		let batch: Array<{ path: string; mtime: number; type: DocumentType }> = [];

		for (const file of files) {
			batch.push({
				path: file.path,
				mtime: file.stat.mtime,
				type: 'excalidraw',
			});
			if (batch.length >= batchSize) {
				yield batch;
				batch = [];
			}
		}
		if (batch.length) yield batch;
	}

	/**
	 * Get summary for an Excalidraw document.
	 * 获取 Excalidraw 文档的摘要。
	 */
	async getSummary(
		source: Document | string,
		provider?: string,
		modelId?: string
	): Promise<ResourceSummary> {
		if (!this.aiServiceManager) {
			throw new Error('ExcalidrawDocumentLoader requires AIServiceManager to generate summaries');
		}
		if (typeof source === 'string') {
			throw new Error('ExcalidrawDocumentLoader.getSummary requires a Document, not a string');
		}
		return getDefaultDocumentSummary(source, this.aiServiceManager, provider, modelId);
	}

	/**
	 * Internal method to read and sanitize Excalidraw content.
	 * 内部方法：读取并清理 Excalidraw 内容以供索引。
	 */
	private async readExcalidrawFile(file: TFile): Promise<Document | null> {
		try {
			let content = await this.app.vault.cachedRead(file);

			// For .excalidraw.md files, check if it's an excalidraw plugin file
			if (file.path.endsWith('.excalidraw.md')) {
				if (this.isExcalidrawMarkdown(content)) {
					// Remove all comment sections (containing Excalidraw JSON data)
					// Comment sections are typically in ```excalidraw code blocks
					content = content.replace(/```excalidraw[\s\S]*?```/g, '');
					// Also remove any JSON-like sections that might be comments
					content = content.replace(/```json[\s\S]*?```/g, '');
				}
				// Keep only the markdown text content
			}
			// For .excalidraw files, read as plain text (already done above)

			const contentHash = generateContentHash(content);

			return {
				id: generateDocIdFromPath(file.path),
				type: 'excalidraw',
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

