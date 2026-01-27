import type { Kysely } from 'kysely';
import type { Database as DbSchema } from '../ddl';
import type { SqliteDatabase } from '../types';
import type { DocChunkInput, DocChunkOutput, FtsInsertParams, FtsMetaInsertParams, FtsSearchResult } from './types';
import type { SearchScopeMode, SearchScopeValue } from '@/service/search/types';

/**
 * Document Chunk Repository
 * 
 * Manages the `doc_chunk` table (permanent storage for text segments) and the 
 * `doc_fts` virtual table (Full-Text Search). This repository is responsible for 
 * splitting documents into searchable pieces, storing them, and performing 
 * high-performance text searches using SQLite's FTS5 extension.
 * 
 * 文档分块存储库
 * 
 * 管理 `doc_chunk` 表（文本段的永久存储）和 `doc_fts` 虚拟表（全文搜索）。
 * 此存储库负责将文档拆分为可搜索的代码片段、存储它们，并使用 SQLite 的 
 * FTS5 扩展执行高性能文本搜索。
 */
export class DocChunkRepo {
	constructor(
		private readonly db: Kysely<DbSchema>,
		private readonly rawDb: SqliteDatabase, // Used for FTS raw SQL operations | 用于 FTS 的原始 SQL 操作
	) {}

	/**
	 * Deletes all chunks associated with a specific document ID.
	 * 删除与特定文档 ID 关联的所有分块。
	 */
	async deleteByDocId(docId: string): Promise<void> {
		await this.db.deleteFrom('doc_chunk').where('doc_id', '=', docId).execute();
	}

	/**
	 * Batched deletion of chunks for multiple document IDs.
	 * 批量删除多个文档 ID 的分块。
	 */
	async deleteByDocIds(docIds: string[]): Promise<void> {
		if (!docIds.length) return;
		await this.db.deleteFrom('doc_chunk').where('doc_id', 'in', docIds).execute();
	}

	/**
	 * Deletes all chunks from the `doc_chunk` table.
	 * 从 `doc_chunk` 表中删除所有分块。
	 */
	async deleteAll(): Promise<void> {
		await this.db.deleteFrom('doc_chunk').execute();
	}

	/**
	 * Deletes Full-Text Search index entries for a document.
	 * 删除文档的全文搜索索引条目。
	 */
	deleteFtsByDocId(docId: string): void {
		const stmt = this.rawDb.prepare(`DELETE FROM doc_fts WHERE doc_id = ?`);
		stmt.run(docId);
	}

	/**
	 * Batched deletion of FTS index entries.
	 * 批量删除 FTS 索引条目。
	 */
	deleteFtsByDocIds(docIds: string[]): void {
		if (!docIds.length) return;
		const stmt = this.rawDb.prepare(`DELETE FROM doc_fts WHERE doc_id IN (${docIds.map(() => '?').join(',')})`);
		stmt.run(...docIds);
	}

	/**
	 * Removes document-level metadata (title/path) from the FTS search index.
	 * 从 FTS 搜索索引中移除文档级元数据（标题/路径）。
	 */
	deleteMetaFtsByDocId(docId: string): void {
		const stmt = this.rawDb.prepare(`DELETE FROM doc_meta_fts WHERE doc_id = ?`);
		stmt.run(docId);
	}

	/**
	 * Batched removal of metadata from the FTS index.
	 * 批量从 FTS 索引中移除元数据。
	 */
	deleteMetaFtsByDocIds(docIds: string[]): void {
		if (!docIds.length) return;
		const stmt = this.rawDb.prepare(`DELETE FROM doc_meta_fts WHERE doc_id IN (${docIds.map(() => '?').join(',')})`);
		stmt.run(...docIds);
	}

	/**
	 * Synchronously clears the content-based Full-Text Search index.
	 * 同步清除基于内容的全文搜索索引。
	 */
	deleteAllFts(): void {
		const stmt = this.rawDb.prepare(`DELETE FROM doc_fts`);
		stmt.run();
	}

	/**
	 * Synchronously clears the metadata-based Full-Text Search index.
	 * 同步清除基于元数据的全文搜索索引。
	 */
	deleteAllMetaFts(): void {
		const stmt = this.rawDb.prepare(`DELETE FROM doc_meta_fts`);
		stmt.run();
	}

	/**
	 * Inserts a text segment into the content-based FTS index.
	 * 向基于内容的 FTS 索引插入文本段。
	 */
	insertFts(params: FtsInsertParams): void {
		const stmt = this.rawDb.prepare(`
			INSERT INTO doc_fts (chunk_id, doc_id, content)
			VALUES (@chunk_id, @doc_id, @content)
		`);
		stmt.run(params);
	}

	/**
	 * Inserts document titles and paths into the metadata-based FTS index 
	 * for quick file name navigation.
	 * 
	 * 向基于元数据的 FTS 索引插入文档标题和路径，以便进行快速文件名导航。
	 */
	insertMetaFts(params: FtsMetaInsertParams): void {
		const stmt = this.rawDb.prepare(`
			INSERT INTO doc_meta_fts (doc_id, path, title)
			VALUES (@doc_id, @path, @title)
		`);
		stmt.run(params);
	}

	/**
	 * Checks if a specific chunk ID is already indexed in permanent storage.
	 * 检查特定分块 ID 是否已在永久存储中索引。
	 */
	async existsByChunkId(chunkId: string): Promise<boolean> {
		const row = await this.db
			.selectFrom('doc_chunk')
			.select('chunk_id')
			.where('chunk_id', '=', chunkId)
			.executeTakeFirst();
		return row !== undefined;
	}

	/**
	 * Inserts a new chunk into the permanent documentation storage.
	 * 向永久文档存储中插入一个新分块。
	 */
	async insert(chunk: DocChunkInput): Promise<void> {
		await this.db
			.insertInto('doc_chunk')
			.values({
				chunk_id: chunk.chunk_id,
				doc_id: chunk.doc_id,
				chunk_index: chunk.chunk_index,
				title: chunk.title,
				mtime: chunk.mtime,
				content_raw: chunk.content_raw,
				content_fts_norm: chunk.content_fts_norm,
			})
			.execute();
	}

	/**
	 * Updates an existing chunk record.
	 * 更新现有的分块记录。
	 */
	async updateByChunkId(chunkId: string, updates: Partial<Pick<DbSchema['doc_chunk'], 'doc_id' | 'chunk_index' | 'title' | 'mtime' | 'content_raw' | 'content_fts_norm'>>): Promise<void> {
		await this.db
			.updateTable('doc_chunk')
			.set(updates)
			.where('chunk_id', '=', chunkId)
			.execute();
	}

	/**
	 * Upserts a chunk: updates if it exists, otherwise inserts.
	 * 更新或插入分块：如果存在则更新，否则插入。
	 */
	async upsertChunk(chunk: DocChunkInput): Promise<void> {
		const exists = await this.existsByChunkId(chunk.chunk_id);

		if (exists) {
			await this.updateByChunkId(chunk.chunk_id, {
				doc_id: chunk.doc_id,
				chunk_index: chunk.chunk_index,
				title: chunk.title,
				mtime: chunk.mtime,
				content_raw: chunk.content_raw,
				content_fts_norm: chunk.content_fts_norm,
			});
		} else {
			await this.insert(chunk);
		}
	}

	/**
	 * Fetches text content for a list of chunk IDs directly from the FTS table.
	 * 直接从 FTS 表中获取一系列分块 ID 的文本内容。
	 */
	async getByChunkIds(chunkIds: string[]): Promise<Array<{
		chunk_id: string;
		doc_id: string;
		title: string | null;
		content_raw: string;
		mtime: number | null;
	}>> {
		if (!chunkIds.length) return [];
		const placeholders = chunkIds.map(() => '?').join(',');
		const stmt = this.rawDb.prepare(`
			SELECT
				f.chunk_id,
				f.doc_id,
				f.content as content_raw,
				NULL as mtime
			FROM doc_fts f
			WHERE f.chunk_id IN (${placeholders})
		`);
		const rows = stmt.all(...chunkIds) as Array<{
			chunk_id: string;
			doc_id: string;
			content_raw: string;
			mtime: number | null;
		}>;
		
		return rows.map(row => ({
			chunk_id: row.chunk_id,
			doc_id: row.doc_id,
			title: null,
			content_raw: row.content_raw,
			mtime: row.mtime,
		}));
	}

	/**
	 * Performs Full-Text Search (keyword matching) across the entire vault or a specific scope.
	 * 在整个库或特定范围内执行全文搜索（关键字匹配）。
	 * 
	 * @param term - The search query term. | 搜索查询词。
	 * @param limit - Max results to return. | 最大返回结果数。
	 * @param scopeMode - Filter mode (e.g., 'inFile', 'inFolder'). | 过滤模式。
	 * @param scopeValue - The value for the scope filter. | 范围过滤的值。
	 * @returns Array of matches with relevance scores (bm25). | 带有相关性评分 (bm25) 的匹配数组。
	 */
	searchFts(
		term: string,
		limit: number,
		scopeMode?: SearchScopeMode,
		scopeValue?: SearchScopeValue,
	): Array<{
		chunkId: string;
		docId: string;
		path: string;
		title: string | null;
		content: string;
		bm25: number;
	}> {
		let pathFilter = '';
		const pathParams: string[] = [];

		// Handle scope filtering
		if (scopeMode === 'inFile' && scopeValue?.currentFilePath) {
			pathFilter = 'AND dm.path = ?';
			pathParams.push(scopeValue.currentFilePath);
		} else if (scopeMode === 'inFolder' && scopeValue?.folderPath) {
			const folderPath = scopeValue.folderPath;
			pathFilter = 'AND (dm.path = ? OR dm.path LIKE ?)';
			pathParams.push(folderPath, `${folderPath}/%`);
		}

		// Execute rank-based FTS query
		const sql = `
			SELECT
				f.chunk_id as chunkId,
				f.doc_id as docId,
				dm.path as path,
				dm.title as title,
				f.content as content,
				bm25(doc_fts) as bm25
			FROM doc_fts f
			INNER JOIN doc_meta dm ON f.doc_id = dm.id
			WHERE doc_fts MATCH ?
			${pathFilter}
			ORDER BY bm25 ASC -- Lower BM25 means higher relevance in SQLite FTS5 | SQLite FTS5 中更低的 BM25 意味着更高的相关性
			LIMIT ?
		`;
		const stmt = this.rawDb.prepare(sql);
		return stmt.all(term, ...pathParams, limit) as Array<{
			chunkId: string;
			docId: string;
			path: string;
			title: string | null;
			content: string;
			bm25: number;
		}>;
	}

	/**
	 * Searches document titles and paths (filename-based keyword search).
	 * 搜索文档标题和路径（基于文件名的关键字搜索）。
	 */
	searchMetaFts(
		term: string,
		limit: number,
		scopeMode?: SearchScopeMode,
		scopeValue?: SearchScopeValue,
	): Array<{
		docId: string;
		path: string;
		title: string | null;
		bm25: number;
	}> {
		let pathFilter = '';
		const pathParams: string[] = [];

		if (scopeMode === 'inFile' && scopeValue?.currentFilePath) {
			pathFilter = 'AND mf.path = ?';
			pathParams.push(scopeValue.currentFilePath);
		} else if (scopeMode === 'inFolder' && scopeValue?.folderPath) {
			const folderPath = scopeValue.folderPath;
			pathFilter = 'AND (mf.path = ? OR mf.path LIKE ?)';
			pathParams.push(folderPath, `${folderPath}/%`);
		}

		const sql = `
			SELECT
				mf.doc_id as docId,
				mf.path as path,
				mf.title as title,
				bm25(doc_meta_fts) as bm25
			FROM doc_meta_fts mf
			WHERE doc_meta_fts MATCH ?
			${pathFilter}
			ORDER BY bm25 ASC
			LIMIT ?
		`;
		const stmt = this.rawDb.prepare(sql);
		return stmt.all(term, ...pathParams, limit) as Array<{
			docId: string;
			path: string;
			title: string | null;
			bm25: number;
		}>;
	}
}

