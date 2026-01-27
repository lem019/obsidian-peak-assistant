import type { App } from 'obsidian';
import { TFile } from 'obsidian';
import type { DocumentLoader } from './types';
import type { DocumentType, Document, ResourceSummary } from '@/core/document/types';
import { binaryContentHash, generateContentHash } from '@/core/utils/hash-utils';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import type { Chunk } from '@/service/search/index/types';
import type { ChunkingSettings } from '@/app/settings/types';
import { generateUuidWithoutHyphens, generateDocIdFromPath } from '@/core/utils/id-utils';
import type { AIServiceManager } from '@/service/chat/service-manager';
import { getDefaultDocumentSummary } from './helper/DocumentLoaderHelpers';
import mammoth from 'mammoth';

/**
 * DOCX Document Loader
 * 
 * Uses the `mammoth` library to extract raw text from Microsoft Word (.docx) files.
 * It reads the file as a binary buffer and processes it to generate a text-based cache 
 * suitable for indexing and summarization.
 * 
 * DOCX 文档加载器
 * 
 * 使用 `mammoth` 库从 Microsoft Word (.docx) 文件中提取原始文本。
 * 它将文件读取为二进制 Buffer 并进行处理，生成适用于索引和摘要的文本缓存。
 */
export class DocxDocumentLoader implements DocumentLoader {
	constructor(
		private readonly app: App,
		private readonly aiServiceManager?: AIServiceManager
	) { }

	/**
	 * Returns the type of document handled by this loader.
	 * 返回此加载器处理的文档类型：'docx'。
	 */
	getDocumentType(): DocumentType {
		return 'docx';
	}

	/**
	 * Returns the list of supported file extensions.
	 * 返回支持的文件扩展名列表：['docx', 'doc']。
	 */
	getSupportedExtensions(): string[] {
		return ['docx', 'doc'];
	}

	/**
	 * Reads a DOCX file by its path and converts it into a Document object.
	 * According to the binary nature of DOCX, sourceFileInfo.content remains empty, 
	 * while cacheFileInfo.content holds the extracted text.
	 * 
	 * 根据路径读取 DOCX 文件并将其转换为 Document 对象。
	 * 由于 DOCX 是二进制格式，sourceFileInfo.content 会保持为空，而 cacheFileInfo.content 存储提取出的文本。
	 */
	async readByPath(filePath: string, genCacheContent?: boolean): Promise<Document | null> {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!file || !(file instanceof TFile)) return null;
		if (!this.getSupportedExtensions().includes(file.extension.toLowerCase())) return null;
		return await this.readDocxFile(file, genCacheContent);
	}

	/**
	 * Splits the extracted DOCX text content into smaller chunks.
	 * 将提取出的 DOCX 文本内容拆分为较小的分块。
	 */
	async chunkContent(
		doc: Document,
		settings: ChunkingSettings,
	): Promise<Chunk[]> {
		const content = doc.cacheFileInfo.content;
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
	 * Scans the vault for DOCX files.
	 * 扫描库中的 DOCX 文件。
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
				type: 'docx',
			});
			if (batch.length >= batchSize) {
				yield batch;
				batch = [];
			}
		}
		if (batch.length) yield batch;
	}

	/**
	 * Get summary for a DOCX document.
	 * 获取 DOCX 文档的摘要。
	 */
	async getSummary(
		source: Document | string,
		provider?: string,
		modelId?: string
	): Promise<ResourceSummary> {
		if (!this.aiServiceManager) {
			throw new Error('DocxDocumentLoader requires AIServiceManager to generate summaries');
		}
		if (typeof source === 'string') {
			throw new Error('DocxDocumentLoader.getSummary requires a Document, not a string');
		}
		return getDefaultDocumentSummary(source, this.aiServiceManager, provider, modelId);
	}

	/**
	 * Internal method to perform binary reading and text extraction via mammoth.
	 * 内部方法：执行二进制读取并使用 mammoth 提取文本。
	 */
	private async readDocxFile(file: TFile, genCacheContent?: boolean): Promise<Document | null> {
		try {
			// Read DOCX as binary
			const arrayBuffer = await this.app.vault.readBinary(file);
			const buffer = Buffer.from(arrayBuffer);
			const sourceContentHash = binaryContentHash(arrayBuffer);

			// Parse DOCX directly from buffer using mammoth
			let cacheContent = '';
			if (genCacheContent) {
				const result = await mammoth.extractRawText({ buffer });
				cacheContent = result.value;
			}

			return {
				id: generateDocIdFromPath(file.path),
				type: 'docx',
				sourceFileInfo: {
					path: file.path,
					name: file.name,
					extension: file.extension,
					size: file.stat.size,
					mtime: file.stat.mtime,
					ctime: file.stat.ctime,
					content: '', // DOCX has no text content in source
				},
				cacheFileInfo: {
					path: file.path,
					name: file.name,
					extension: file.extension,
					size: file.stat.size,
					mtime: file.stat.mtime,
					ctime: file.stat.ctime,
					content: cacheContent, // Extracted text content
				},
				metadata: {
					title: file.basename,
					tags: [],
				},
				contentHash: sourceContentHash,
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

