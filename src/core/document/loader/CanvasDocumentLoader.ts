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
 * Canvas Document Loader
 * 
 * Responsible for parsing Obsidian .canvas files. It extracts text content from canvas nodes 
 * (both text nodes and file labels) and edge labels to create a searchable document.
 * 
 * Canvas 文档加载器
 * 
 * 负责解析 Obsidian 的 .canvas 文件。它从画布节点（包括文本节点和文件标签）以及边标签中提取文本内容，
 * 从而创建一个可搜索的文档对象。
 */
export class CanvasDocumentLoader implements DocumentLoader {
	constructor(
		private readonly app: App,
		private readonly aiServiceManager?: AIServiceManager
	) {}

	/**
	 * Returns the type of document handled by this loader.
	 * 返回此加载器处理的文档类型：'canvas'。
	 */
	getDocumentType(): DocumentType {
		return 'canvas';
	}

	/**
	 * Returns the list of supported file extensions.
	 * 返回支持的文件扩展名列表：['canvas']。
	 */
	getSupportedExtensions(): string[] {
		return ['canvas'];
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
	 * Reads a canvas file by its path and converts it into a Document object.
	 * 根据路径读取 Canvas 文件并将其转换为 Document 对象。
	 */
	async readByPath(filePath: string, genCacheContent?: boolean): Promise<Document | null> {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!file || !(file instanceof TFile)) return null;
		if (!this.isSupportedPath(filePath)) return null;
		return await this.readCanvasFile(file, genCacheContent);
	}

	/**
	 * Splits the canvas content into smaller chunks for indexing and LLM retrieval.
	 * 将 Canvas 内容拆分为较小的分块，以便进行索引和 LLM 检索。
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
	 * Scans the vault for canvas files and yields them in batches.
	 * 扫描库中的 Canvas 文件，并按批次返回文件元数据。
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
				type: 'canvas',
			});
			if (batch.length >= batchSize) {
				yield batch;
				batch = [];
			}
		}
		if (batch.length) yield batch;
	}

	/**
	 * Get summary for a Canvas document. Uses the AI service to generate a summary.
	 * 获取 Canvas 文档的摘要。使用 AI 服务生成摘要。
	 */
	async getSummary(
		source: Document | string,
		provider?: string,
		modelId?: string
	): Promise<ResourceSummary> {
		if (!this.aiServiceManager) {
			throw new Error('CanvasDocumentLoader requires AIServiceManager to generate summaries');
		}
		if (typeof source === 'string') {
			throw new Error('CanvasDocumentLoader.getSummary requires a Document, not a string');
		}
		return getDefaultDocumentSummary(source, this.aiServiceManager, provider, modelId);
	}

	/**
	 * Internal method to parse the canvas JSON structure.
	 * 内部方法：解析 Canvas 的 JSON 结构，提取文本信息。
	 */
	private async readCanvasFile(file: TFile, genCacheContent?: boolean): Promise<Document | null> {
		try {
			const fileContents = await this.app.vault.cachedRead(file);
			const canvas: CanvasData = fileContents ? JSON.parse(fileContents) : {};
			
			const texts: string[] = [];
			
			// Extract text from nodes (Nodes can be text bits or links to files)
			for (const node of canvas.nodes ?? []) {
				if (node.type === 'text' && node.text) {
					texts.push(node.text);
				} else if (node.type === 'file' && node.file) {
					texts.push(node.file);
				}
			}
			
			// Extract labels from edges (Connections between nodes)
			for (const edge of (canvas.edges ?? []).filter(e => !!e.label)) {
				texts.push(edge.label!);
			}
			
			const content = texts.join('\r\n');
			const contentHash = generateContentHash(content);

			return {
				id: generateDocIdFromPath(file.path),
				type: 'canvas',
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

/**
 * Canvas data structure mapping the JSON format of Obsidian .canvas files.
 * 映射 Obsidian .canvas 文件 JSON 格式的数据结构。
 */
interface CanvasData {
	nodes?: CanvasNode[];
	edges?: CanvasEdge[];
}

interface CanvasNode {
	type: string;
	text?: string;
	file?: string;
}

interface CanvasEdge {
	label?: string;
}

