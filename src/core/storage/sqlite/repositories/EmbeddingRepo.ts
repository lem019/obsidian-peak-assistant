import type { Kysely } from 'kysely';
import type { Database as DbSchema } from '../ddl';
import type { SqliteDatabase } from '../types';
import type { SearchScopeMode, SearchScopeValue } from '@/service/search/types';
import { BusinessError, ErrorCode } from '@/core/errors';

/**
 * Embedding Repository
 * 
 * Manages the persistent storage of text embeddings and synchronizes them with 
 * the `vec_embeddings` virtual table for high-performance vector similarity search.
 * This class handles the complexity of `sqlite-vec` integration, including:
 * 1. Storing primary embedding metadata in a standard SQLite table.
 * 2. Managing the lifecycle of the `vec0` virtual table.
 * 3. Handling vector dimension mismatches (automatic recreation of indices).
 * 4. Fallback mechanisms and state caching for database initialization.
 * 
 * 嵌入 (Embedding) 存储库
 * 
 * 管理文本嵌入的持久化存储，并将其同步到 `vec_embeddings` 虚拟表中，以实现高性能的向量相似性搜索。
 * 此类处理 `sqlite-vec` 集成的复杂性，包括：
 * 1. 在标准 SQLite 表中存储主要的嵌入元数据。
 * 2. 管理 `vec0` 虚拟表的生命周期。
 * 3. 处理向量维度不匹配（自动重建索引）。
 * 4. 数据库初始化的回退机制和状态缓存。
 */
export class EmbeddingRepo {
	// Cache for vec_embeddings table state (checked once on plugin startup)
	// vec_embeddings 表状态的缓存（在插件启动时检查一次）
	private vecEmbeddingsTableExists: boolean | null = null;
	private vecEmbeddingsTableDimension: number | null = null;

	constructor(
		private readonly db: Kysely<DbSchema>,
		private readonly rawDb: SqliteDatabase, // Used for specialized vector SQL functions | 用于专门的向量 SQL 函数
	) { }

	/**
	 * Convert number[] to Buffer (BLOB format) for database storage.
	 * 将 number[] 转换为 Buffer (BLOB 格式) 以供数据库存储。
	 */
	private arrayToBuffer(arr: number[]): Buffer {
		const buffer = Buffer.allocUnsafe(arr.length * 4); // 4 bytes per float32
		for (let i = 0; i < arr.length; i++) {
			buffer.writeFloatLE(arr[i], i * 4);
		}
		return buffer;
	}

	/**
	 * Convert Buffer (BLOB format) from database to number[].
	 * 将数据库中的 Buffer (BLOB 格式) 转换为 number[]。
	 */
	private bufferToArray(buffer: Buffer): number[] {
		const arr: number[] = [];
		for (let i = 0; i < buffer.length; i += 4) {
			arr.push(buffer.readFloatLE(i));
		}
		return arr;
	}

	/**
	 * Initialize vec_embeddings table state cache.
	 * Should be called once on plugin startup to avoid frequent table checks.
	 * 
	 * 初始化 vec_embeddings 表状态缓存。
	 * 应在插件启动时调用一次，以避免频繁的表检查。
	 */
	initializeVecEmbeddingsTableCache(): void {
		const checkStmt = this.rawDb.prepare(`
			SELECT name FROM sqlite_master 
			WHERE type='table' AND name='vec_embeddings'
		`);
		this.vecEmbeddingsTableExists = checkStmt.get() !== undefined;

		// If table exists, try to get dimension from table definition
		// Note: sqlite-vec doesn't expose dimension directly, so we'll check it during first insert
		if (this.vecEmbeddingsTableExists) {
			// Dimension will be validated on first insert attempt
			this.vecEmbeddingsTableDimension = null; // Unknown until first insert
		}
	}

	/**
	 * Re-check vec_embeddings table state (fallback when error occurs).
	 * 重新检查 vec_embeddings 表状态（发生错误时的回退机制）。
	 */
	private recheckVecEmbeddingsTableState(): void {
		const checkStmt = this.rawDb.prepare(`
			SELECT name FROM sqlite_master 
			WHERE type='table' AND name='vec_embeddings'
		`);
		this.vecEmbeddingsTableExists = checkStmt.get() !== undefined;
		this.vecEmbeddingsTableDimension = null; // Reset dimension cache
	}

	/**
	 * Recreate vec_embeddings table with new dimension.
	 * This will delete all existing vector data in vec_embeddings.
	 * Note: This does NOT delete embedding records from the embedding table.
	 * 
	 * 使用新维度重新创建 vec_embeddings 表。
	 * 这将删除 vec_embeddings 中所有现有的向量数据。
	 * 注意：这不会删除 embedding 表中的记录。
	 * 
	 * @param dimension - New dimension for the table | 表的新维度
	 */
	recreateVecEmbeddingsTable(dimension: number): void {
		console.warn(
			`[EmbeddingRepo] Recreating vec_embeddings table with dimension ${dimension}. ` +
			'All existing vector data in vec_embeddings will be lost (embedding table records are preserved).'
		);

		// Drop existing table
		this.rawDb.exec(`DROP TABLE IF EXISTS vec_embeddings`);

		// Create new table with correct dimension
		this.rawDb.exec(`
			CREATE VIRTUAL TABLE vec_embeddings USING vec0(
				embedding float[${dimension}]
			)
		`);

		// Update cache
		this.vecEmbeddingsTableExists = true;
		this.vecEmbeddingsTableDimension = dimension;

		console.log(`[EmbeddingRepo] Recreated vec_embeddings table with dimension ${dimension}`);
	}

	/**
	 * Ensure vec_embeddings table exists with correct dimension.
	 * Uses cached state to avoid frequent table checks.
	 * If table doesn't exist, create it with the specified dimension.
	 * 
	 * 确保 vec_embeddings 表存在且维度正确。
	 * 使用缓存状态以避免频繁的表检查。
	 * 如果表不存在，则使用指定的维度创建它。
	 */
	private ensureVecEmbeddingsTable(dimension: number): void {
		// Use cached state if available
		if (this.vecEmbeddingsTableExists === null) {
			// Cache not initialized, check now
			this.initializeVecEmbeddingsTableCache();
		}

		if (!this.vecEmbeddingsTableExists) {
			// Create table with correct dimension on first insert
			// This ensures the table dimension matches the actual embedding model dimension
			this.rawDb.exec(`
				CREATE VIRTUAL TABLE vec_embeddings USING vec0(
					embedding float[${dimension}]
				)
			`);
			console.log(`[EmbeddingRepo] Created vec_embeddings table with dimension ${dimension}`);
			// Update cache
			this.vecEmbeddingsTableExists = true;
			this.vecEmbeddingsTableDimension = dimension;
		}
		// If table exists, dimension will be validated during insert
		// If mismatch, we'll catch the error and throw a clear error message
	}

	/**
	 * Get internal SQLite rowid for an embedding record.
	 * 获取嵌入记录的内部 SQLite rowid。
	 */
	private getEmbeddingRowid(id: string): number | null {
		const stmt = this.rawDb.prepare(`
			SELECT rowid FROM embedding WHERE id = ?
		`);
		const result = stmt.get(id) as { rowid: number } | undefined;
		return result?.rowid ?? null;
	}


	/**
	 * Sync embedding to vec_embeddings virtual table.
	 * This performs DELETE then INSERT (virtual tables don't support UPDATE).
	 * 
	 * 将嵌入同步到 vec_embeddings 虚拟表。
	 * 此操作执行先删除后插入（虚拟表不支持更新）。
	 */
	private syncToVecEmbeddings(embeddingRowid: number, embeddingBuffer: Buffer, logContext?: string): void {
		// Check if row exists in vec_embeddings
		const checkStmt = this.rawDb.prepare(`
			SELECT rowid FROM vec_embeddings WHERE rowid = CAST(? AS INTEGER)
		`);
		const existing = checkStmt.get(embeddingRowid);

		// If exists, delete first (virtual tables don't support UPDATE)
		if (existing) {
			const deleteStmt = this.rawDb.prepare(`
				DELETE FROM vec_embeddings WHERE rowid = CAST(? AS INTEGER)
			`);
			deleteStmt.run(embeddingRowid);
		}

		// Insert (or re-insert) the embedding
		const insertStmt = this.rawDb.prepare(`
			INSERT INTO vec_embeddings(rowid, embedding)
			VALUES (CAST(? AS INTEGER), ?)
		`);
		const logMsg = logContext
			? `[EmbeddingRepo] Inserting into vec_embeddings with rowid: ${embeddingRowid} (${logContext})`
			: `[EmbeddingRepo] Inserting into vec_embeddings with rowid: ${embeddingRowid}`;
		console.debug(logMsg);
		insertStmt.run(embeddingRowid, embeddingBuffer);
	}

	/**
	 * Handle errors from syncToVecEmbeddings and retry if needed.
	 * This is critical for recovery when the vector extension is loaded or dimensions change.
	 * 
	 * 处理来自 syncToVecEmbeddings 的错误，并在需要时重试。
	 * 这对于加载向量扩展或维度更改时的恢复至关重要。
	 */
	private handleSyncError(
		error: unknown,
		embeddingRowid: number,
		embeddingBuffer: Buffer,
		embeddingDimension: number,
	): void {
		const errorMsg = error instanceof Error ? error.message : String(error);
		const cause = error instanceof Error ? error : new Error(String(error));

		// Handle table missing error
		if (errorMsg.includes('no such table: vec_embeddings')) {
			this.recheckVecEmbeddingsTableState();
			if (!this.vecEmbeddingsTableExists) {
				throw new BusinessError(
					ErrorCode.VEC_EMBEDDINGS_TABLE_MISSING,
					'vec_embeddings virtual table does not exist. This requires sqlite-vec extension to be loaded. Please ensure sqlite-vec is installed and the extension is loaded during database initialization.',
					cause
				);
			}
			// Retry after table state recheck
			this.syncToVecEmbeddings(embeddingRowid, embeddingBuffer, 'retry after table missing');
			return;
		}

		// Handle dimension mismatch error: happens if user switched models
		// 处理维度不匹配错误：如果用户切换了模型，就会发生这种情况
		if (errorMsg.includes('Dimension mismatch')) {
			const dimensionMatch = errorMsg.match(/Expected (\d+) dimensions/);
			const expectedDimension = dimensionMatch ? dimensionMatch[1] : 'unknown';
			console.warn(
				`[EmbeddingRepo] Dimension mismatch detected: table expects ${expectedDimension} dimensions, ` +
				`but received ${embeddingDimension} dimensions. ` +
				`This usually happens when the embedding model was changed. ` +
				`Automatically recreating vec_embeddings table with correct dimension...`
			);
			this.recreateVecEmbeddingsTable(embeddingDimension);
			this.syncToVecEmbeddings(embeddingRowid, embeddingBuffer, 'retry after dimension mismatch');
			console.log(`[EmbeddingRepo] Successfully inserted embedding after recreating table`);
			return;
		}

		// Handle other errors
		this.recheckVecEmbeddingsTableState();
		throw new BusinessError(
			ErrorCode.UNKNOWN_ERROR,
			`Failed to sync embedding to vec_embeddings: ${errorMsg}`,
			cause
		);
	}

	/**
	 * Check if embedding exists by custom ID string.
	 * 检查嵌入是否按自定义 ID 字符串存在。
	 */
	async existsById(id: string): Promise<boolean> {
		const row = await this.db
			.selectFrom('embedding')
			.select('id')
			.where('id', '=', id)
			.executeTakeFirst();
		return row !== undefined;
	}

	/**
	 * Insert new embedding record including its vector payload.
	 * 插入新的嵌入记录，包括其向量负载。
	 * 
	 * @returns The rowid of the newly inserted record. | 新插入记录的 rowid。
	 */
	async insert(embedding: {
		id: string;
		doc_id: string;
		chunk_id: string | null;
		chunk_index: number | null;
		content_hash: string;
		ctime: number;
		mtime: number;
		embedding: Buffer;
		embedding_model: string;
		embedding_len: number;
	}): Promise<number> {
		// Use raw SQL to get the rowid after insert
		const insertStmt = this.rawDb.prepare(`
			INSERT INTO embedding (
				id, doc_id, chunk_id, chunk_index,
				content_hash, ctime, mtime, embedding,
				embedding_model, embedding_len
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);
		const result = insertStmt.run(
			embedding.id,
			embedding.doc_id,
			embedding.chunk_id,
			embedding.chunk_index,
			embedding.content_hash,
			embedding.ctime,
			embedding.mtime,
			embedding.embedding,
			embedding.embedding_model,
			embedding.embedding_len
		);
		return result.lastInsertRowid as number;
	}

	/**
	 * Update existing embedding record by id.
	 * 通过 ID 更新现有的嵌入记录。
	 */
	async updateById(id: string, updates: {
		doc_id: string;
		chunk_id: string | null;
		chunk_index: number | null;
		content_hash: string;
		mtime: number;
		embedding: Buffer;
		embedding_model: string;
		embedding_len: number;
	}): Promise<void> {
		await this.db
			.updateTable('embedding')
			.set(updates)
			.where('id', '=', id)
			.execute();
	}

	/**
	 * Upsert an embedding record: handles both the primary persistence table and 
	 * the `vec_embeddings` virtual table for high-performance indexing.
	 * 
	 * 更新或插入嵌入记录：处理主持久化表和用于高性能索引的 `vec_embeddings` 虚拟表。
	 *
	 * Also syncs the embedding vector to vec_embeddings virtual table for KNN search.
	 * vec_embeddings.rowid corresponds to embedding table's implicit rowid (integer).
	 * This allows direct association: we get embedding.rowid after insert, then use it as vec_embeddings.rowid.
	 * 
	 * 还会将嵌入向量同步到 vec_embeddings 虚拟表以进行 KNN 搜索。
	 * vec_embeddings.rowid 对应于 embedding 表的隐式 rowid（整数）。
	 * 这允许直接关联：我们在插入后获得 embedding.rowid，然后将其用作 vec_embeddings.rowid。
	 */
	async upsert(embedding: {
		id: string;
		doc_id: string;
		chunk_id?: string | null;
		chunk_index?: number | null;
		path?: string | null;
		content_hash: string;
		ctime: number;
		mtime: number;
		embedding: number[]; // Accept number[] directly, convert to BLOB for storage | 直接接受 number[]，转换为 BLOB 进行存储
		embedding_model: string;
		embedding_len: number;
	}): Promise<void> {
		// Convert number[] to Buffer (BLOB)
		const embeddingBuffer = this.arrayToBuffer(embedding.embedding);

		const exists = await this.existsById(embedding.id);

		let embeddingRowid: number;
		if (exists) {
			// Update existing embedding
			embeddingRowid = this.getEmbeddingRowid(embedding.id)!;
			await this.updateById(embedding.id, {
				doc_id: embedding.doc_id,
				chunk_id: embedding.chunk_id ?? null,
				chunk_index: embedding.chunk_index ?? null,
				content_hash: embedding.content_hash,
				mtime: embedding.mtime,
				embedding: embeddingBuffer,
				embedding_model: embedding.embedding_model,
				embedding_len: embedding.embedding_len,
			});
		} else {
			// Insert new embedding
			embeddingRowid = await this.insert({
				id: embedding.id,
				doc_id: embedding.doc_id,
				chunk_id: embedding.chunk_id ?? null,
				chunk_index: embedding.chunk_index ?? null,
				content_hash: embedding.content_hash,
				ctime: embedding.ctime,
				mtime: embedding.mtime,
				embedding: embeddingBuffer,
				embedding_model: embedding.embedding_model,
				embedding_len: embedding.embedding_len,
			});
		}

		// Sync to vec_embeddings virtual table using embedding.rowid as vec_embeddings.rowid
		// vec0 virtual table stores vectors as float[], we pass the same BLOB buffer
		// This avoids JSON serialization/deserialization overhead
		// Note: vec_embeddings requires sqlite-vec extension to be loaded
		// Virtual tables don't support UPSERT, so we need to DELETE then INSERT

		const embeddingDimension = embedding.embedding.length;

		// Ensure table exists with correct dimension
		this.ensureVecEmbeddingsTable(embeddingDimension);

		try {
			this.syncToVecEmbeddings(embeddingRowid, embeddingBuffer);
		} catch (error) {
			this.handleSyncError(error, embeddingRowid, embeddingBuffer, embeddingDimension);
		}
	}

	/**
	 * Get embedding by ID.
	 */
	async getById(id: string): Promise<DbSchema['embedding'] | null> {
		const row = await this.db.selectFrom('embedding').selectAll().where('id', '=', id).executeTakeFirst();
		return row ?? null;
	}

	/**
	 * Get embeddings by file ID.
	 */
	async getByDocId(docId: string): Promise<DbSchema['embedding'][]> {
		return await this.db.selectFrom('embedding').selectAll().where('doc_id', '=', docId).execute();
	}

	/**
	 * Get embeddings by IDs (batch).
	 * Used to fetch embedding records by their primary key (id).
	 * Returns embedding as Buffer (BLOB format).
	 */
	async getByIds(ids: string[]): Promise<Array<{ id: string; doc_id: string; chunk_id: string; embedding: Buffer }>> {
		if (!ids.length) return [];
		const rows = await this.db
			.selectFrom('embedding')
			.select(['id', 'doc_id', 'chunk_id', 'embedding'])
			.where('id', 'in', ids)
			.where('chunk_id', 'is not', null)
			.execute();
		return rows.filter((r): r is { id: string; doc_id: string; chunk_id: string; embedding: Buffer } => r.chunk_id != null);
	}

	/**
	 * Get embeddings by chunk IDs (batch).
	 * Returns embedding as Buffer (BLOB format).
	 */
	async getByChunkIds(chunkIds: string[]): Promise<Array<{ id: string; doc_id: string; chunk_id: string; embedding: Buffer }>> {
		if (!chunkIds.length) return [];
		const rows = await this.db
			.selectFrom('embedding')
			.select(['id', 'doc_id', 'chunk_id', 'embedding'])
			.where('chunk_id', 'in', chunkIds)
			.execute();
		return rows.filter((r): r is { id: string; doc_id: string; chunk_id: string; embedding: Buffer } => r.chunk_id != null);
	}

	async searchSimilarAndGetId(
		queryEmbedding: number[] | Buffer,
		limit: number,
		scopeMode?: SearchScopeMode,
		scopeValue?: SearchScopeValue,
	): Promise<Array<
		{ id: string; doc_id: string; chunk_id: string; embedding: Buffer, distance: number; similarity: number }
	>> {
		// Perform semantic search
		const searchResults = this.searchSimilar(queryEmbedding, limit, scopeMode, scopeValue);
		if (!searchResults.length) {
			return [];
		}
		// embedding_id -> distance
		const distanceMap = new Map<string, number>();
		for (const result of searchResults) {
			distanceMap.set(result.embedding_id, result.distance);
		}

		// Get embeddings by their IDs to find corresponding doc_ids
		const embeddingRows = await this.getByIds(searchResults.map(r => r.embedding_id));

		return embeddingRows.map(row => {
			const embeddingId = row.id
			const distance = distanceMap.get(embeddingId) ?? Number.MAX_SAFE_INTEGER;
			return {
				...row,
				distance,
				// Convert distance to similarity score: 1 / (1 + distance)
				similarity: 1 / (1 + distance),
			};
		});
	}

	/**
	 * Vector similarity search using sqlite-vec KNN search.
	 * 使用 sqlite-vec KNN 搜索执行向量相似性搜索。
	 * 
	 * This uses the vec0 virtual table with MATCH operator for efficient KNN search
	 * without loading all embeddings into memory.
	 * 
	 * 此方法使用带有 MATCH 操作符的 vec0 虚拟表进行高效的 KNN 搜索，而无需将所有嵌入加载到内存中。
	 * 
	 * [Architecture Note]
	 * We share the `rowid` between the primary table and the vector index table to avoid
	 * complex string-based joins during the high-performance search phase.
	 * 
	 * [架构说明]
	 * 我们在主表和向量索引表之间共享 `rowid`，以避免在高性能搜索阶段进行复杂的基于字符串的连接。
	 * 
	 * @param queryEmbedding The query embedding vector (as number[] or Buffer) | 查询嵌入向量
	 * @param limit Maximum number of results to return | 最大返回结果数
	 * @returns Array of results with embedding_id (from embedding table) and distance | 包含嵌入 ID 和距离的数组
	 */
	searchSimilar(
		queryEmbedding: number[] | Buffer,
		limit: number,
		scopeMode?: SearchScopeMode,
		scopeValue?: SearchScopeValue,
	): Array<{
		embedding_id: string;
		distance: number;
	}> {
		const checkStmt = this.rawDb.prepare(`
			SELECT name FROM sqlite_master 
			WHERE type='table' AND name='vec_embeddings'
		`);
		const result = checkStmt.get();
		if (!result) {
			throw new BusinessError(
				ErrorCode.VEC_EMBEDDINGS_TABLE_MISSING,
				'vec_embeddings virtual table does not exist. Vector similarity search requires sqlite-vec extension. ' +
				'Please ensure sqlite-vec is installed (npm install sqlite-vec) and the extension is loaded during database initialization.',
			);
		}

		// Convert to Buffer if needed (BLOB format for float[])
		const embeddingBuffer = Buffer.isBuffer(queryEmbedding)
			? queryEmbedding
			: this.arrayToBuffer(queryEmbedding);

		// Build path filter condition based on scope
		let pathFilter = '';
		const pathParams: string[] = [];

		if (scopeMode === 'inFile' && scopeValue?.currentFilePath) {
			pathFilter = 'AND dm.path = ?';
			pathParams.push(scopeValue.currentFilePath);
		} else if (scopeMode === 'inFolder' && scopeValue?.folderPath) {
			const folderPath = scopeValue.folderPath;
			pathFilter = 'AND (dm.path = ? OR dm.path LIKE ?)';
			pathParams.push(folderPath, `${folderPath}/%`);
		} else if (scopeMode === 'limitIdsSet' && scopeValue?.limitIdsSet) {
			pathFilter = 'AND e.id IN ?';
			pathParams.push((Array.from(scopeValue.limitIdsSet ?? [])).join(',') ?? '');
		}

		// Step 1: KNN search on vec_embeddings with JOIN to embedding and doc_meta tables for path filtering
		// Returns vec_embeddings.rowid (integer) and distance
		// vec_embeddings.rowid = embedding.rowid
		// vec0 MATCH operator accepts BLOB format for float[]
		// We JOIN embedding and doc_meta tables to filter by path before limiting results
		// Note: sqlite-vec requires 'k = ?' constraint in WHERE clause for KNN queries
		// todo we may need to avoid this join query due to performance issue.
		const sql = `
			SELECT
				ve.rowid,
				ve.distance
			FROM vec_embeddings ve
			INNER JOIN embedding e ON ve.rowid = e.rowid
			INNER JOIN doc_meta dm ON e.doc_id = dm.id
			WHERE ve.embedding MATCH ?
				AND k = ?
			${pathFilter}
			ORDER BY ve.distance
		`;
		const knnStmt = this.rawDb.prepare(sql);
		const knnResults = knnStmt.all(embeddingBuffer, limit, ...pathParams) as Array<{
			rowid: number;
			distance: number;
		}>;

		if (!knnResults.length) {
			return [];
		}

		// Step 2: Batch lookup embedding table to get embedding.id from rowid
		const rowids = knnResults.map((r) => r.rowid);
		const embeddingStmt = this.rawDb.prepare(`
			SELECT rowid, id FROM embedding
			WHERE rowid IN (${rowids.map(() => '?').join(',')})
		`);
		const embeddings = embeddingStmt.all(...rowids) as Array<{
			rowid: number;
			id: string;
		}>;

		// Create map: rowid -> embedding.id
		const rowidToEmbeddingId = new Map(embeddings.map((e) => [e.rowid, e.id]));

		// Combine results
		return knnResults
			.map((r) => {
				const embeddingId = rowidToEmbeddingId.get(r.rowid);
				return embeddingId
					? {
						embedding_id: embeddingId,
						distance: r.distance,
					}
					: null;
			})
			.filter((r): r is { embedding_id: string; distance: number } => r !== null);
	}

	/**
	 * Get embeddings for multiple documents in a single query.
	 * 在单次查询中获取多个文档的嵌入。
	 * 
	 * @returns Map where keys are doc IDs and values are arrays of embedding records. | 以文档 ID 为键、嵌入记录数组为值的映射。
	 */
	async getByDocIds(docIds: string[]): Promise<Map<string, DbSchema['embedding'][]>> {
		if (!docIds.length) return new Map();
		const rows = await this.db.selectFrom('embedding').selectAll().where('doc_id', 'in', docIds).execute();
		const result = new Map<string, DbSchema['embedding'][]>();
		for (const row of rows) {
			const arr = result.get(row.doc_id) ?? [];
			arr.push(row);
			result.set(row.doc_id, arr);
		}
		return result;
	}

	/**
	 * Fetches the embedding record for a specific text chunk.
	 * 获取特定文本分块的嵌入记录。
	 */
	async getByChunkId(chunkId: string): Promise<DbSchema['embedding'] | null> {
		const row = await this.db.selectFrom('embedding').selectAll().where('chunk_id', '=', chunkId).executeTakeFirst();
		return row ?? null;
	}

	/**
	 * Looks up an embedding by its content hash to optimize indexing.
	 * 通过其内容哈希查找嵌入，以优化索引过程。
	 */
	async getByContentHash(contentHash: string): Promise<DbSchema['embedding'] | null> {
		const row = await this.db.selectFrom('embedding').selectAll().where('content_hash', '=', contentHash).executeTakeFirst();
		return row ?? null;
	}
		return row ?? null;
	}

	/**
	 * Delete embeddings by file ID.
	 */
	async deleteByDocId(docId: string): Promise<void> {
		await this.db.deleteFrom('embedding').where('doc_id', '=', docId).execute();
	}

	/**
	 * Delete embeddings by doc IDs (batch).
	 */
	async deleteByDocIds(docIds: string[]): Promise<void> {
		if (!docIds.length) return;
		await this.db.deleteFrom('embedding').where('doc_id', 'in', docIds).execute();
	}

	/**
	 * Delete all embeddings.
	 */
	async deleteAll(): Promise<void> {
		await this.db.deleteFrom('embedding').execute();
	}

	/**
	 * Delete embedding by ID.
	 */
	async deleteById(id: string): Promise<void> {
		await this.db.deleteFrom('embedding').where('id', '=', id).execute();
	}

	/**
	 * Delete embeddings by IDs (batch).
	 */
	async deleteByIds(ids: string[]): Promise<void> {
		if (!ids.length) return;
		await this.db.deleteFrom('embedding').where('id', 'in', ids).execute();
	}

	/**
	 * Computes the global mean semantic embedding vector for a document (Global Mean Pooling).
	 *
	 * [Mathematical Principle & Representational Power]
	 * This method operates under the "semantic centroid" assumption: in vector space, the arithmetic mean of a set of vectors represents their geometric centroid.
	 * When a document's theme is highly coherent (such as a single-topic technical doc or focused essay), this mean vector effectively captures and compresses the document's essential theme,
	 * providing a single, summary-level vector fingerprint for the document.
	 *
	 * [Semantic Dilution Risk]
	 * For long or heterogeneous documents containing multiple unrelated semantic centers, averaging can cause "semantic collapse."
	 * The resulting mean vector may fall in a region of vector space that doesn't exist in reality, significantly reducing retrieval accuracy.
	 *   Common failure cases:
	 *   1. Extreme topic shifts: If the first half discusses "pasta recipes" and the second half "Java multithreading," the mean vector drifts to a noisy space 
	 *      that represents neither cooking nor programming, causing both keyword searches to miss.
	 *   2. Localized key info: In a 5000-word annual report with only a short mention of "company layoffs," the mean dilutes this signal among ordinary content, 
	 *      masking critical features.
	 *   3. Contradictory semantics: Discussing both "extreme heat" and "extreme cold" may yield a mean vector closer to "moderate climate," losing the extremes.
	 *
	 * [Optimization Suggestions] todo implement
	 * 1. Head-Chunk pooling: For overly long documents, compute average on the first N chunks (where title/intro often concentrates core context).
	 * 2. Salience weighting: Use chunk position or IDF to weight the mean.
	 * 3. Multi-center representation: For long/heterogeneous docs, store multiple cluster centroids or raw chunk embeddings instead of a single mean.
	 *
	 * @param docId - Unique document identifier
	 * @returns High-dimensional vector (number[]) representing the document's global semantics, or null if none found
	 */
	async getAverageEmbeddingForDoc(docId: string): Promise<number[] | null> {
		const embeddings = await this.getByDocId(docId);

		if (!embeddings.length) {
			return null;
		}

		const embeddingDim = embeddings[0].embedding_len;
		const averageVector = new Array(embeddingDim).fill(0);

		// Sum all vectors
		for (const embedding of embeddings) {
			const buffer = embedding.embedding;
			for (let i = 0; i < buffer.length; i += 4) {
				const floatValue = buffer.readFloatLE(i);
				averageVector[i / 4] += floatValue;
			}
		}

		// Calculate average
		for (let i = 0; i < averageVector.length; i++) {
			averageVector[i] /= embeddings.length;
		}

		return averageVector;
	}
}

