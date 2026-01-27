/**
 * File-based SQLite store backed by sql.js (WebAssembly-based).
 * 
 * Why sql.js needs WASM:
 * - SQLite is written in C, which cannot run directly in JavaScript
 * - sql.js uses Emscripten to compile SQLite's C code to WebAssembly (WASM)
 * - WASM provides near-native performance in browser/Node.js environments
 * - This is the standard way to run SQLite in JavaScript environments
 * 
 * Advantages:
 * - No native dependencies (no .node files, no compilation needed)
 * - Cross-platform compatible (works on all platforms that support WASM)
 * - Can be bundled into a single file
 * - Full SQLite feature support
 * 
 * Disadvantages:
 * - Slower than native modules (better-sqlite3)
 * - Higher memory usage (loads entire database into memory)
 * - Requires manual save to persist changes to disk
 * - WASM file needs to be loaded at runtime
 * 
 * This is the default implementation for Obsidian plugin marketplace compatibility.
 * 
 * 基于 sql.js（WebAssembly）的文件型 SQLite 存储实现。
 * 
 * 为什么 sql.js 需要 WASM：
 * - SQLite 是用 C 语言编写的，无法直接在 JavaScript 中运行
 * - sql.js 使用 Emscripten 将 SQLite 的 C 代码编译为 WebAssembly (WASM)
 * - WASM 在浏览器/Node.js 环境中提供接近原生的性能
 * - 这是在 JavaScript 环境中运行 SQLite 的标准方式
 * 
 * 优势：
 * - 无原生依赖（无需 .node 文件，无需编译）
 * - 跨平台兼容（适用于所有支持 WASM 的平台）
 * - 可以打包成单个文件
 * - 完整的 SQLite 功能支持
 * 
 * 缺点：
 * - 比原生模块（better-sqlite3）慢
 * - 内存占用较高（将整个数据库加载到内存中）
 * - 需要手动保存才能将更改持久化到磁盘
 * - 运行时需要加载 WASM 文件
 * 
 * 这是为了兼容 Obsidian 插件市场而采用的默认实现。
 */
import { migrateSqliteSchema } from '@/core/storage/sqlite/ddl';
import { Kysely, SqliteQueryCompiler, SqliteIntrospector, SqliteAdapter, type CompiledQuery } from 'kysely';
import type { Database as DbSchema } from '@/core/storage/sqlite/ddl';
import type { SqliteDatabase, SqliteStoreType } from '../types';
import initSqlJs, { Database as SqlJsDatabase, type SqlJsStatic } from 'sql.js';
import * as fs from 'fs';
import * as path from 'path';

// Import inlined WASM binary (provided by esbuild plugin at build time)
// This is a virtual module that esbuild resolves to the actual WASM file
// Use dynamic import to handle both build-time and runtime scenarios
// 导入内联的 WASM 二进制文件（由 esbuild 插件在构建时提供）
// 这是一个虚拟模块，esbuild 会将其解析为实际的 WASM 文件
// 使用动态导入来处理构建时和运行时的场景
let sqlJsWasmBase64: string | undefined;

// Try to import the virtual module (will be resolved by esbuild at build time)
// In CommonJS output, we need to use require, but esbuild should inline it
// 尝试导入虚拟模块（将在构建时由 esbuild 解析）
// 在 CommonJS 输出中，我们需要使用 require，但 esbuild 应该会将其内联
try {
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const wasmModule = require('sqljs-wasm');
	sqlJsWasmBase64 = wasmModule.wasmBase64;
} catch (error) {
	// If virtual module is not available (e.g., in development), we'll try to load from file system
	// This is expected in development mode
	// 如果虚拟模块不可用（例如在开发模式下），我们将尝试从文件系统加载
	// 这在开发模式下是预期的行为
	sqlJsWasmBase64 = undefined;
}

/**
 * Custom SQLite driver that intercepts all execute operations for sql.js.
 * Adapts Kysely's driver interface to sql.js's in-memory execution model.
 * 
 * 定制化 SQLite 驱动，拦截 sql.js 的所有执行操作。
 * 将 Kysely 的驱动接口适配到 sql.js 的内存执行模型。
 */
class CustomSqliteDriver {
	private db: SqlJsDatabase;

	constructor(db: SqlJsDatabase) {
		this.db = db;
	}

	async init(): Promise<void> {}

	/**
	 * Acquires a connection. Since sql.js runs in memory and is single-threaded,
	 * we return a wrapper around the database.
	 * 
	 * 获取连接。由于 sql.js 在内存中运行且是单线程的，我们返回一个数据库的包装器。
	 */
	async acquireConnection(): Promise<{ executeQuery: (query: CompiledQuery) => Promise<any>; streamQuery: (query: CompiledQuery, chunkSize?: number) => AsyncIterableIterator<any> }> {
		return {
			executeQuery: this.executeQuery.bind(this),
			streamQuery: this.streamQuery.bind(this)
		};
	}

	async beginTransaction(): Promise<void> { this.db.run('BEGIN TRANSACTION'); }
	async commitTransaction(): Promise<void> { this.db.run('COMMIT'); }
	async rollbackTransaction(): Promise<void> { this.db.run('ROLLBACK'); }
	async releaseConnection(): Promise<void> {}
	async destroy(): Promise<void> {}

	/**
	 * Executes a compiled query against the in-memory database.
	 * 
	 * 对内存数据库执行编译后的查询。
	 */
	async executeQuery(compiledQuery: CompiledQuery): Promise<any> {
		const { sql, parameters } = compiledQuery;
		const isSelect = sql.trim().toUpperCase().startsWith('SELECT');

		if (isSelect) {
			// For SELECT queries, use exec which returns results
			// 对于 SELECT 查询，使用返回结果的 exec
			const results = parameters && parameters.length > 0
				? this.db.exec(sql, parameters as unknown as any[])
				: this.db.exec(sql);
			if (results.length > 0) {
				return {
					rows: results[0].values.map((row: any[]) => {
						const obj: any = {};
						results[0].columns.forEach((col: string, idx: number) => {
							obj[col] = row[idx];
						});
						return obj;
					}),
					insertId: undefined,
					numAffectedRows: undefined
				};
			} else {
				return {
					rows: [],
					insertId: undefined,
					numAffectedRows: undefined
				};
			}
		} else {
			// For non-SELECT queries, use run
			// 对于非 SELECT 查询，使用 run
			const result = parameters && parameters.length > 0
				? this.db.run(sql, parameters as unknown as any[]) as any
				: this.db.run(sql) as any;
			return {
				rows: [],
				insertId: result.insertId ? BigInt(result.insertId) : undefined,
				numAffectedRows: result.changes ? BigInt(result.changes) : undefined
			};
		}
	}

	/**
	 * Streams a query result by yielding rows in chunks.
	 * 
	 * 通过分块产出行数据来流式传输查询结果。
	 */
	async *streamQuery(compiledQuery: CompiledQuery, chunkSize?: number): AsyncIterableIterator<any> {
		const result = await this.executeQuery(compiledQuery);
		if (result.rows && Array.isArray(result.rows)) {
			if (chunkSize && chunkSize > 0) {
				for (let i = 0; i < result.rows.length; i += chunkSize) {
					const chunk = result.rows.slice(i, i + chunkSize);
					yield { ...result, rows: chunk };
				}
			} else {
				yield result;
			}
		} else {
			yield result;
		}
	}
}

/**
 * Minimal SQLite dialect using our custom driver for sql.js.
 * 
 * 使用自定义驱动实现的 sql.js 最小化 SQLite 方言。
 */
class CustomSqliteDialect {
	private db: SqlJsDatabase;

	constructor(db: SqlJsDatabase) {
		this.db = db;
	}

	createDriver() { return new CustomSqliteDriver(this.db); }
	createQueryCompiler() { return new SqliteQueryCompiler(); }
	createAdapter() { return new SqliteAdapter(); }
	createIntrospector(db: any) { return new SqliteIntrospector(db); }
}

/**
 * File-based SQLite store using sql.js.
 * 
 * This implementation uses sql.js (pure JavaScript SQLite),
 * providing cross-platform compatibility without native dependencies.
 * 
 * Note: sql.js loads the entire database into memory, so for large databases,
 * this may consume significant memory. Changes must be explicitly saved to disk.
 * 
 * 使用 sql.js 的文件型 SQLite 存储。
 * 
 * 该实现使用 sql.js（纯 JavaScript SQLite），提供无需原生依赖的跨平台兼容性。
 * 
 * 注意：sql.js 将整个数据库加载到内存中，因此对于大型数据库，这可能消耗大量内存。
 * 更改必须显式保存到磁盘。
 */
export class SqlJsStore implements SqliteDatabase {
	private db: SqlJsDatabase;
	private dbFilePath: string;
	private kyselyInstance: Kysely<DbSchema>;

	private constructor(db: SqlJsDatabase, dbFilePath: string) {
		this.db = db;
		this.dbFilePath = dbFilePath;

		// Create Kysely instance with custom dialect that intercepts all execute operations
		// 使用拦截所有执行操作的自定义方言创建 Kysely 实例
		this.kyselyInstance = new Kysely<DbSchema>({
			dialect: new CustomSqliteDialect(db),
		});
	}

	/**
	 * Initialize sql.js library.
	 * This loads the WASM module and returns the SQL.js factory.
	 * 
	 * In Obsidian plugin environment, we use inlined WASM binary (from build time)
	 * to avoid Electron's file:// URL restrictions and file system access issues.
	 * 
	 * 初始化 sql.js 库。加载 WASM 模块并返回 SQL.js 工厂对象。
	 * 
	 * 在 Obsidian 插件环境中，我们使用内联的 WASM 二进制文件（构建时产生），
	 * 以避免 Electron 的 file:// URL 限制和文件系统访问问题。
	 * 
	 * @param wasmBinary - Optional WASM binary data (ArrayBuffer). If not provided, will use inlined WASM or try file system.
	 *                     可选的 WASM 二进制数据（ArrayBuffer）。如果未提供，将使用内联 WASM 或尝试从文件系统加载。
	 */
	private static async initSqlJs(wasmBinary?: ArrayBuffer): Promise<SqlJsStatic> {
		if (wasmBinary) {
			// Use provided WASM binary | 使用提供的 WASM 二进制数据
			return await initSqlJs({
				wasmBinary: wasmBinary,
			});
		}
		
		// Priority 1: Use inlined WASM binary (from build time)
		// 优先级 1：使用内联 WASM 二进制数据（构建时产生）
		if (sqlJsWasmBase64) {
			try {
				// Convert Base64 to ArrayBuffer | 将 Base64 转换为 ArrayBuffer
				const binaryString = Buffer.from(sqlJsWasmBase64, 'base64');
				const wasmBinary = new Uint8Array(binaryString).buffer;
				
				console.log('[SqlJsStore] Using inlined WASM binary');
				return await initSqlJs({
					wasmBinary: wasmBinary as ArrayBuffer,
				});
			} catch (error) {
				console.warn('[SqlJsStore] Failed to use inlined WASM, trying file system:', error);
			}
		}
		
		// Priority 2: Try to load WASM file from file system (for development)
		// 优先级 2：尝试从文件系统加载 WASM 文件（用于开发模式）
		try {
			const possiblePaths: string[] = [];
			
			// Try require.resolve if available (works in development)
			// 如果 require.resolve 可用（在开发中有效），则进行尝试
			if (typeof require !== 'undefined' && typeof require.resolve === 'function') {
				try {
					possiblePaths.push(require.resolve('sql.js/dist/sql-wasm.wasm'));
				} catch (e) {
					// require.resolve failed, continue
				}
			}
			
			// Try path relative to current working directory (if node_modules exists)
			// 尝试相对于当前工作目录的路径（如果存在 node_modules）
			if (typeof process !== 'undefined' && process.cwd) {
				const cwd = process.cwd();
				if (cwd && cwd !== '/') {
					possiblePaths.push(path.join(cwd, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'));
				}
			}
			
			// Try to find WASM file in any of the possible paths
			// 在任何可能的路径中搜索 WASM 文件
			for (const wasmPath of possiblePaths) {
				try {
					if (fs.existsSync(wasmPath)) {
						const wasmBuffer = fs.readFileSync(wasmPath);
						const wasmBinary = new Uint8Array(wasmBuffer).buffer;
						
						console.log('[SqlJsStore] Successfully loaded WASM file from:', wasmPath);
						return await initSqlJs({
							wasmBinary: wasmBinary as ArrayBuffer,
						});
					}
				} catch (error) {
					// Try next path
					continue;
				}
			}
			
			// If all paths failed, try default method (will likely fail in Electron)
			// 如果所有路径都失败，尝试默认方法（在 Electron 中可能会失败）
			console.warn('[SqlJsStore] Could not find WASM file in expected locations, trying default method');
			console.warn('[SqlJsStore] Tried paths:', possiblePaths);
			return await initSqlJs({
				// Use default configuration
				// sql.js will try to locate WASM file automatically (may fail in Electron)
			});
		} catch (error) {
			// Fallback: let sql.js try to load WASM automatically
			// This will likely fail in Electron, but worth trying
			console.warn('[SqlJsStore] Failed to load WASM file, trying default method:', error);
			return await initSqlJs({
				// Use default configuration
				// sql.js will try to locate WASM file automatically
			});
		}
	}

	/**
	 * Open a new database connection.
	 * 
	 * 打开一个新的数据库连接。
	 * 
	 * @param params - Database parameters | 数据库参数
	 * @param params.dbFilePath - Path to the SQLite database file | SQLite 数据库文件的路径
	 * @param params.wasmBinary - Optional WASM binary data (ArrayBuffer). If not provided, will try to load from file system.
	 *                            可选的 WASM 二进制数据（ArrayBuffer）。如果未提供，将尝试从文件系统加载。
	 * @returns Promise resolving to SqlJsStore instance | 返回 SqlJsStore 实例的 Promise
	 */
	static async open(params: { dbFilePath: string; wasmBinary?: ArrayBuffer }): Promise<SqlJsStore> {
		// Initialize sql.js with optional WASM binary | 使用可选的 WASM 二进制数据初始化 sql.js
		const SQL = await SqlJsStore.initSqlJs(params.wasmBinary);
		
		// Load existing database or create new one | 加载现有数据库或创建新数据库
		let db: SqlJsDatabase;
		if (fs.existsSync(params.dbFilePath)) {
			try {
				const buffer = fs.readFileSync(params.dbFilePath);
				db = new SQL.Database(buffer);
			} catch (error) {
				console.warn('[SqlJsStore] Failed to load existing database, creating new one:', error);
				db = new SQL.Database();
			}
		} else {
			// Create new database | 创建新数据库
			db = new SQL.Database();
		}

		// Enable foreign keys | 启用外键约束
		db.run('PRAGMA foreign_keys = ON');

		// Set busy timeout to prevent infinite blocking on locked database
		// When database is locked (e.g., concurrent read/write operations),
		// operations will fail after 5 seconds instead of blocking indefinitely
		// 设置繁忙超时时间，防止在数据库锁定时无限期阻塞。
		// 当数据库锁定（例如并发读写操作）时，操作将在 5 秒后失败，而不是无限期等待。
		db.run('PRAGMA busy_timeout = 5000');

		console.log('[SqlJsStore] Set busy_timeout to 5000ms');

		// Note: sql.js (WASM) does not support loading SQLite extensions like sqlite-vec
		// Vector similarity search will not be available when using sql.js backend
		// 注意：sql.js (WASM) 不支持加载 sqlite-vec 等 SQLite 扩展。
		// 使用 sql.js 后端时，向量相似度搜索将不可用。
		// To enable vector search, use better-sqlite3 backend instead
		console.warn(
			'[SqlJsStore] sql.js backend does not support SQLite extensions. ' +
			'vec_embeddings virtual table and vector similarity search will not be available. ' +
			'To enable vector search, use better-sqlite3 backend (set sqliteBackend to "better-sqlite3" in settings).'
		);

		// Run migrations directly with db (has exec method)
		migrateSqliteSchema(db);

		return new SqlJsStore(db, params.dbFilePath);
	}

	/**
	 * Save the database to disk.
	 * 
	 * sql.js keeps the database in memory, so changes must be explicitly saved.
	 * This method writes the current state to the file.
	 * 
	 * @param force - If true, save even if no changes were made
	 */
	save(force: boolean = false): void {
		if (!this.db) {
			throw new Error('Database is closed');
		}

		try {
			// Ensure directory exists
			const dir = path.dirname(this.dbFilePath);
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}

			// Write database to file
			const data = this.db.export();
			fs.writeFileSync(this.dbFilePath, Buffer.from(data));
		} catch (error) {
			console.error('[SqlJsStore] Failed to save database:', error);
			throw error;
		}
	}

	/**
	 * Close the database connection with save option.
	 *
	 * Note: This will save the database to disk before closing, unless it's an in-memory database.
	 *
	 * @param saveBeforeClose - If true, save before closing (default: true)
	 */
	closeWithSave(saveBeforeClose: boolean = true): void {
		if (this.db) {
			// Don't save in-memory databases
			if (saveBeforeClose && this.dbFilePath !== ':memory:') {
				this.save();
			}
			this.db.close();
			this.db = null as any;
		}
	}

	/**
	 * Check if the database is open.
	 */
	isOpen(): boolean {
		return this.db !== null;
	}


	exec(sql: string): void {
		this.db.run(sql);
	}

	prepare(sql: string): any {
		return this.db.prepare(sql);
	}

	kysely<T = DbSchema>(): Kysely<T> {
		// This cast is safe because kyselyInstance is created with DbSchema.
		// For full type-safety, callers should only use the default type parameter.
		return this.kyselyInstance as unknown as Kysely<T>;
	}

	close(): void {
		this.closeWithSave(true);
	}

	databaseType(): SqliteStoreType {
		return 'sql.js';
	}
}

