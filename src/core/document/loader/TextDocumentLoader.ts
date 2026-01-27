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
 * Plain Text Document Loader
 * 
 * Used for standard text files (.txt). It utilizes the LangChain `RecursiveCharacterTextSplitter` 
 * to handle chunking based on user-defined sizes and overlaps.
 * 
 * 纯文本文档加载器
 * 
 * 用于处理标准的文本文件（.txt）。它利用 LangChain 的 `RecursiveCharacterTextSplitter` 
 * 根据用户定义的尺寸和重叠度进行分块。
 */
export class TextDocumentLoader implements DocumentLoader {
	constructor(
		private readonly app: App,
		private readonly aiServiceManager?: AIServiceManager
	) {}

	/**
	 * Returns the type of document handled: 'txt'.
	 * 返回处理的文档类型：'txt'。
	 */
	getDocumentType(): DocumentType {
		return 'txt';
	}

	/**
	 * Returns supported file extensions.
	 * 返回支持的文件扩展名。
	 */
	getSupportedExtensions(): string[] {
		return ['txt'];
	}

	/**
	 * Reads a text file and converts it into a Document object.
	 * 读取文本文件并将其转换为 Document 对象。
	 */
	async readByPath(path: string): Promise<Document | null> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!file || !(file instanceof TFile)) return null;
		if (!this.getSupportedExtensions().includes(file.extension.toLowerCase())) return null;
		return await this.readTextFile(file);
	}

	/**
	 * Splits the text content into chunks using RecursiveCharacterTextSplitter.
	 * 使用 RecursiveCharacterTextSplitter 将文本内容拆分为分块。
	 */
	async chunkContent(
		doc: Document,
		settings: ChunkingSettings,
	): Promise<Chunk[]> {
		const content = doc.sourceFileInfo.content;
		const minSize = settings.minDocumentSizeForChunking;

		// If the document is small enough, keep it as a single chunk
		// 如果文档足够小，则将其保留为单个分块
		if (content.length <= minSize) {
			return [{
				docId: doc.id,
				content: content,
			}];
		}

		// Configure the recursive splitter with size and overlap
		// 配置带有尺寸和重叠度的递归拆分器
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
	 * Scans the vault for .txt files.
	 * 扫描库中的 .txt 文件。
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
				type: 'txt',
			});
			if (batch.length >= batchSize) {
				yield batch;
				batch = [];
			}
		}
		if (batch.length) yield batch;
	}

	/**
	 * Generates a summary for the text document using an AI service.
	 * 使用 AI 服务为文本文档生成摘要。
	 */
	async getSummary(
		source: Document | string,
		provider?: string,
		modelId?: string
	): Promise<ResourceSummary> {
		if (!this.aiServiceManager) {
			throw new Error('TextDocumentLoader requires AIServiceManager to generate summaries');
		}
		if (typeof source === 'string') {
			throw new Error('TextDocumentLoader.getSummary requires a Document, not a string');
		}
		return getDefaultDocumentSummary(source, this.aiServiceManager, provider, modelId);
	}

	/**
	 * Helper method to read the file content from the vault cache.
	 * 从库缓存中读取文件内容的辅助方法。
	 */
	private async readTextFile(file: TFile): Promise<Document | null> {
		try {
			const content = await this.app.vault.cachedRead(file);
			const contentHash = generateContentHash(content);

			return {
				id: generateDocIdFromPath(file.path),
				type: 'txt',
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
			return null;
		}
	}
}

