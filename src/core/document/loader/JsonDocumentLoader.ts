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
 * JSON Document Loader
 * 
 * Handles reading and chunking of JSON files. 
 * If the JSON file contains an array, the loader treats each element as an individual chunk. 
 * Otherwise, it treat the entire structure as a single piece of content and applies standard 
 * size-based splitting.
 * 
 * JSON 文档加载器
 * 
 * 处理 JSON 文件的读取和分块。
 * 如果 JSON 文件包含一个数组，加载器会将每个元素视为独立的分块。
 * 否则，它会将整个结构视为一段内容，并应用标准的大小拆分策略。
 */
export class JsonDocumentLoader implements DocumentLoader {
	constructor(
		private readonly app: App,
		private readonly aiServiceManager?: AIServiceManager
	) {}

	/**
	 * Returns the type of document handled by this loader.
	 * 返回此加载器处理的文档类型：'json'。
	 */
	getDocumentType(): DocumentType {
		return 'json';
	}

	/**
	 * Returns the list of supported file extensions.
	 * 返回支持的文件扩展名列表。
	 */
	getSupportedExtensions(): string[] {
		return ['json'];
	}

	/**
	 * Reads a JSON file by its path and converts it into a Document object.
	 * 根据路径读取 JSON 文件并将其转换为 Document 对象。
	 */
	async readByPath(path: string): Promise<Document | null> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!file || !(file instanceof TFile)) return null;
		if (!this.getSupportedExtensions().includes(file.extension.toLowerCase())) return null;
		return await this.readJsonFile(file);
	}

	/**
	 * Splits the JSON content into smaller chunks.
	 * Logical splitting: if root is an array, split by items.
	 * 
	 * 将 JSON 内容拆分为较小的分块。
	 * 逻辑拆分：如果根元素是数组，则按条目拆分。
	 */
	async chunkContent(
		doc: Document,
		settings: ChunkingSettings,
	): Promise<Chunk[]> {
		const content = doc.sourceFileInfo.content;
		const minSize = settings.minDocumentSizeForChunking;

		try {
			const parsed = JSON.parse(content);
			
			// If it's an array, each item becomes a chunk (Logical splitting)
			if (Array.isArray(parsed)) {
				const chunks: Chunk[] = [];
				for (let i = 0; i < parsed.length; i++) {
					const itemContent = JSON.stringify(parsed[i], null, 2);
					chunks.push({
						docId: doc.id,
						content: itemContent,
						chunkId: generateUuidWithoutHyphens(),
						chunkIndex: i,
					});
				}
				return chunks;
			}

			// Otherwise, treat as a single structure and split based on string length constraints
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
		} catch {
			// Fallback: If JSON parsing fails (invalid JSON), treat as plain text for splitting
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
	}

	/**
	 * Scans the vault for JSON files.
	 * 扫描库中的 JSON 文件。
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
				type: 'json',
			});
			if (batch.length >= batchSize) {
				yield batch;
				batch = [];
			}
		}
		if (batch.length) yield batch;
	}

	/**
	 * Get summary for a JSON document.
	 * 获取 JSON 文档的摘要。
	 */
	async getSummary(
		source: Document | string,
		provider?: string,
		modelId?: string
	): Promise<ResourceSummary> {
		if (!this.aiServiceManager) {
			throw new Error('JsonDocumentLoader requires AIServiceManager to generate summaries');
		}
		if (typeof source === 'string') {
			throw new Error('JsonDocumentLoader.getSummary requires a Document, not a string');
		}
		return getDefaultDocumentSummary(source, this.aiServiceManager, provider, modelId);
	}

	/**
	 * Internal method to read file content via Obsidian's cachedRead.
	 * 内部方法：通过 Obsidian 的 cachedRead 读取文件内容。
	 */
	private async readJsonFile(file: TFile): Promise<Document | null> {
		try {
			const content = await this.app.vault.cachedRead(file);
			const contentHash = generateContentHash(content);

			return {
				id: generateDocIdFromPath(file.path),
				type: 'json',
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

