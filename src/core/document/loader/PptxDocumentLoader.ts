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
import officeParser from 'officeparser';

/**
 * PPTX Document Loader
 * 
 * Uses the `officeparser` library to extract text content from Microsoft PowerPoint (.pptx) files.
 * It reads the PPTX as binary data and generates a text-based version for indexing.
 * 
 * PPTX 文档加载器
 * 
 * 使用 `officeparser` 库从 Microsoft PowerPoint (.pptx) 文件中提取文本内容。
 * 它将 PPTX 读取为二进制数据，并生成文本版本以供索引使用。
 */
export class PptxDocumentLoader implements DocumentLoader {
	constructor(
		private readonly app: App,
		private readonly aiServiceManager?: AIServiceManager
	) {}

	/**
	 * Returns the type of document handled by this loader.
	 * 返回此加载器处理的文档类型：'pptx'。
	 */
	getDocumentType(): DocumentType {
		return 'pptx';
	}

	/**
	 * Returns the list of supported file extensions.
	 * 返回支持的文件扩展名列表。
	 */
	getSupportedExtensions(): string[] {
		return ['pptx'];
	}

	/**
	 * Reads a PPTX file by its path and converts it into a Document object.
	 * 根据路径读取 PPTX 文件并将其转换为 Document 对象。
	 */
	async readByPath(filePath: string, genCacheContent?: boolean): Promise<Document | null> {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!file || !(file instanceof TFile)) return null;
		if (!this.getSupportedExtensions().includes(file.extension.toLowerCase())) return null;
		return await this.readPptxFile(file, genCacheContent);
	}

	/**
	 * Splits the extracted PPTX text into smaller chunks.
	 * 将提取出的 PPTX 文本拆分为较小的分块。
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
	 * Scans the vault for PPTX files.
	 * 扫描库中的 PPTX 文件。
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
				type: 'pptx',
			});
			if (batch.length >= batchSize) {
				yield batch;
				batch = [];
			}
		}
		if (batch.length) yield batch;
	}

	/**
	 * Get summary for a PPTX document.
	 * 获取 PPTX 文档的摘要。
	 */
	async getSummary(
		source: Document | string,
		provider?: string,
		modelId?: string
	): Promise<ResourceSummary> {
		if (!this.aiServiceManager) {
			throw new Error('PptxDocumentLoader requires AIServiceManager to generate summaries');
		}
		if (typeof source === 'string') {
			throw new Error('PptxDocumentLoader.getSummary requires a Document, not a string');
		}
		return getDefaultDocumentSummary(source, this.aiServiceManager, provider, modelId);
	}

	/**
	 * Internal method to perform binary reading and text extraction via officeparser.
	 * 内部方法：执行二进制读取并通过 officeparser 提取文本。
	 */
	private async readPptxFile(file: TFile, genCacheContent?: boolean): Promise<Document | null> {
		try {
			// Read PPTX as binary
			const arrayBuffer = await this.app.vault.readBinary(file);
			const buffer = Buffer.from(arrayBuffer);
			const sourceContentHash = binaryContentHash(arrayBuffer);
			
			// Parse PPTX directly from buffer using officeparser
			let cacheContent = '';
			if (genCacheContent) {
				const content = await officeParser.parseOfficeAsync(buffer);
				cacheContent = content;
			}

			return {
				id: generateDocIdFromPath(file.path),
				type: 'pptx',
				sourceFileInfo: {
					path: file.path,
					name: file.name,
					extension: file.extension,
					size: file.stat.size,
					mtime: file.stat.mtime,
					ctime: file.stat.ctime,
					content: '', // PPTX has no text content in source
				},
				cacheFileInfo: {
					path: file.path,
					name: file.name,
					extension: file.extension,
					size: file.stat.size,
					mtime: file.stat.mtime,
					ctime: file.stat.ctime,
					content: cacheContent, // Extracted text content from PPTX slides
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

