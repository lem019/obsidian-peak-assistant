/**
 * @file types.ts
 * @description 统一文档模型定义。
 * 
 * 这是整个插件的核心模型抽象，支持：
 * - 多种文档类型（Markdown, PDF, 图片, Office 等）
 * - 丰富的元数据（哈希值、摘要、引用关系、标签）
 * - 针对高开销操作（OCR, PDF 解析）的缓存策略
 * - 统一的内容提取与处理接口
 * 
 * 所有文档相关的操作（索引、搜索、聊天）都应基于此模型。
 */

/**
 * Unified Document model for the entire plugin.
 * 
 * This is the core document abstraction that supports:
 * - Multiple document types (markdown, pdf, image, text files, office, etc.)
 * - Rich metadata (hash, summary, references, tags)
 * - Caching strategies for expensive operations
 * - Content extraction and processing
 * 
 * All document operations (indexing, search, chat) should use this model.
 * 
 * Design principles:
 * - Single source of truth: one Document model for all use cases
 * - Separation of concerns: Document (core) vs Chunk (search-specific)
 * - Extensibility: easy to add new document types and metadata
 * - Performance: caching for expensive operations (PDF, Image, Canvas)
 */

/**
 * All document type values as a constant array.
 * This is the source of truth for all document types.
 * 
 * Supports various file types:
 * - Text files: markdown, csv, json, html, xml, txt
 * - Binary files: pdf, image (jpg, png, etc.), office (docx, xlsx, pptx)
 * - Plugin data: conv, project, prompt
 * - Obsidian data: excalidraw, canvas, dataloom
 * - Special: folder, url
 * 
 * 文档类型常量数组。所有受支持的文件格式都在这里定义。
 */
export const DOCUMENT_TYPES = [
	// Text files (文本文件)
	'markdown',
	'txt',
	'csv',
	'json',
	'html',
	'xml',
	// Binary files (二进制文件)
	'pdf',
	'image',
	'docx',
	'xlsx',
	'pptx',
	// Plugin data files (插件自有数据，当前注释掉)
	// 'conv',
	// 'project',
	// 'prompt',
	// Obsidian data files (Obsidain 特有数据格式)
	'excalidraw',
	'canvas',
	'dataloom',
	// Special types (特殊类型)
	'folder',
	'url',
	// Unknown/unsupported (未知或不支持的类型，仅索引文件名和基本元数据)
	'unknown',
] as const;

/**
 * Document type for indexing and document loaders.
 * Derived from DOCUMENT_TYPES constant array.
 */
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/**
 * Document source information.
 * 
 * will be readed after documentpo is created. and these data will be readed from Document sourceFile or cacheFile when needed.
 * 
 * 文档文件信息接口。包含文件的物理属性和提取后的文本内容。
 */
export interface DocumentFileInfo {
	/** Original file path in vault. (库中原始文件路径) */
	path: string;
	/** File name. (文件名) */
	name: string;
	/** File extension. (文件扩展名) */
	extension: string;
	/** File size in bytes. (文件大小，字节) */
	size: number;
	/** Last modification time (timestamp). (最后修改时间戳) */
	mtime: number;
	/** Creation time (timestamp). (创建时间戳) */
	ctime?: number;
	/**
	 * File content (extracted text, typically in markdown format).
	 * 
	 * Content storage varies by document type:
	 * - Text files (markdown, txt, etc.): raw content directly from file
	 * - Binary files (PDF, Image, etc.): extracted content converted to markdown
	 *   For binary files, extracted content is stored here after processing.
	 *   The content is typically converted to markdown format and processed
	 *   by the markdown extractor for unified handling.
	 * - Canvas/Dataloom: structured representation converted to markdown
	 * 
	 * For binary files, the original file has no text content, so this field
	 * contains the processed/extracted content. For files with cacheFileInfo,
	 * the extracted content is stored in cacheFileInfo.content.
	 * 
	 * 提取后的文本内容（通常转换为 Markdown 格式）。
	 * 对于二进制文件，这里存储 OCR 或解析后的文本。
	 */
	content: string;
}

/**
 * Document metadata extracted from content.
 * 
 * will be readed after documentpo is created. and these data will be readed from Document sourceFile or cacheFile when needed.
 * 
 * 文档元数据接口。
 */
export interface DocumentMetadata {
	/** Document title (extracted from frontmatter, heading, or filename). (标题) */
	title: string;
	/** Document tags (from frontmatter, #tags, or extracted). (标签) */
	tags: string[];
	/** Document categories or classifications. (分类) */
	categories?: string[];
	/** Special document types (daily note, profile, principle, etc.). (特殊业务属性，如日记等) */
	specialTypes?: string[];
	/** Frontmatter data (YAML/JSON). (YAML 元数据) */
	frontmatter?: Record<string, unknown>;
	/** Custom metadata fields. (自定义字段) */
	custom?: Record<string, unknown>;
}

/**
 * Reference to another document.
 * 
 * 文档引用项。
 */
export interface DocumentReference {
	/**
	 * Document ID (if available).
	 * May be empty/undefined when the referenced document hasn't been indexed yet.
	 * 被引用文档的 ID。
	 */
	docId?: string;
	/**
	 * Full path relative to vault root.
	 * Required and cannot be empty.
	 * 库相对路径。
	 */
	fullPath: string;
}

/**
 * Document references (bidirectional).
 * 
 * will be readed after graph instance is created.
 * 
 * 双向链接引用关系。
 */
export interface DocumentReferences {
	/** Outgoing references (links from this document). (出链) */
	outgoing: DocumentReference[];
	/** Incoming references (links to this document). (入链) */
	incoming: DocumentReference[];
}

/**
 * Core Document model for the entire plugin.
 * 
 * This unified model supports all document types and operations:
 * - Indexing (search index)
 * - Chat (RAG, context)
 * - Analysis (tags, references, summary)
 * 
 * All document loaders should produce this model.
 * 
 * fields in Document model, like tags, title will be readed from Document sourceFile or cacheFile when needed after documentpo is created.
 * 
 * 核心文档对象接口。
 * 聚合了文件信息、缓存信息、元数据和引用关系。
 */
export interface Document {
	/**
	 * Unique document identifier.
	 * A string identifier, typically UUID or similar unique format.
	 * Not necessarily the file path.
	 * 文档唯一标识符（UUID）。
	 */
	id: string;
	/** Document type. (文档类型) */
	type: DocumentType;
	/** Source file information. (原始文件信息) */
	sourceFileInfo: DocumentFileInfo;
	/** Cache file information. eg pdf's image's cache file info. (缓存文件信息，如 PDF OCR 的中间结果) */
	cacheFileInfo: DocumentFileInfo;
	/** Document metadata. (提取的元数据) */
	metadata: DocumentMetadata;
	/** Document references (bidirectional links). (双链关系) */
	references: DocumentReferences;

	/**
	 * Short summary.
	 * Document summary (redundant field for quick access).
	 * 
	 * This is a cached summary extracted from content:
	 * - For text files (no cacheFile): summary extracted from sourceFileInfo.content
	 * - For binary files (PDF, Image, etc.): summary extracted from cacheFileInfo.content
	 * 
	 * The summary is generated after processing sourceFileInfo.content and/or
	 * cacheFileInfo.content, and stored here for quick access without re-processing.
	 * 
	 * Only generated if content is substantial.
	 * Null for short documents (not worth summarizing) or if not yet processed.
	 * 
	 * 文档摘要（如果存在且已生成）。
	 */
	summary?: string | null;

	/**
	 * MD5 hash of content (for deduplication).
	 * Prevents duplicate embedding and processing.
	 * 内容哈希值，用于检测变更和去重。
	 */
	contentHash: string;

	/** Processing timestamp (when document was last processed). (最后处理时间) */
	lastProcessedAt: number;
}

/**
 * Special resource types that are not regular documents
 * 
 * 特殊资源类型。
 */
export type SpecialResourceType = 'tag' | 'folder' | 'category';

/**
 * All possible resource kinds (document types + special resource types)
 */
export type ResourceKind = DocumentType | SpecialResourceType;

/**
 * Resource summary result
 * 
 * 资源摘要结果。包含短摘要和完整摘要。
 */
export interface ResourceSummary {
	shortSummary: string;
	fullSummary?: string;
}

/**
 * Interface for resources that can generate summaries
 * 
 * 可摘要接口。
 */
export interface Summarizable {
	/**
	 * Get summary for a resource or document
	 * 
	 * 为资源或文档获取摘要。
	 */
	getSummary(
		source: Document | string,
		provider?: string,
		modelId?: string
	): Promise<ResourceSummary>;
}

/**
 * Resource loader interface for special resource types
 * 
 * 资源加载器接口。
 */
export interface ResourceLoader extends Summarizable {
	/**
	 * Get the resource type this loader handles
	 * 
	 * 获取该加载器处理的资源类型。
	 */
	getResourceType(): ResourceKind;
}

