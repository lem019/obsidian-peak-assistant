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
 * Table Document Loader
 * 
 * Specifically designed to handle tabular data like CSV and potentially XLSX files. 
 * The chunking strategy for tables is row-based: it attempts to keep each row as a single unit 
 * of information, splitting it further only if it exceeds the maximum chunk size.
 * 
 * 表格文档加载器
 * 
 * 专门设计用于处理类似的 CSV（以及潜在的 XLSX）表格数据。
 * 表格的分块策略是基于行的：它尝试将每一行保持为一个独立的信息单元，只有在超过最大分块大小时才会进一步拆分。
 */
export class TableDocumentLoader implements DocumentLoader {
	constructor(
		private readonly app: App,
		private readonly aiServiceManager?: AIServiceManager
	) {}

	/**
	 * Returns the type of document handled by this loader.
	 * 返回此加载器处理的文档类型：'csv'。
	 */
	getDocumentType(): DocumentType {
		return 'csv';
	}

	/**
	 * Returns the list of supported file extensions.
	 * 返回支持的文件扩展名列表：['csv', 'xlsx']。
	 */
	getSupportedExtensions(): string[] {
		return ['csv', 'xlsx'];
	}

	/**
	 * Reads a table file by its path and converts it into a Document object.
	 * 根据路径读取表格文件并将其转换为 Document 对象。
	 */
	async readByPath(path: string): Promise<Document | null> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!file || !(file instanceof TFile)) return null;
		if (!this.getSupportedExtensions().includes(file.extension.toLowerCase())) return null;
		return await this.readTableFile(file);
	}

	/**
	 * Splits the table content into chunks, where each row is ideally one chunk.
	 * Rows exceeding maxChunkSize are split with overlap.
	 * 
	 * 将表格内容拆分为分块，理想情况下每一行就是一个分块。
	 * 超过 maxChunkSize 的行将带重叠地拆分。
	 */
	async chunkContent(
		doc: Document,
		settings: ChunkingSettings,
	): Promise<Chunk[]> {
		const content = doc.sourceFileInfo.content;
		// Split by newline to get individual rows
		const rows = content.split('\n').filter(row => row.trim().length > 0);
		const maxChunkSize = settings.maxChunkSize;
		const overlap = settings.chunkOverlap;

		const chunks: Chunk[] = [];
		let chunkIndex = 0;

		for (const row of rows) {
			if (row.length <= maxChunkSize) {
				// Row fits into a single chunk
				chunks.push({
					docId: doc.id,
					content: row,
					chunkId: generateUuidWithoutHyphens(),
					chunkIndex: chunkIndex++,
				});
			} else {
				// Split long row into multiple chunks with overlap to preserve context
				let start = 0;
				while (start < row.length) {
					const end = Math.min(start + maxChunkSize, row.length);
					const chunkContent = row.substring(start, end);
					chunks.push({
						docId: doc.id,
						content: chunkContent,
						chunkId: generateUuidWithoutHyphens(),
						chunkIndex: chunkIndex++,
					});
					start = end - overlap;
					if (start >= row.length) break;
				}
			}
		}

		return chunks;
	}

	/**
	 * Scans the vault for supported table files.
	 * 扫描库中支持的表格文件。
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
				type: 'csv',
			});
			if (batch.length >= batchSize) {
				yield batch;
				batch = [];
			}
		}
		if (batch.length) yield batch;
	}

	/**
	 * Get summary for a table document.
	 * 获取表格文档的摘要。
	 */
	async getSummary(
		source: Document | string,
		provider?: string,
		modelId?: string
	): Promise<ResourceSummary> {
		if (!this.aiServiceManager) {
			throw new Error('TableDocumentLoader requires AIServiceManager to generate summaries');
		}
		if (typeof source === 'string') {
			throw new Error('TableDocumentLoader.getSummary requires a Document, not a string');
		}
		return getDefaultDocumentSummary(source, this.aiServiceManager, provider, modelId);
	}

	/**
	 * Internal method to read file content. CSV is read as text. 
	 * XLSX parsing is a placeholder for future implementation.
	 * 
	 * 内部方法：读取文件内容。CSV 按文本读取。XLSX 解析是未来实现的占位符。
	 */
	private async readTableFile(file: TFile): Promise<Document | null> {
		try {
			let content = '';
			const ext = file.extension.toLowerCase();
			const supportedExts = this.getSupportedExtensions();

			if (ext === 'csv') {
				content = await this.app.vault.cachedRead(file);
			} else if (supportedExts.includes('xlsx') && ext === 'xlsx') {
				// For XLSX, we need to parse the Excel file
				// TODO: Parse XLSX using a library like xlsx or exceljs
				// Each row should become a chunk, with truncation and overlap for long rows
				// For now, return null to indicate we can't handle it yet
				return null;
			}

			const contentHash = generateContentHash(content);

			return {
				id: generateDocIdFromPath(file.path),
				type: 'csv',
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

