/**
 * @file types.ts
 * @description 文档加载器接口定义。
 * 
 * 定义了所有文档加载器（Loader）必须实现的契约。
 * 加载器负责：
 * 1. 识别并读取特定文件类型。
 * 2. 提取文本内容并生成统一的 Document 模型。
 * 3. 对文档内容进行分块（Chunking）以供向量索引。
 * 4. 生成文档摘要。
 */

import type { DocumentType, Document, ResourceSummary, Summarizable } from '@/core/document/types';
import type { Chunk } from '@/service/search/index/types';
import type { ChunkingSettings } from '@/app/settings/types';

/**
 * Document loader interface for different file types.
 * 
 * Loaders should return core Document model, which can then be converted
 * to Chunk for search indexing.
 * 
 * 文档加载器接口。
 */
export interface DocumentLoader extends Summarizable {
	/**
	 * Get the document type this loader handles.
	 * 获取该加载器处理的文档类型。
	 */
	getDocumentType(): DocumentType;

	/**
	 * Get the file extensions this loader supports.
	 * 获取该加载器支持的文件扩展名列表。
	 */
	getSupportedExtensions(): string[];

	/**
	 * Read a document by its path.
	 * Returns core Document model, or null if file cannot be read.
	 * 
	 * 根据路径读取文档，并转换为 Document 模型。
	 * @param path 文件路径
	 * @param genCacheContent 是否生成缓存内容（如 OCR）
	 */
	readByPath(path: string, genCacheContent?: boolean): Promise<Document | null>;

	/**
	 * Chunk content from a document.
	 * First calls getIndexableContent, then chunks the content using appropriate splitter.
	 * 
	 * @param doc - Document to chunk
	 * @param settings - Chunking settings (chunk size, overlap, etc.)
	 * @returns Array of chunks
	 * 
	 * 对文档内容进行分块。
	 */
	chunkContent(doc: Document, settings: ChunkingSettings): Promise<Chunk[]>;

	/**
	 * Scan documents metadata without loading content.
	 * Returns lightweight metadata: path, mtime, type.
	 * This is used for efficient index change detection.
	 * 
	 * 快速扫描文档元数据。用于增量索引检查。
	 */
	scanDocuments(params?: { limit?: number; batchSize?: number }): AsyncGenerator<Array<{ path: string; mtime: number; type: DocumentType }>>;

	/**
	 * Get summary for a document.
	 * Returns both short and full summaries.
	 * @param source - Document to summarize
	 * @param provider - LLM provider
	 * @param modelId - LLM model ID
	 * @returns Resource summary with short and optional full summary
	 * 
	 * 获取文档摘要。
	 */
	getSummary(
		source: Document | string,
		provider: string,
		modelId: string
	): Promise<ResourceSummary>;
}

