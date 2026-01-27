/**
 * @file embedding.po.ts
 * @description 嵌入向量持久化对象，缓存为文档分块生成的嵌入向量
 */

/**
 * Embedding PO (Persistent Object).
 * Caches generated embeddings for document chunks.
 * 
 * 嵌入向量持久化对象
 * 缓存为文档分块生成的嵌入向量
 */
export interface EmbeddingPO {
	/**
	 * Unique identifier (primary key).
	 * Format: "{file_id}:chunk:{chunk_index}" or file_id for non-chunked documents.
	 * 
	 * 唯一标识符（主键）
	 * 格式："{file_id}:chunk:{chunk_index}" 或非分块文档的 file_id
	 */
	id: string;
	/**
	 * File identifier (typically file path or document ID).
	 * 文件标识符（通常为文件路径或文档 ID）
	 */
	file_id: string;
	/**
	 * Chunk identifier (for chunked documents).
	 * 分块标识符（用于分块文档）
	 */
	chunk_id: string | null;
	/**
	 * Chunk index within document (0-based).
	 * 文档内的分块索引（从 0 开始）
	 */
	chunk_index: number | null;
	/**
	 * MD5 hash of chunk content (for cache invalidation).
	 * 分块内容的 MD5 哈希（用于缓存失效）
	 */
	md5: string;
	/**
	 * Creation time (timestamp).
	 * 创建时间（时间戳）
	 */
	ctime: number;
	/**
	 * Last modification time (timestamp).
	 * 最后修改时间（时间戳）
	 */
	mtime: number;
	/**
	 * Embedding vector (stored as JSON string or BLOB).
	 * JSON array of numbers.
	 * 
	 * 嵌入向量（存储为 JSON 字符串或 BLOB）
	 * JSON 数字数组
	 */
	embedding: string;
	/**
	 * Embedding model identifier.
	 * 嵌入模型标识符
	 */
	embedding_model: string;
	/**
	 * Embedding vector length (dimension).
	 * 嵌入向量长度（维度）
	 */
	embedding_len: number;
}

