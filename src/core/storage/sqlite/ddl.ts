/**
 * @file ddl.ts
 * @description 数据库定义语言 (Data Definition Language)，定义了项目的数据库架构。
 * 
 * ## 核心职能
 * 1. **架构定义**：定义了 `Peak Search` 和 `Peak Meta` 两个数据库的所有表结构，包括文档、向量、图、对话和设置。
 * 2. **类型安全**：为 Kysely 提供详尽的 TypeScript 接口，确保 SQL 查询在编译期就能捕获错误。
 * 3. **兼容性抽象**：通过查询构建器确保底层 SQLite 引擎（better-sqlite3 或 sql.js）的一致性。
 * 
 * ## 数据库概览
 * - **文档管理**：`doc_meta`, `doc_stats`, `doc_embedding`
 * - **知识图谱**：`graph_node`, `graph_edge`
 * - **对话记录**：`conversation`, `message`
 * - **插件状态**：`settings`, `activity_log`
 * 
 * ## 生活化类比
 * 就像是一份“楼书”或“建筑蓝图”。它详细规划了这栋大楼里有多少个房间（表），每个房间放什么家具（列），以及房间之间的门（外键关联）在哪里。
 */
export interface Database {
	/**
	 * Stores metadata for documents tracked by the system.
	 * 存储系统跟踪的文档的元数据。
	 */
	doc_meta: {
		id: string; // Unique document ID | 唯一文档 ID
		path: string; // File path relative to vault root | 相对于库根目录的文件路径
		type: string | null; // Document type (md, pdf, etc.) | 文档类型
		title: string | null; // Document title | 文档标题
		size: number | null; // File size in bytes | 文件大小 (字节)
		mtime: number | null; // Last modified time | 最后修改时间
		ctime: number | null; // Creation time | 创建时间
		content_hash: string | null; // Hash of file content for change detection | 文件内容摘要
		summary: string | null; // Generated summary text | 生成的摘要文本
		tags: string | null; // Extracted tags | 提取的标签
		last_processed_at: number | null; // Timestamp of last indexing | 上次索引的时间戳
		frontmatter_json?: string | null; // Raw frontmatter stored as JSON | 以 JSON 存储的原始前置元数据
	};
	
	/**
	 * Tracks the internal state of indexing processes.
	 * 跟踪索引过程的内部状态。
	 */
	index_state: {
		key: string;
		value: string | null;
	};

	/**
	 * Stores vector embeddings for semantic search.
	 * 存储用于语义搜索的向量嵌入。
	 */
	embedding: {
		id: string;
		doc_id: string; // Reference to doc_meta.id | 对应 doc_meta.id
		chunk_id: string | null; // Reference to doc_chunk.chunk_id | 对应 doc_chunk.chunk_id
		chunk_index: number | null; // Index of the chunk within the document | 该分块在文档中的索引
		content_hash: string;
		ctime: number;
		mtime: number;
		embedding: Buffer; // BLOB: binary vector data | BLOB: 二进制向量数据
		embedding_model: string; // Model used to generate embedding | 用于生成嵌入的模型
		embedding_len: number; // Dimension of the vector | 向量维度
	};

	/**
	 * Stores quantitative statistics about documents.
	 * 存储关于文档的数量统计信息。
	 */
	doc_statistics: {
		doc_id: string;
		word_count: number | null;
		char_count: number | null;
		language: string | null;
		richness_score: number | null; // Placeholder for content quality metric | 内容质量指标占位符
		last_open_ts: number | null; // Last time the file was opened in Obsidian | 库中文件上次打开时间
		open_count: number | null; // Total open count | 总打开次数
		updated_at: number;
	};

	/**
	 * Nodes for the internal knowledge graph.
	 * 内部知识图谱的节点。
	 */
	graph_nodes: {
		id: string; // Unique node ID | 唯一节点 ID
		type: string; // Node type (document, tag, etc.) | 节点类型
		label: string; // Display label | 显示名称
		attributes: string; // JSON string of specific properties | 特定属性的 JSON 字符串
		created_at: number;
		updated_at: number;
	};

	/**
	 * Edges (relationships) between knowledge graph nodes.
	 * 知识图谱节点之间的边（关系）。
	 */
	graph_edges: {
		id: string;
		from_node_id: string;
		to_node_id: string;
		type: string; // Relationship type (link, parent, etc.) | 关系类型
		weight: number; // Strength of relationship | 关系权重
		attributes: string;
		created_at: number;
		updated_at: number;
	};

	/**
	 * Stores individual text chunks from documents for fast retrieval.
	 * 存储来自文档的各个文本分块，以便快速检索。
	 */
	doc_chunk: {
		chunk_id: string;
		doc_id: string;
		chunk_index: number;
		title: string | null;
		mtime: number | null;
		content_raw: string | null; // Original extracted text | 原始提取的文本
		content_fts_norm: string | null; // Normalized text for Full-Text Search | 用于全文搜索的归一化文本
	};

	/**
	 * FTS5 Virtual Table for Full-Text Search.
	 * 全文搜索的 FTS5 虚拟表。
	 */
	doc_fts: {
		chunk_id: string;
		doc_id: string;
		path: string;
		title: string | null;
		content: string | null;
	};

	/**
	 * Represents an AI chat project (collection of conversations).
	 * 代表一个 AI 聊天项目（对话集合）。
	 */
	chat_project: {
		project_id: string;
		name: string;
		folder_rel_path: string; // Location of project files in vault | 项目文件在库中的位置
		created_at_ts: number;
		updated_at_ts: number;
		archived_rel_path: string | null;
		meta_json: string | null;
	};

	/**
	 * Represents an individual chat conversation.
	 * 代表一次独立的聊天对话。
	 */
	chat_conversation: {
		conversation_id: string;
		project_id: string | null;
		title: string;
		file_rel_path: string; // Link to the actual .md chat file | 链接到实际的 .md 聊天文件
		created_at_ts: number;
		updated_at_ts: number;
		active_model: string | null;
		active_provider: string | null;
		token_usage_total: number | null;
		title_manually_edited: number; // Boolean flag | 布尔标记
		title_auto_updated: number; // Boolean flag | 布尔标记
		context_last_updated_ts: number | null;
		context_last_message_index: number | null;
		archived_rel_path: string | null;
		meta_json: string | null;
	};

	/**
	 * Stores individual messages within a conversation.
	 * 存储对话中的单条消息。
	 */
	chat_message: {
		message_id: string;
		conversation_id: string;
		role: string; // system, user, assistant | 角色：系统、用户、助手
		content_hash: string | null;
		created_at_ts: number;
		created_at_zone: string | null;
		model: string | null;
		provider: string | null;
		starred: number; // Boolean flag | 收藏标记
		is_error: number; // Boolean flag | 错误标记
		is_visible: number; // Boolean flag | 是否在 UI 可见
		gen_time_ms: number | null; // Time taken to generate response | 生成响应耗时
		token_usage_json: string | null; // detailed token breakdown | 详细的 Token 消耗
		thinking: string | null; // Chain-of-thought content | 思维链内容
		content_preview: string | null; // Short version for display | 用于显示的预览
		attachment_summary: string | null; // Summary of attached resources | 附件资源的摘要
	};

	/**
	 * Tracks resources (files, tags, URLs) attached to a chat message.
	 * 跟踪附加到聊天消息的资源（文件、标签、URL）。
	 */
	chat_message_resource: {
		id: string;
		message_id: string;
		source: string; // identifier of the resource | 资源标识符
		kind: string | null; // pdf, tag, url, etc. | 资源种类
		summary_note_rel_path: string | null; // Link to extracted summary note | 链接到提取的摘要笔记
		meta_json: string | null;
	};

	/**
	 * Stores 'starred' or favorite messages globally.
	 * 全局存储“已收藏”或收藏的消息。
	 */
	chat_star: {
		source_message_id: string;
		/**
		 * Separate id for UI/reference needs.
		 */
		id: string;
		conversation_id: string;
		project_id: string | null;
		created_at_ts: number;
		active: number;
	};
}


/**
 * Database interface that supports both sql.js and better-sqlite3.
 * Both libraries provide an `exec()` method for running SQL statements.
 */
interface SqliteDatabaseLike {
	exec(sql: string): void;
}

/**
 * Apply schema migrations. Keep this idempotent.
 *
 * Supports both:
 * - sql.js Database (from @/core/storage/sqlite/SqliteMetadataStore - deprecated)
 * - better-sqlite3 Database (from @/core/storage/sqlite/BetterSqliteStore)
 *
 * Both implement the `exec()` method, so this migration works with either.
 * Uses raw SQL for simplicity and full SQLite feature support (FTS5, etc.).
 */
export function migrateSqliteSchema(db: SqliteDatabaseLike): void {
	const tryExec = (sql: string) => {
		try {
			db.exec(sql);
		} catch (error) {
			// Ignore migration errors for idempotency (e.g., "duplicate column name").
			// For vec_embeddings, if creation fails, we log a warning but don't throw
			// The SqliteStoreManager tracks whether vector search is available via a flag
			if (sql.includes('vec_embeddings')) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				console.warn(
					'[DDL] Failed to create vec_embeddings virtual table. ' +
					'Vector similarity search will not be available. ' +
					'This requires sqlite-vec extension to be loaded. ' +
					`Error: ${errorMsg}`
				);
				// Don't throw - allow database to continue without vector search
				return;
			}
			// For other errors, ignore for idempotency
		}
	};

	db.exec(`
		CREATE TABLE IF NOT EXISTS doc_meta (
			id TEXT PRIMARY KEY,
			path TEXT NOT NULL UNIQUE,
			type TEXT,
			title TEXT,
			size INTEGER,
			mtime INTEGER,
			ctime INTEGER,
			content_hash TEXT,
			summary TEXT,
			tags TEXT,
			last_processed_at INTEGER,
			frontmatter_json TEXT
		);
		CREATE INDEX IF NOT EXISTS idx_doc_meta_path ON doc_meta(path);
		CREATE INDEX IF NOT EXISTS idx_doc_meta_content_hash ON doc_meta(content_hash);
		CREATE TABLE IF NOT EXISTS index_state (
			key TEXT PRIMARY KEY,
			value TEXT
		);
		CREATE TABLE IF NOT EXISTS embedding (
			id TEXT PRIMARY KEY,
			doc_id TEXT NOT NULL,
			chunk_id TEXT,
			chunk_index INTEGER,
			content_hash TEXT NOT NULL,
			ctime INTEGER NOT NULL,
			mtime INTEGER NOT NULL,
			embedding BLOB NOT NULL,
			embedding_model TEXT NOT NULL,
			embedding_len INTEGER NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_embedding_doc_id ON embedding(doc_id);
		CREATE INDEX IF NOT EXISTS idx_embedding_chunk_id ON embedding(chunk_id);
		CREATE INDEX IF NOT EXISTS idx_embedding_content_hash ON embedding(content_hash);
		CREATE TABLE IF NOT EXISTS doc_statistics (
			doc_id TEXT PRIMARY KEY,
			word_count INTEGER,
			char_count INTEGER,
			language TEXT,
			richness_score REAL,
			last_open_ts INTEGER,
			open_count INTEGER,
			updated_at INTEGER NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_doc_statistics_doc_id ON doc_statistics(doc_id);
		CREATE INDEX IF NOT EXISTS idx_doc_statistics_last_open_ts ON doc_statistics(last_open_ts);
		CREATE TABLE IF NOT EXISTS graph_nodes (
			id TEXT PRIMARY KEY,
			type TEXT NOT NULL,
			label TEXT NOT NULL,
			attributes TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_graph_nodes_type ON graph_nodes(type);
		CREATE INDEX IF NOT EXISTS idx_graph_nodes_updated_at ON graph_nodes(updated_at);
		CREATE TABLE IF NOT EXISTS graph_edges (
			id TEXT PRIMARY KEY,
			from_node_id TEXT NOT NULL,
			to_node_id TEXT NOT NULL,
			type TEXT NOT NULL,
			weight REAL NOT NULL DEFAULT 1.0,
			attributes TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			FOREIGN KEY (from_node_id) REFERENCES graph_nodes(id) ON DELETE CASCADE,
			FOREIGN KEY (to_node_id) REFERENCES graph_nodes(id) ON DELETE CASCADE
		);
		CREATE INDEX IF NOT EXISTS idx_graph_edges_from_node ON graph_edges(from_node_id);
		CREATE INDEX IF NOT EXISTS idx_graph_edges_to_node ON graph_edges(to_node_id);
		CREATE INDEX IF NOT EXISTS idx_graph_edges_type ON graph_edges(type);
		CREATE INDEX IF NOT EXISTS idx_graph_edges_from_to ON graph_edges(from_node_id, to_node_id);
	`);

	// Chunk storage for FTS/vector/search snippets.
	db.exec(`
		CREATE TABLE IF NOT EXISTS doc_chunk (
			chunk_id TEXT PRIMARY KEY,
			doc_id TEXT NOT NULL,
			chunk_index INTEGER NOT NULL,
			title TEXT,
			mtime INTEGER,
			content_raw TEXT,
			content_fts_norm TEXT
		);
		CREATE INDEX IF NOT EXISTS idx_doc_chunk_doc_id ON doc_chunk(doc_id);
		CREATE INDEX IF NOT EXISTS idx_doc_chunk_doc_id_chunk ON doc_chunk(doc_id, chunk_index);
	`);


	// FTS5 virtual table for document content (stores normalized text).
	// Note: tokenize options may vary by SQLite build; keep it simple for compatibility.
	// Kysely doesn't support virtual tables, so we use raw SQL.
	tryExec(`
		CREATE VIRTUAL TABLE IF NOT EXISTS doc_fts USING fts5(
			chunk_id UNINDEXED,
			doc_id UNINDEXED,
			content
		);
	`);

	// FTS5 virtual table for document metadata (title/path).
	// Separate from content FTS to avoid redundant storage and enable weighted search.
	tryExec(`
		CREATE VIRTUAL TABLE IF NOT EXISTS doc_meta_fts USING fts5(
			doc_id UNINDEXED,
			path,
			title
		);
	`);

	// sqlite-vec virtual table for vector similarity search.
	// 
	// WHY IS VEC0 VIRTUAL TABLE REQUIRED?
	// ====================================
	// SQLite's standard indexes (B-tree, Hash) can only handle scalar values (numbers, strings).
	// They cannot efficiently handle vector similarity search (KNN) which requires:
	// 1. Multi-dimensional distance calculations (cosine similarity, euclidean distance)
	// 2. Approximate Nearest Neighbor (ANN) indexes (HNSW, IVF, etc.)
	// 3. Custom operators like MATCH for KNN queries
	//
	// vec0 virtual table provides:
	// - Custom storage optimized for vectors
	// - Built-in ANN indexes (HNSW) for O(log n) search complexity
	// - MATCH operator for efficient KNN queries
	//
	// SQLite's architecture does NOT allow:
	// - Using virtual table indexes on regular tables
	// - Adding custom operators to regular tables
	// - Modifying regular table's index algorithms
	//
	// Therefore, vec0 virtual table is the ONLY way to achieve efficient vector search in SQLite.
	//
	// For detailed explanation, see: VEC0_VIRTUAL_TABLE_EXPLANATION.md
	//
	// Note: This requires sqlite-vec extension to be loaded first.
	// vec_embeddings virtual table is created lazily on first insert in EmbeddingRepo.upsert()
	// This ensures the table dimension matches the actual embedding model dimension.
	// We don't create it here to avoid hardcoding a dimension that might not match the model.
	//
	// Important: vec_embeddings.rowid corresponds to embedding table's implicit rowid (integer).
	// This allows direct association without a mapping table.
	// When inserting into vec_embeddings, we use embedding table's rowid as vec_embeddings.rowid.
	// tryExec(`
	// 	CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings USING vec0(
	// 		embedding float[1536]
	// 	);
	// `);

	// Chat storage tables (metadata-only, markdown files store plain text)
	db.exec(`
		CREATE TABLE IF NOT EXISTS chat_project (
			project_id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			folder_rel_path TEXT NOT NULL UNIQUE,
			created_at_ts INTEGER NOT NULL,
			updated_at_ts INTEGER NOT NULL,
			archived_rel_path TEXT,
			meta_json TEXT
		);
		CREATE INDEX IF NOT EXISTS idx_chat_project_folder_path ON chat_project(folder_rel_path);
		CREATE INDEX IF NOT EXISTS idx_chat_project_updated_at ON chat_project(updated_at_ts);
		CREATE TABLE IF NOT EXISTS chat_conversation (
			conversation_id TEXT PRIMARY KEY,
			project_id TEXT,
			title TEXT NOT NULL,
			file_rel_path TEXT NOT NULL UNIQUE,
			created_at_ts INTEGER NOT NULL,
			updated_at_ts INTEGER NOT NULL,
		active_model TEXT,
		active_provider TEXT,
		token_usage_total INTEGER,
		title_manually_edited INTEGER NOT NULL DEFAULT 0,
		title_auto_updated INTEGER NOT NULL DEFAULT 0,
		context_last_updated_ts INTEGER,
		context_last_message_index INTEGER,
		archived_rel_path TEXT,
			meta_json TEXT
		);
		CREATE INDEX IF NOT EXISTS idx_chat_conversation_project_id ON chat_conversation(project_id);
		CREATE INDEX IF NOT EXISTS idx_chat_conversation_file_path ON chat_conversation(file_rel_path);
		CREATE INDEX IF NOT EXISTS idx_chat_conversation_updated_at ON chat_conversation(updated_at_ts);
		CREATE TABLE IF NOT EXISTS chat_message (
			message_id TEXT PRIMARY KEY,
			conversation_id TEXT NOT NULL,
			role TEXT NOT NULL,
			content_hash TEXT,
			created_at_ts INTEGER NOT NULL,
			created_at_zone TEXT,
			model TEXT,
			provider TEXT,
			starred INTEGER NOT NULL DEFAULT 0,
			is_error INTEGER NOT NULL DEFAULT 0,
			is_visible INTEGER NOT NULL DEFAULT 1,
			gen_time_ms INTEGER,
			token_usage_json TEXT,
			thinking TEXT,
			content_preview TEXT,
			attachment_summary TEXT
		);
		CREATE INDEX IF NOT EXISTS idx_chat_message_conversation_id ON chat_message(conversation_id);
		CREATE INDEX IF NOT EXISTS idx_chat_message_created_at ON chat_message(created_at_ts);
	`);
	db.exec(`
		CREATE TABLE IF NOT EXISTS chat_message_resource (
			id TEXT PRIMARY KEY,
			message_id TEXT NOT NULL,
			source TEXT NOT NULL,
			kind TEXT,
			summary_note_rel_path TEXT,
			meta_json TEXT
		);
		CREATE INDEX IF NOT EXISTS idx_chat_message_resource_message_id ON chat_message_resource(message_id);
		CREATE TABLE IF NOT EXISTS chat_star (
			source_message_id TEXT PRIMARY KEY,
			id TEXT NOT NULL,
			conversation_id TEXT NOT NULL,
			project_id TEXT,
			created_at_ts INTEGER NOT NULL,
			active INTEGER NOT NULL DEFAULT 1
		);
		CREATE INDEX IF NOT EXISTS idx_chat_star_active ON chat_star(active);
		CREATE INDEX IF NOT EXISTS idx_chat_star_conversation_id ON chat_star(conversation_id);
	`);
}


