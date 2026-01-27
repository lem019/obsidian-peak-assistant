import type { Kysely } from 'kysely';
import type { Database as DbSchema } from '../ddl';
import { sql } from 'kysely';

/**
 * Document Metadata Repository
 * 
 * Responsible for managing the `doc_meta` table, which stores high-level 
 * information about every document indexed in the vault (e.g., path, title, 
 * size, modification time, and generated summaries). 
 * This metadata is used to track indexing status and provide quick context 
 * without re-reading the entire file content.
 * 
 * 文档元数据存储库
 * 
 * 负责管理 `doc_meta` 表，该表存储库中每个已索引文档的高层信息
 * （例如：路径、标题、大小、修改时间以及生成的摘要）。
 * 这些元数据用于跟踪索引状态，并在不重新读取整个文件内容的情况下提供快速上下文。
 */
export class DocMetaRepo {
	constructor(private readonly db: Kysely<DbSchema>) {}

	/**
	 * Checks if document metadata exists for a given file path.
	 * 检查给定文件路径是否存在文档元数据。
	 */
	async existsByPath(path: string): Promise<boolean> {
		const row = await this.db
			.selectFrom('doc_meta')
			.select('id')
			.where('path', '=', path)
			.executeTakeFirst();
		return row !== undefined;
	}

	/**
	 * Inserts a new document metadata record.
	 * 插入新的文档元数据记录。
	 */
	async insert(doc: DbSchema['doc_meta']): Promise<void> {
		await this.db
			.insertInto('doc_meta')
			.values(doc)
			.execute();
	}

	/**
	 * Updates specific fields of a document record identified by its ID.
	 * 通过 ID 更新文档记录的特定字段。
	 */
	async updateById(id: string, updates: Partial<Omit<DbSchema['doc_meta'], 'id' | 'path' | 'created_at'>>): Promise<void> {
		await this.db
			.updateTable('doc_meta')
			.set(updates)
			.where('id', '=', id)
			.execute();
	}

	/**
	 * Updates specific fields of a document record identified by its path.
	 * 通过路径更新文档记录的特定字段。
	 */
	async updateByPath(path: string, updates: Partial<Omit<DbSchema['doc_meta'], 'id' | 'path' | 'created_at'>>): Promise<void> {
		await this.db
			.updateTable('doc_meta')
			.set(updates)
			.where('path', '=', path)
			.execute();
	}

	/**
	 * Upserts document metadata.
	 * Performs an update if the path exists, otherwise inserts a new record.
	 * 
	 * 更新或插入文档元数据。
	 * 如果路径存在则执行更新，否则插入新记录。
	 * 
	 * @param doc - Partial metadata including the required path.
	 */
	async upsert(doc: Partial<DbSchema['doc_meta']> & { path: string }): Promise<void> {
		if (!doc.id) {
			throw new Error(`doc.id is required for doc_meta.upsert. Path: ${doc.path}`);
		}

		const exists = await this.existsByPath(doc.path);

		if (exists) {
			// Update using id for precision
			await this.updateById(doc.id, {
				type: doc.type ?? null,
				title: doc.title ?? null,
				size: doc.size ?? null,
				mtime: doc.mtime ?? null,
				ctime: doc.ctime ?? null,
				content_hash: doc.content_hash ?? null,
				summary: doc.summary ?? null,
				tags: doc.tags ?? null,
				last_processed_at: doc.last_processed_at ?? null,
				frontmatter_json: doc.frontmatter_json ?? null,
			});
		} else {
			// Create new entry
			await this.insert({
				id: doc.id,
				path: doc.path,
				type: doc.type ?? null,
				title: doc.title ?? null,
				size: doc.size ?? null,
				mtime: doc.mtime ?? null,
				ctime: doc.ctime ?? null,
				content_hash: doc.content_hash ?? null,
				summary: doc.summary ?? null,
				tags: doc.tags ?? null,
				last_processed_at: doc.last_processed_at ?? null,
				frontmatter_json: doc.frontmatter_json ?? null,
			});
		}
	}

	/**
	 * Deletes metadata for a list of file paths.
	 * 删除一组文件路径的元数据。
	 */
	async deleteByPaths(paths: string[]): Promise<void> {
		if (!paths.length) return;
		await this.db.deleteFrom('doc_meta').where('path', 'in', paths).execute();
	}

	/**
	 * Deletes all document metadata from the store.
	 * 从存储中删除所有文档元数据。
	 */
	async deleteAll(): Promise<void> {
		await this.db.deleteFrom('doc_meta').execute();
	}

	/**
	 * Fetches all indexed paths and their modification times.
	 * Useful for full re-sync checks.
	 * 
	 * 获取所有已索引的路径及其修改时间。适用于完整的重新同步检查。
	 * 
	 * @returns A Map of path to modification timestamp.
	 */
	async getAllIndexedPaths(): Promise<Map<string, number>> {
		const rows = await this.db.selectFrom('doc_meta').select(['path', 'mtime']).execute();
		const result = new Map<string, number>();
		for (const row of rows) {
			const mtime = row.mtime ?? 0;
			result.set(row.path, mtime);
		}
		return result;
	}

	/**
	 * Fetches indexed paths in batches with pagination support.
	 * 支持分页的批量获取已索引路径。
	 */
	async getIndexedPathsBatch(offset: number, limit: number): Promise<Array<{ path: string; mtime: number }>> {
		const rows = await this.db
			.selectFrom('doc_meta')
			.select(['path', 'mtime'])
			.offset(offset)
			.limit(limit)
			.execute();
		return rows.map(row => ({
			path: row.path,
			mtime: row.mtime ?? 0,
		}));
	}

	/**
	 * Batch checks indexing status for multiple paths simultaneously.
	 * 同时批量检查多个路径的索引状态。
	 * 
	 * @returns Map of path to { mtime, content_hash }.
	 */
	async batchCheckIndexed(paths: string[]): Promise<Map<string, { mtime: number; content_hash: string | null }>> {
		if (!paths.length) return new Map();
		const rows = await this.db
			.selectFrom('doc_meta')
			.select(['path', 'mtime', 'content_hash'])
			.where('path', 'in', paths)
			.execute();
		const result = new Map<string, { mtime: number; content_hash: string | null }>();
		for (const row of rows) {
			const mtime = row.mtime ?? 0;
			result.set(row.path, {
				mtime,
				content_hash: row.content_hash ?? null,
			});
		}
		return result;
	}

	/**
	 * Retrieves complete metadata for a single path.
	 * 检索单个路径的完整元数据。
	 */
	async getByPath(path: string): Promise<DbSchema['doc_meta'] | null> {
		const row = await this.db.selectFrom('doc_meta').selectAll().where('path', '=', path).executeTakeFirst();
		return row ?? null;
	}

	/**
	 * Batched retrieval of metadata for multiple paths.
	 * 批量检索多个路径的元数据。
	 */
	async getByPaths(paths: string[]): Promise<Map<string, DbSchema['doc_meta']>> {
		if (!paths.length) return new Map();
		const rows = await this.db.selectFrom('doc_meta').selectAll().where('path', 'in', paths).execute();
		const result = new Map<string, DbSchema['doc_meta']>();
		for (const row of rows) {
			result.set(row.path, row);
		}
		return result;
	}

	/**
	 * Fetches document IDs associated with a list of paths.
	 * 获取与路径列表关联的文档 ID。
	 */
	async getIdsByPaths(paths: string[]): Promise<{ id: string, path: string }[]> {
		if (!paths.length) return [];
		const rows = await this.db
			.selectFrom('doc_meta')
			.select(['id', 'path'])
			.where('path', 'in', paths)
			.execute();
		return rows.map(row => ({ id: row.id, path: row.path }));
	}

	/**
	 * Fetches metadata for a list of document IDs.
	 * 获取文档 ID 列表的元数据。
	 */
	async getByIds(ids: string[]): Promise<DbSchema['doc_meta'][]> {
		if (!ids.length) return [];
		return await this.db.selectFrom('doc_meta').selectAll().where('id', 'in', ids).execute();
	}

	/**
	 * Finds documents matching a specific content hash.
	 * 查找匹配特定内容哈希的文档。
	 */
	async getByContentHash(contentHash: string): Promise<DbSchema['doc_meta'][]> {
		return await this.db.selectFrom('doc_meta').selectAll().where('content_hash', '=', contentHash).execute();
	}

	/**
	 * Efficiently checks which hashes in a list are already present in the database.
	 * 高效地检查列表中的哪些哈希已存在于数据库中。
	 * 
	 * @returns A Set of existing content hashes.
	 */
	async batchGetByContentHashes(contentHashes: string[]): Promise<Set<string>> {
		if (!contentHashes.length) return new Set();
		const rows = await this.db
			.selectFrom('doc_meta')
			.select(['content_hash'])
			.where('content_hash', 'in', contentHashes)
			.where('content_hash', 'is not', null)
			.execute();
		return new Set(rows.map(row => row.content_hash!).filter(Boolean));
	}
}


