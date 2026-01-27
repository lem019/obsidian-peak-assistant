import type { Database as DbSchema } from '../ddl';

/**
 * Repository Types
 * 
 * Defines shared data transfer objects (DTOs) and input/output types specifically 
 * for SQLite repository operations. These types help maintain a clean separation 
 * between the raw database schema and the data used by application services.
 * 
 * 存储库类型
 * 
 * 定义了专门用于 SQLite 存储库操作的共享数据传输对象 (DTO) 以及输入/输出类型。
 * 这些类型有助于在原始数据库架构与应用程序服务使用的数据之间保持清晰的分离。
 */

/**
 * Data needed to create or update a document text chunk.
 * 创建或更新文档文本分块所需的数据。
 */
export type DocChunkInput = {
	chunk_id: string;
	doc_id: string;
	chunk_index: number;
	title: string | null;
	mtime: number | null;
	content_raw: string | null;
	content_fts_norm: string | null;
};

/**
 * Standard data structure returned when querying text chunks.
 * 查询文本分块时返回的标准数据结构。
 */
export type DocChunkOutput = Pick<DbSchema['doc_chunk'], 'chunk_id' | 'doc_id' | 'title' | 'content_raw' | 'mtime'>;

/**
 * Parameters for inserting data into the Full-Text Search (FTS) engine.
 * 向全文搜索 (FTS) 引擎插入数据时使用的参数。
 */
export type FtsInsertParams = {
	chunk_id: string;
	doc_id: string;
	content: string;
};

/**
 * Parameters for inserting file-level metadata into the FTS engine.
 * 向 FTS 引擎插入文件级元数据时使用的参数。
 */
export type FtsMetaInsertParams = {
	doc_id: string;
	path: string;
	title: string | null;
};

/**
 * Represents a single search result from a Full-Text Search query.
 * 全文搜索查询返回的单条搜索结果。
 */
export type FtsSearchResult = {
	chunkId: string; // The specific chunk that matched | 匹配到的具体分块
	path: string; // File path | 文件路径
	title: string; // Document title | 文档标题
	type: string; // File type (md, pdf) | 文件类型
	mtime: number; // Last modified timestamp | 最后修改时间戳
	content: string; // Snippet of the matched content | 匹配到的内容片段
	bm25: number; // Search relevance score | 搜索相关性评分 (BM25 算法)
};

