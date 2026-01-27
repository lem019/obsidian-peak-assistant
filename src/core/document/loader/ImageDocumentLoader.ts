import type { App } from 'obsidian';
import { TFile } from 'obsidian';
import type { DocumentLoader } from './types';
import type { DocumentType, Document, ResourceSummary } from '@/core/document/types';
import { binaryContentHash } from '@/core/utils/hash-utils';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import type { Chunk } from '@/service/search/index/types';
import type { ChunkingSettings, SearchSettings } from '@/app/settings/types';
import { generateUuidWithoutHyphens, generateStableUuid } from '@/core/utils/id-utils';
import type { AIServiceManager } from '@/service/chat/service-manager';
import { PromptId } from '@/service/prompt/PromptId';

/**
 * Image Document Loader
 * 
 * Extracts information from images using AI Vision capabilities. 
 * Instead of just indexing the file name, this loader uses an AI service to "read" the image, 
 * generating a semantic text description of its contents. This description is stored in 
 * cacheFileInfo.content and used for search and retrieval.
 * 
 * 图像文档加载器
 * 
 * 使用 AI 视觉能力从图像中提取信息。
 * 该加载器不仅仅索引文件名，还使用 AI 服务来“阅读”图像，生成其内容的语义文本描述。
 * 该描述存储在 cacheFileInfo.content 中，用于搜索和检索。
 */
export class ImageDocumentLoader implements DocumentLoader {
	constructor(
		private readonly app: App,
		private readonly settings: SearchSettings,
		private readonly aiServiceManager?: AIServiceManager
	) { }

	/**
	 * Returns the type of document handled by this loader.
	 * 返回此加载器处理的文档类型：'image'。
	 */
	getDocumentType(): DocumentType {
		return 'image';
	}

	/**
	 * Returns the list of supported image file extensions.
	 * 返回支持的图像文件扩展名列表。
	 */
	getSupportedExtensions(): string[] {
		return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'];
	}

	/**
	 * Reads an image file and converts it into a Document object.
	 * Initially, it doesn't contain text unless genCacheContent is true, 
	 * which triggers AI analysis.
	 * 
	 * 读取图像文件并将其转换为 Document 对象。
	 * 最初不包含文本，除非 genCacheContent 为 true（这会触发 AI 分析）。
	 */
	async readByPath(filePath: string, genCacheContent?: boolean): Promise<Document | null> {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!file || !(file instanceof TFile)) return null;
		const ext = file.extension.toLowerCase();
		if (!this.getSupportedExtensions().includes(ext)) return null;
		return await this.readImageFile(file, genCacheContent);
	}

	/**
	 * Splits the AI-generated image description into smaller chunks.
	 * 将 AI 生成的图像描述拆分为较小的分块。
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
	 * Scans the vault for supported image files.
	 * 扫描库中支持的图像文件。
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
				type: 'image',
			});
			if (batch.length >= batchSize) {
				yield batch;
				batch = [];
			}
		}
		if (batch.length) yield batch;
	}

	/**
	 * Generates a summary for the image based on its AI-generated description.
	 * 根据 AI 生成的描述为图像生成摘要。
	 */
	async getSummary(
		source: Document | string,
		provider?: string,
		modelId?: string
	): Promise<ResourceSummary> {
		if (!this.aiServiceManager) {
			throw new Error('ImageDocumentLoader requires AIServiceManager to generate summaries');
		}
		if (typeof source === 'string') {
			throw new Error('ImageDocumentLoader.getSummary requires a Document, not a string');
		}
		const doc = source;
		const content = doc.cacheFileInfo.content;
		const title = doc.metadata.title || doc.sourceFileInfo.name;
		const path = doc.sourceFileInfo.path;

		const shortSummary = await this.aiServiceManager.chatWithPrompt(
			PromptId.ImageSummary,
			{ content, title, path },
			provider,
			modelId
		);

		return { shortSummary, fullSummary: shortSummary };
	}

	/**
	 * Internal method to read the binary image and optionally trigger AI analysis.
	 * 内部方法：读取二进制图像，并（可选）触发 AI 分析。
	 */
	private async readImageFile(file: TFile, genCacheContent?: boolean): Promise<Document | null> {
		try {
			if (genCacheContent) {
				console.debug('[ImageDocumentLoader] reading image file:', file.path, 'genCacheContent:', genCacheContent);
			}
			const realContent = await this.app.vault.readBinary(file);
			const realContentHash = binaryContentHash(realContent);

			const cacheContent = genCacheContent ? await this.generateImageDescription(file) : '';

			return {
				id: generateStableUuid(file.path),
				type: 'image',
				sourceFileInfo: {
					path: file.path,
					name: file.name,
					extension: file.extension,
					size: file.stat.size,
					mtime: file.stat.mtime,
					ctime: file.stat.ctime,
					content: '', // Image has no text content in source
				},
				cacheFileInfo: {
					path: file.path,
					name: file.name,
					extension: file.extension,
					size: file.stat.size,
					mtime: file.stat.mtime,
					ctime: file.stat.ctime,
					content: cacheContent, // AI generated description of the image
				},
				metadata: {
					title: file.basename,
					tags: [],
				},
				contentHash: realContentHash,
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

	/**
	 * Generate image description using AI vision service or return a placeholder if unavailable.
	 * 使用 AI 视觉服务生成图像描述，如果不可用则返回占位符。
	 */
	private async generateImageDescription(file: TFile): Promise<string> {
		if (!this.aiServiceManager) {
			// No AI service available, use placeholder
			return `[Image: ${file.basename}]`;
		}

		try {
			// Read image as binary to be passed to the AI service
			const arrayBuffer = await this.app.vault.readBinary(file);
			const mimeType = this.getMimeType(file.extension);

			const response = await this.aiServiceManager.chatWithPrompt(
				PromptId.ImageDescription,
				null, // No template variables needed for this prompt
				undefined,
				undefined,
				[
					{
						type: 'image',
						data: arrayBuffer,
						mediaType: mimeType,
					},
				]
			);
			console.debug('[ImageDocumentLoader] AI response for image description:', response);
			return response || `[Image: ${file.basename}]`;
		} catch (error) {
			console.error('Error generating image description with AI:', error);
			// Fallback to filename placeholder on failure
			return `[Image: ${file.basename}]`;
		}
	}

	/**
	 * Maps file extensions to standard MIME types.
	 * 将文件扩展名映射为标准的 MIME 类型。
	 */
	private getMimeType(extension: string): string {
		const ext = extension.toLowerCase();
		const mimeTypes: Record<string, string> = {
			'jpg': 'image/jpeg',
			'jpeg': 'image/jpeg',
			'png': 'image/png',
			'gif': 'image/gif',
			'webp': 'image/webp',
			'bmp': 'image/bmp',
			'svg': 'image/svg+xml',
		};
		return mimeTypes[ext] || 'image/jpeg';
	}
}

