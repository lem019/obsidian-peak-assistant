import type { App } from 'obsidian';
import { TFile } from 'obsidian';
import type { DocumentLoader } from './types';
import type { DocumentType, Document, ResourceSummary } from '@/core/document/types';
import { binaryContentHash } from '@/core/utils/hash-utils';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import type { Chunk } from '@/service/search/index/types';
import type { ChunkingSettings } from '@/app/settings/types';
import { generateUuidWithoutHyphens, generateStableUuid } from '@/core/utils/id-utils';
import type { AIServiceManager } from '@/service/chat/service-manager';
import { getDefaultDocumentSummary } from './helper/DocumentLoaderHelpers';
import * as pdfjsLib from 'pdfjs-dist';
// Import the worker to auto-register it in the bundle
import 'pdfjs-dist/build/pdf.worker.mjs';

/**
 * Default options for PDF.js getDocument calls in bundled environment.
 */
const PDF_JS_OPTIONS = {
	// Standard font data URL for PDF.js
	standardFontDataUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.394/standard_fonts/',
	// Character map URLs for proper text extraction
	cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.394/cmaps/',
	cMapPacked: true,
};

/**
 * PDF Document Loader
 * 
 * Uses the `pdfjs-dist` library to parse PDF files. 
 * It extracts text from all pages of the document to create a searchable text cache.
 * The loader handles binary reading and provides necessary configuration for fonts 
 * and character maps required by PDF.js.
 * 
 * PDF 文档加载器
 * 
 * 使用 `pdfjs-dist` 库解析 PDF 文件。
 * 它从文档的所有页面提取文本，以创建可搜索的文本缓存。
 * 该加载器处理二进制读取，并为 PDF.js 提供所需的字体和字符映射配置。
 */
export class PdfDocumentLoader implements DocumentLoader {
	constructor(
		private readonly app: App,
		private readonly aiServiceManager?: AIServiceManager
	) { }

	/**
	 * Returns the type of document handled by this loader.
	 * 返回此加载器处理的文档类型：'pdf'。
	 */
	getDocumentType(): DocumentType {
		return 'pdf';
	}

	/**
	 * Returns the list of supported file extensions.
	 * 返回支持的文件扩展名列表。
	 */
	getSupportedExtensions(): string[] {
		return ['pdf'];
	}

	/**
	 * Reads a PDF file and converts it into a Document object.
	 * According to the binary nature of PDF, extracted text is stored in cacheFileInfo.content.
	 * 
	 * 读取 PDF 文件并将其转换为 Document 对象。
	 * 由于 PDF 是二进制格式，提取出的文本存储在 cacheFileInfo.content 中。
	 */
	async readByPath(filePath: string, genCacheContent?: boolean): Promise<Document | null> {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!file || !(file instanceof TFile)) return null;
		if (!this.getSupportedExtensions().includes(file.extension.toLowerCase())) return null;
		return await this.readPdfFile(file, genCacheContent);
	}

	/**
	 * Splits the extracted PDF text into smaller chunks.
	 * 将提取出的 PDF 文本拆分为较小的分块。
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
	 * Scans the vault for PDF files.
	 * 扫描库中的 PDF 文件。
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
				type: 'pdf',
			});
			if (batch.length >= batchSize) {
				yield batch;
				batch = [];
			}
		}
		if (batch.length) yield batch;
	}

	/**
	 * Get summary for a PDF document.
	 * 获取 PDF 文档的摘要。
	 */
	async getSummary(
		source: Document | string,
		provider?: string,
		modelId?: string
	): Promise<ResourceSummary> {
		if (!this.aiServiceManager) {
			throw new Error('PdfDocumentLoader requires AIServiceManager to generate summaries');
		}
		if (typeof source === 'string') {
			throw new Error('PdfDocumentLoader.getSummary requires a Document, not a string');
		}
		return getDefaultDocumentSummary(source, this.aiServiceManager, provider, modelId);
	}

	/**
	 * Internal method to perform binary reading and text extraction via PDF.js.
	 * 内部方法：执行二进制读取，并使用 PDF.js 提取文本。
	 */
	private async readPdfFile(file: TFile, genCacheContent?: boolean): Promise<Document | null> {
		try {
			// Read PDF as binary
			const arrayBuffer = await this.app.vault.readBinary(file);
			const sourceContentHash = binaryContentHash(arrayBuffer);

			let cacheContent = '';
			if (genCacheContent) {
				// Parse PDF using pdfjs-dist directly from buffer
				const uint8Array = new Uint8Array(arrayBuffer);
				const loadingOptions = {
					data: uint8Array,
					// Use configured options for fonts and CMaps (important for international characters)
					...PDF_JS_OPTIONS,
				};
				const loadingTask = pdfjsLib.getDocument(loadingOptions);
				const pdfDocument = await loadingTask.promise;

				// Extract text from all pages
				const pageTexts: string[] = [];
				for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
					const page = await pdfDocument.getPage(pageNum);
					const textContent = await page.getTextContent();
					const pageText = textContent.items
						.map((item: any) => item.str)
						.join(' ');
					pageTexts.push(pageText);
				}

				// Combine all page texts with double newlines
				cacheContent = pageTexts.join('\n\n');
			}

			return {
				id: generateStableUuid(file.path),
				type: 'pdf',
				sourceFileInfo: {
					path: file.path,
					name: file.name,
					extension: file.extension,
					size: file.stat.size,
					mtime: file.stat.mtime,
					ctime: file.stat.ctime,
					content: '', // PDF has no text content in source
				},
				cacheFileInfo: {
					path: file.path,
					name: file.name,
					extension: file.extension,
					size: file.stat.size,
					mtime: file.stat.mtime,
					ctime: file.stat.ctime,
					content: cacheContent, // Extracted text content from PDF pages
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
		} catch (error) {
			console.error('[PdfDocumentLoader] error reading PDF file:', file.path, error);
			return null;
		}
	}
}

