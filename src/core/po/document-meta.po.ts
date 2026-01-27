/**
 * @file document-meta.po.ts
 * @description 文档元数据持久化对象，存储从 Document 提取的文档元数据信息
 */

/**
 * Document metadata PO (Persistent Object).
 * Stores document metadata information extracted from Document.
 * fields in Document model, like tags, title will be readed when needed from Document sourceFile or cacheFile.
 * 
 * 文档元数据持久化对象
 * 存储从 Document 提取的文档元数据信息
 * Document 模型中的字段（如 tags、title）将在需要时从 Document 的 sourceFile 或 cacheFile 读取
 */
export interface DocumentMetaPO {
	/**
	 * Document ID (unique identifier, may differ from path).
	 * primary key for database.
	 * 
	 * 文档 ID（唯一标识符，可能与路径不同）
	 * 数据库主键
	 */
	id: string;
	/**
	 * File path
	 * 文件路径
	 */
	sourceFilePath: string;
	/**
	 * Cache file path
	 * 缓存文件路径
	 */
	cacheFilePath: string;
	/**
	 * Document type.
	 * type limit to DocumentType enum.
	 * 
	 * 文档类型
	 * 类型限制为 DocumentType 枚举
	 */
	type: string | null;
	/**
	 * Last modification time (timestamp, from sourceFileInfo.mtime).
	 * 最后修改时间（时间戳，来自 sourceFileInfo.mtime）
	 */
	mtime: number | null;
	/**
	 * Creation time (timestamp, from sourceFileInfo.ctime).
	 * 创建时间（时间戳，来自 sourceFileInfo.ctime）
	 */
	ctime: number | null;
	/**
	 * MD5 hash of content (for deduplication, from Document.contentHash).
	 * 内容的 MD5 哈希（用于去重，来自 Document.contentHash）
	 */
	content_hash: string | null;
	/**
	 * Last processing timestamp (from Document.lastProcessedAt).
	 * 最后处理时间戳（来自 Document.lastProcessedAt）
	 */
	last_processed_at: number | null;
}

