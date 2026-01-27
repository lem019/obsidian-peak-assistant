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
 * Dataloom Document Loader
 * 
 * Specifically handles .loom or .dataloom files from the DataLoom plugin.
 * It recursively extracts all 'content' fields from the JSON structure of the file,
 * effectively flattening the table/database data into a searchable text format.
 * 
 * Dataloom 文档加载器
 * 
 * 专门处理来自 DataLoom 插件的 .loom 或 .dataloom 文件。
 * 它递归地从文件的 JSON 结构中提取所有 'content' 字段，将表格/数据库数据展平为可搜索的文本格式。
 */
export class DataloomDocumentLoader implements DocumentLoader {
	constructor(
		private readonly app: App,
		private readonly aiServiceManager?: AIServiceManager
	) {}

	/**
	 * Returns the type of document handled by this loader.
	 * 返回此加载器处理的文档类型：'dataloom'。
	 */
	getDocumentType(): DocumentType {
		return 'dataloom';
	}

	/**
	 * Returns the list of supported file extensions.
	 * 返回支持的文件扩展名列表：['loom', 'dataloom']。
	 */
	getSupportedExtensions(): string[] {
		return ['loom', 'dataloom'];
	}

	/**
	 * Check if a file path matches any of the supported extensions.
	 * 检查给定文件路径是否匹配支持的扩展名。
	 */
	private isSupportedPath(path: string): boolean {
		const supportedExts = this.getSupportedExtensions();
		return supportedExts.some(ext => path.endsWith('.' + ext));
	}

	/**
	 * Reads a Dataloom file by its path and converts it into a Document object.
	 * 根据路径读取 Dataloom 文件并将其转换为 Document 对象。
	 */
	async readByPath(filePath: string): Promise<Document | null> {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!file || !(file instanceof TFile)) return null;
		if (!this.isSupportedPath(filePath)) return null;
		return await this.readDataloomFile(file);
	}

	/**
	 * Splits the Dataloom content into smaller chunks for indexing and LLM retrieval.
	 * 将 Dataloom 内容拆分为较小的分块，以便进行索引和 LLM 检索。
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
	 * Scans the vault for Dataloom files and yields them in batches.
	 * 扫描库中的 Dataloom 文件，并按批次返回文件元数据。
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
				type: 'dataloom',
			});
			if (batch.length >= batchSize) {
				yield batch;
				batch = [];
			}
		}
		if (batch.length) yield batch;
	}

	/**
	 * Get summary for a Dataloom document. Uses the AI service to generate a summary.
	 * 获取 Dataloom 文档的摘要。使用 AI 服务生成摘要。
	 */
	async getSummary(
		source: Document | string,
		provider?: string,
		modelId?: string
	): Promise<ResourceSummary> {
		if (!this.aiServiceManager) {
			throw new Error('DataloomDocumentLoader requires AIServiceManager to generate summaries');
		}
		if (typeof source === 'string') {
			throw new Error('DataloomDocumentLoader.getSummary requires a Document, not a string');
		}
		return getDefaultDocumentSummary(source, this.aiServiceManager, provider, modelId);
	}

	/**
	 * Internal method to parse the Dataloom JSON structure.
	 * 内部方法：解析 Dataloom 的 JSON 结构，并递归提取所有 'content' 字段。
	 */
	private async readDataloomFile(file: TFile): Promise<Document | null> {
		try {
			const data = JSON.parse(await this.app.vault.cachedRead(file));
			
			// Recursively extract all 'content' fields
			const texts: string[] = [];
			const iterate = (obj: any) => {
				for (const key in obj) {
					if (typeof obj[key] === 'object' && obj[key] !== null) {
						iterate(obj[key]);
					} else if (key === 'content') {
						texts.push(obj[key]);
					}
				}
			};
			iterate(data);
			
			const content = texts.join('\r\n');
			const contentHash = generateContentHash(content);

			return {
				id: generateDocIdFromPath(file.path),
				type: 'dataloom',
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
		} catch (e) {
			console.error('Error while parsing Dataloom file', file.path, e);
			return null;
		}
	}
}

