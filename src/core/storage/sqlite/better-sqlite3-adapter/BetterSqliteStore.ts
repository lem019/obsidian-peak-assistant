/**
 * File-based SQLite store backed by better-sqlite3 (native module).
 * 
 * Advantages:
 * - Native performance, no WASM overhead
 * - Synchronous API, no async/sync bridging needed
 * - Mature and stable
 * 
 * Requirements:
 * - better-sqlite3 must be installed in node_modules
 * - Native module (.node file) must be available at runtime
 * 
 * 基于 better-sqlite3（原生模块）的文件型 SQLite 存储实现。
 * 
 * 优势：
 * - 原生性能，无 WASM 开销
 * - 同步 API，无需异步/同步桥接
 * - 成熟且稳定
 * 
 * 要求：
 * - better-sqlite3 必须安装在 node_modules 中
 * - 运行时必须提供原生模块（.node 文件）
 */
import { migrateSqliteSchema } from '@/core/storage/sqlite/ddl';
import { Kysely, SqliteIntrospector, SqliteQueryCompiler, SqliteAdapter, type CompiledQuery } from 'kysely';
import type { Database as DbSchema } from '@/core/storage/sqlite/ddl';
import type { App } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import type { SqliteDatabase, SqliteStoreType } from '../types';

/**
 * Custom SQLite driver that intercepts all execute operations.
 * Adapts Kysely's driver interface to better-sqlite3's synchronous API.
 * 
 * 定制化 SQLite 驱动，拦截所有执行操作。
 * 将 Kysely 的驱动接口适配到 better-sqlite3 的同步 API。
 */
class CustomSqliteDriver {
	private adapter: { exec: (sql: string) => void; prepare: (sql: string) => any };

	constructor(adapter: { exec: (sql: string) => void; prepare: (sql: string) => any }) {
		this.adapter = adapter;
	}

	async init(): Promise<void> { }

	/**
	 * Acquires a connection. Since better-sqlite3 is synchronous and single-threaded
	 * within a process, we simply return a wrapper around the adapter.
	 * 
	 * 获取连接。由于 better-sqlite3 是同步且在进程内单线程的，
	 * 我们只需返回一个包装了适配器的对象。
	 */
	async acquireConnection(): Promise<{ executeQuery: (query: CompiledQuery) => Promise<any>; streamQuery: (query: CompiledQuery, chunkSize?: number) => AsyncIterableIterator<any> }> {
		return {
			executeQuery: this.executeQuery.bind(this),
			streamQuery: this.streamQuery.bind(this)
		};
	}

	async beginTransaction(): Promise<void> { this.adapter.exec('BEGIN TRANSACTION'); }
	async commitTransaction(): Promise<void> { this.adapter.exec('COMMIT'); }
	async rollbackTransaction(): Promise<void> { this.adapter.exec('ROLLBACK'); }
	async releaseConnection(): Promise<void> { }
	async destroy(): Promise<void> { }

	/**
	 * Executes a compiled query against the database.
	 * Handles both SELECT (returning rows) and non-SELECT (returning metadata).
	 * 
	 * 对数据库执行编译后的查询。
	 * 同时处理 SELECT（返回行）和非 SELECT（返回元数据）操作。
	 */
	async executeQuery(compiledQuery: CompiledQuery): Promise<any> {
		const { sql, parameters } = compiledQuery;
		const stmt = this.adapter.prepare(sql);
		let result: any;

		if (parameters && parameters.length > 0) {
			const isSelect = sql.trim().toUpperCase().startsWith('SELECT');
			if (isSelect) {
				result = stmt.all(...parameters);
			} else {
				result = stmt.run(...parameters);
			}
		} else {
			const isSelect = sql.trim().toUpperCase().startsWith('SELECT');
			if (isSelect) {
				result = stmt.all();
			} else {
				result = stmt.run();
			}
		}

		// Format result according to Kysely's driver interface expectations
		// 根据 Kysely 的驱动接口预期格式化结果
		if (Array.isArray(result)) {
			return {
				rows: result,
				insertId: undefined,
				numAffectedRows: undefined
			};
		} else {
			return {
				rows: [],
				// lastInsertRowid is used for INSERT operations | lastInsertRowid 用于插入操作
				insertId: result.lastInsertRowid ? BigInt(result.lastInsertRowid) : undefined,
				// changes is used for UPDATE/DELETE operations | changes 用于更新/删除操作
				numAffectedRows: result.changes ? BigInt(result.changes) : undefined
			};
		}
	}

	/**
	 * Streams a query result. Implemented as a basic async iterator over the rows.
	 * 
	 * 流式查询结果。实现为对行进行的简单异步迭代。
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
 * Custom Kysely dialect for better-sqlite3.
 * Configures the query compiler and driver for SQLite compatibility.
 * 
 * 用于 better-sqlite3 的自定义 Kysely 方言。
 * 配置查询编译器和驱动程序以实现 SQLite 兼容性。
 */
class CustomSqliteDialect {
	private db: BetterSqlite3Database;

	constructor(db: BetterSqlite3Database) {
		this.db = db;
	}

	createDriver() {
		return new CustomSqliteDriver({
			exec: (sql: string) => this.db.exec(sql),
			prepare: (sql: string) => this.db.prepare(sql)
		});
	}

	createQueryCompiler() { return new SqliteQueryCompiler(); }
	createAdapter() { return new SqliteAdapter(); }
	createIntrospector(db: any) { return new SqliteIntrospector(db); }
}

// Don't import better-sqlite3 at the top level - load it dynamically to avoid module resolution errors
// 不要在顶层导入 better-sqlite3 - 动态加载以避免模块解析错误

/**
 * Type definition for better-sqlite3 Database.
 * We don't import it at the top level to avoid module resolution errors.
 * 
 * better-sqlite3 数据库的类型定义。
 * 我们不在顶层导入它，以避免模块解析错误。
 */
type BetterSqlite3Database = {
	exec(sql: string): void;
	prepare(sql: string): any;
	pragma(sql: string): any;
	close(): void;
	open: boolean;
	loadExtension?(path: string): void;
};

/**
 * File-based SQLite store using better-sqlite3.
 * 
 * This implementation uses better-sqlite3's native SQLite bindings,
 * providing better performance than WebAssembly-based solutions.
 * 
 * Note: better-sqlite3 is loaded dynamically to avoid module resolution errors
 * in Obsidian plugin environment.
 * 
 * 使用 better-sqlite3 的文件型 SQLite 存储。
 * 
 * 该实现使用 better-sqlite3 的原生 SQLite 绑定，
 * 提供比 WebAssembly 方案更好的性能。
 * 
 * 注意：better-sqlite3 是动态加载的，以避免在 Obsidian 插件环境中出现模块解析错误。
 */
export class BetterSqliteStore implements SqliteDatabase {
	private db: BetterSqlite3Database;
	private kyselyInstance: Kysely<DbSchema>;

	// Cache for better-sqlite3 module if successfully loaded
	// 如果成功加载，缓存 better-sqlite3 模块
	private static cachedBetterSqlite3: typeof import('better-sqlite3') | null = null;

	private constructor(db: BetterSqlite3Database) {
		this.db = db;

		// Create Kysely instance with custom dialect that intercepts all execute operations
		// 使用自定义方言创建 Kysely 实例，拦截所有执行操作
		this.kyselyInstance = new Kysely<DbSchema>({
			dialect: new CustomSqliteDialect(db),
		});
	}

	/**
	 * Check if better-sqlite3 is available and working.
	 * 
	 * Note: In Obsidian (Electron) environment, better-sqlite3 may fail to load
	 * if the native module (.node file) is not compatible with Electron's Node.js version.
	 * 
	 * 检查 better-sqlite3 是否可用并正常工作。
	 * 
	 * 注意：在 Obsidian (Electron) 环境中，如果原生模块（.node 文件）
	 * 与 Electron 的 Node.js 版本不兼容，better-sqlite3 可能无法加载。
	 * 
	 * @param app - Obsidian app instance (optional, used for vault path resolution)
	 * @returns Promise resolving to true if better-sqlite3 is available and working
	 */
	static async checkAvailable(app?: App): Promise<boolean> {
		try {
			let betterSqlite3;

			// Strategy 1: Try normal require (works if node_modules is in require path)
			// 策略 1：尝试标准 require（如果 node_modules 在 require 路径中则有效）
			try {
				betterSqlite3 = require('better-sqlite3');
			} catch (requireError: any) {
				console.warn('[BetterSqliteStore] Failed to require better-sqlite3. Trying to load from possible paths...',
					'Error message:', requireError.message,
					'Code:', requireError.code,
				);
				// Strategy 2: Try using absolute paths to plugin's node_modules
				// 策略 2：尝试使用指向插件 node_modules 的绝对路径
				if (requireError.code === 'MODULE_NOT_FOUND') {
					const possiblePaths = BetterSqliteStore.getPossiblePaths(app);

					for (const modulePath of possiblePaths) {
						betterSqlite3 = BetterSqliteStore.loadFromPath(modulePath);
						if (betterSqlite3) {
							console.log(`[BetterSqliteStore] Loaded better-sqlite3 from: ${modulePath}`);
							break;
						}
					}

					if (!betterSqlite3) {
						console.warn(
							[
								'[BetterSqliteStore] better-sqlite3 is not installed or not accessible.',
								`Tried paths: ${JSON.stringify(possiblePaths)}`,
								'To use better-sqlite3:',
								'1. Navigate to: .obsidian/plugins/obsidian-peak-assistant/',
								'2. Run: npm install better-sqlite3',
								'3. Rebuild for Electron (see README.md for details)',
								'Falling back to sql.js (default, works out of the box).'
							].join('\n')
						);
						return false;
					}
				} else {
					return false;
				}
			}

			const Database = betterSqlite3.default || betterSqlite3;

			// Check if it's a function (constructor) | 检查它是否是一个函数（构造函数）
			if (typeof Database !== 'function') {
				console.warn('[BetterSqliteStore] better-sqlite3 is not a function');
				return false;
			}

			// Try to create a temporary in-memory database to verify the native module works
			// 尝试创建一个临时的内存数据库，以验证原生模块是否正常工作
			try {
				const testDb = new Database(':memory:');
				testDb.close();
				console.debug('[BetterSqliteStore] better-sqlite3 native module is working');

				// Cache the module only after successful verification
				// 仅在成功验证后缓存该模块
				BetterSqliteStore.cachedBetterSqlite3 = betterSqlite3;
				return true;
			} catch (error) {
				console.warn(
					'[BetterSqliteStore] better-sqlite3 module found but native binding failed. ' +
					'This is usually because the native module is missing or incompatible with Electron\'s Node.js version. ' +
					'To fix: Rebuild better-sqlite3 for Electron using electron-rebuild. ' +
					'See src/core/storage/README.md for detailed instructions. ' +
					'Falling back to sql.js (default, works out of the box).',
					error
				);
				return false;
			}
		} catch (error) {
			console.warn('[BetterSqliteStore] Unexpected error checking better-sqlite3:', error);
			return false;
		}
	}

	/**
	 * Get possible paths to better-sqlite3 module.
	 * Tries multiple strategies to find the plugin's node_modules directory.
	 */
	private static getPossiblePaths(app?: App): string[] {
		const paths: string[] = [];

		// Strategy 1: Try relative to vault base path (most reliable in Obsidian)
		if (app) {
			const basePath = (app.vault.adapter as any)?.basePath;
			if (basePath) {
				paths.push(path.join(basePath, '.obsidian', 'plugins', 'obsidian-peak-assistant', 'node_modules', 'better-sqlite3'));
			}
		}

		// Strategy 2: Try relative to current working directory
		if (typeof process !== 'undefined' && process.cwd) {
			const cwd = process.cwd();
			if (cwd && cwd !== '/') {
				paths.push(path.join(cwd, 'node_modules', 'better-sqlite3'));
			}
		}

		// Strategy 3: Try common Obsidian plugin locations
		if (typeof process !== 'undefined' && process.env) {
			if (process.env.HOME) {
				paths.push(path.join(process.env.HOME, '.obsidian', 'plugins', 'obsidian-peak-assistant', 'node_modules', 'better-sqlite3'));
			}
			if (process.env.USERPROFILE) {
				paths.push(path.join(process.env.USERPROFILE, '.obsidian', 'plugins', 'obsidian-peak-assistant', 'node_modules', 'better-sqlite3'));
			}
		}

		return paths;
	}

	/**
	 * Load better-sqlite3 from a specific path.
	 * Returns the module if successful, null otherwise.
	 */
	private static loadFromPath(modulePath: string): typeof import('better-sqlite3') | null {
		try {
			const packageJsonPath = path.join(modulePath, 'package.json');
			if (!fs.existsSync(packageJsonPath)) {
				return null;
			}

			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
			const mainFile = packageJson.main || 'index.js';
			const mainPath = path.join(modulePath, mainFile);

			if (fs.existsSync(mainPath)) {
				return require(mainPath);
			}
		} catch (error) {
			// Ignore errors, try next path
		}
		return null;
	}

	/**
	 * Dynamically load better-sqlite3 module.
	 * 
	 * Priority:
	 * 1. Use cached module (if available)
	 * 2. Try normal require (works if node_modules is in require path)
	 * 3. Try loading from require.cache (if already loaded)
	 * 4. Try loading from absolute paths (fallback)
	 */
	private static loadBetterSqlite3(app?: App): typeof import('better-sqlite3') {
		// Strategy 1: Use cached module
		if (BetterSqliteStore.cachedBetterSqlite3) {
			console.debug('[BetterSqliteStore] Using cached better-sqlite3');
			return BetterSqliteStore.cachedBetterSqlite3;
		}

		// Strategy 2: Try normal require
		try {
			const module = require('better-sqlite3');
			BetterSqliteStore.cachedBetterSqlite3 = module;
			return module;
		} catch (requireError: any) {
			// Strategy 3: Check require.cache for already loaded module
			if (typeof require !== 'undefined' && require.cache) {
				for (const modulePath in require.cache) {
					if (modulePath.includes('better-sqlite3') && modulePath.includes('node_modules')) {
						const cachedModule = require.cache[modulePath];
						if (cachedModule && cachedModule.exports) {
							const exports = cachedModule.exports;
							// Extract Database constructor
							let Database = null;
							if (typeof exports === 'function') {
								Database = exports;
							} else if (exports && typeof exports === 'object') {
								Database = exports.default || exports.Database;
							}
							if (Database && typeof Database === 'function') {
								const module = { default: Database, Database: Database } as any;
								BetterSqliteStore.cachedBetterSqlite3 = module;
								console.debug(`[BetterSqliteStore] Using better-sqlite3 from require.cache: ${modulePath}`);
								return module;
							}
						}
					}
				}
			}

			// Strategy 4: Try loading from absolute paths (only if MODULE_NOT_FOUND)
			if (requireError.code === 'MODULE_NOT_FOUND') {
				const possiblePaths = BetterSqliteStore.getPossiblePaths(app);

				for (const modulePath of possiblePaths) {
					const betterSqlite3 = BetterSqliteStore.loadFromPath(modulePath);
					if (betterSqlite3) {
						BetterSqliteStore.cachedBetterSqlite3 = betterSqlite3;
						console.debug(`[BetterSqliteStore] Loaded better-sqlite3 from: ${modulePath}`);
						return betterSqlite3;
					}
				}

				throw new Error(
					'better-sqlite3 is not installed or not accessible. ' +
					'Please install it in the plugin directory: .obsidian/plugins/obsidian-peak-assistant/ ' +
					'Run: npm install better-sqlite3'
				);
			}
			throw requireError;
		}
	}

	/**
	 * Open a new database connection.
	 * 
	 * 打开一个新的数据库连接。
	 * 
	 * @param params - Database parameters | 数据库参数
	 * @param params.dbFilePath - Path to the SQLite database file | SQLite 数据库文件的路径
	 * @returns Promise resolving to object with store instance and sqliteVecAvailable flag
	 *          返回包含存储实例和 sqliteVecAvailable 标志的对象
	 * @throws Error if better-sqlite3 native module cannot be loaded
	 *         如果无法加载 better-sqlite3 原生模块，则抛出错误
	 */
	static async open(params: { dbFilePath: string; app?: App }): Promise<{ store: BetterSqliteStore; sqliteVecAvailable: boolean }> {
		// Dynamically load better-sqlite3 to avoid module resolution errors at import time
		// 动态加载 better-sqlite3，以避免在导入时出现模块解析错误
		const BetterSqlite3 = BetterSqliteStore.loadBetterSqlite3(params.app);
		const Database = BetterSqlite3.default || BetterSqlite3;

		let db: BetterSqlite3Database;
		try {
			db = new Database(params.dbFilePath, {
				// Enable WAL mode for better concurrency | 启用 WAL 模式以获得更好的并发性能
				// This is the default, but we make it explicit | 这是默认设置，但我们明确指定它
			}) as BetterSqlite3Database;

			// Immediately attempt to recover from any potential lock issues
			// 立即尝试从任何潜在的锁定问题中恢复
			try {
				// Force a WAL checkpoint to clear any pending transactions
				// 强制进行 WAL 检查点以清除任何挂起的事务
				db.pragma('wal_checkpoint(TRUNCATE)');
				console.debug('[BetterSqliteStore] Initial WAL checkpoint completed');
			} catch (checkpointError) {
				console.warn('[BetterSqliteStore] Initial WAL checkpoint failed:', checkpointError);
			}
		} catch (error) {
			// If native module loading fails, provide a helpful error message
			// 如果原生模块加载失败，提供有用的错误提示信息
			if (error instanceof Error && (error.message.includes('indexOf') || error.message.includes('bindings'))) {
				throw new Error(
					'better-sqlite3 native module failed to load. ' +
					'This usually means the .node file is missing or incompatible. ' +
					'Please ensure better-sqlite3 is properly installed in the plugin directory, ' +
					'or use sql.js instead (set sqliteBackend to "sql.js" in settings). ' +
					`Original error: ${error.message}`
				);
			}
			throw error;
		}

		// Enable foreign keys | 启用外键约束
		db.pragma('foreign_keys = ON');

		// Set busy timeout to prevent infinite blocking on locked database
		// When database is locked (e.g., concurrent read/write operations),
		// operations will fail after 5 seconds instead of blocking indefinitely
		// 设置繁忙超时时间，防止在数据库锁定时无限期阻塞。
		// 当数据库被锁定（例如并发读写）时，操作将在 5 秒后失败，而不是无限期等待。
		db.pragma('busy_timeout = 5000');

		// Attempt to recover from potential lock issues
		// 尝试从潜在的锁定问题中恢复
		try {
			// Check if database is in a locked state and try to recover
			// 检查数据库是否处于锁定状态并尝试恢复
			const walCheckpoint = db.pragma('wal_checkpoint(TRUNCATE)');
			console.debug('[BetterSqliteStore] WAL checkpoint result:', walCheckpoint);
		} catch (error) {
			console.warn('[BetterSqliteStore] WAL checkpoint failed (may be normal):', error);
		}

		// Try to load sqlite-vec extension for vector similarity search
		// 尝试加载用于向量相似度搜索的 sqlite-vec 扩展
		const sqliteVecAvailable = BetterSqliteStore.tryLoadSqliteVec(db, params.app);

		// Run migrations directly with db (has exec method)
		// 直接使用 db（具有 exec 方法）运行迁移
		migrateSqliteSchema(db);

		return { store: new BetterSqliteStore(db), sqliteVecAvailable };
	}

	/**
	 * Finds the path to sqlite-vec extension file.
	 * Tries getLoadablePath() first, then falls back to manual path resolution.
	 * 
	 * 查找 sqlite-vec 扩展文件的路径。
	 * 首先尝试 getLoadablePath()，然后回退到手动路径解析。
	 */
	private static findSqliteVecExtensionPath(sqliteVec: any, app?: App): string | null {
		// Try getLoadablePath() first | 首先尝试 getLoadablePath()
		if (sqliteVec.getLoadablePath && typeof sqliteVec.getLoadablePath === 'function') {
			try {
				const extensionPath = sqliteVec.getLoadablePath();
				if (fs.existsSync(extensionPath)) {
					console.debug(`[BetterSqliteStore] getLoadablePath() returned: ${extensionPath}`);
					return extensionPath;
				}
			} catch (pathError: any) {
				console.debug(`[BetterSqliteStore] getLoadablePath() failed: ${pathError instanceof Error ? pathError.message : String(pathError)}`);
			}
		}

		// Determine platform-specific package name and file extension
		// 确定特定平台的包名和文件扩展名
		const platform = process.platform;
		const arch = process.arch;
		let packageName: string;
		let fileExt: string;

		if (platform === 'darwin') {
			packageName = arch === 'arm64' ? 'sqlite-vec-darwin-arm64' : 'sqlite-vec-darwin-x64';
			fileExt = 'dylib';
		} else if (platform === 'linux') {
			packageName = arch === 'arm64' ? 'sqlite-vec-linux-arm64' : 'sqlite-vec-linux-x64';
			fileExt = 'so';
		} else if (platform === 'win32') {
			packageName = 'sqlite-vec-windows-x64';
			fileExt = 'dll';
		} else {
			throw new Error(`Unsupported platform: ${platform}-${arch}`);
		}

		// Build possible paths (without require.resolve, not available in Obsidian bundled environment)
		// 构建可能的路径（不使用 require.resolve，因为它在 Obsidian 打包环境中不可用）
		const possiblePaths: string[] = [];

		// Primary: Use Obsidian vault-based path (most reliable in plugin environment)
		// 首选：使用基于 Obsidian 仓库的路径（在插件环境中最为可靠）
		if (app) {
			const basePath = (app.vault.adapter as any)?.basePath;
			if (basePath) {
				possiblePaths.push(
					path.join(basePath, '.obsidian', 'plugins', 'obsidian-peak-assistant', 'node_modules', packageName, `vec0.${fileExt}`)
				);
			}
		}

		// Fallback: Try process.cwd() based path
		// 回退：尝试基于 process.cwd() 的路径
		try {
			possiblePaths.push(
				path.join(process.cwd(), 'node_modules', packageName, `vec0.${fileExt}`)
			);
		} catch {
			// process.cwd() may fail in some environments | process.cwd() 在某些环境中可能会失败
		}

		console.debug(`[BetterSqliteStore] Trying alternative paths: ${possiblePaths.join(', ')}`);
		for (const altPath of possiblePaths) {
			if (fs.existsSync(altPath)) {
				console.debug(`[BetterSqliteStore] Found extension at: ${altPath}`);
				return altPath;
			}
		}

		return null;
	}

	/**
	 * Attempts to manually load sqlite-vec extension using db.loadExtension().
	 * 
	 * 尝试使用 db.loadExtension() 手动加载 sqlite-vec 扩展。
	 */
	private static tryManualLoadExtension(
		db: BetterSqlite3Database,
		sqliteVec: any,
		app?: App
	): boolean {
		if (!db.loadExtension) {
			return false;
		}

		try {
			const extensionPath = this.findSqliteVecExtensionPath(sqliteVec, app);
			if (!extensionPath) {
				console.warn(`[BetterSqliteStore] Could not find extension file.`);
				return false;
			}

			console.debug(`[BetterSqliteStore] Loading extension manually from: ${extensionPath}`);
			db.loadExtension(extensionPath);

			// Verify extension is loaded | 验证扩展是否已加载
			const versionResult = db.prepare('SELECT vec_version() as version').get() as { version: string } | undefined;
			if (versionResult) {
				console.debug(`[BetterSqliteStore] sqlite-vec extension loaded manually (version: ${versionResult.version})`);
				return true;
			}

			return false;
		} catch (manualError: any) {
			console.warn(`[BetterSqliteStore] Manual loading failed: ${manualError instanceof Error ? manualError.message : String(manualError)}`);
			return false;
		}
	}

	/**
	 * Try to load sqlite-vec extension for vector similarity search.
	 * If loading fails, returns false but doesn't throw error.
	 * This allows database to work without vector search (fulltext search still works).
	 * 
	 * @param db - Database instance to load extension into
	 * @returns true if extension loaded successfully, false otherwise
	 */
	private static tryLoadSqliteVec(db: BetterSqlite3Database, app?: App): boolean {
		try {
			// Dynamically load sqlite-vec to avoid module resolution errors
			// According to sqlite-vec docs, it should automatically handle platform-specific packages
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			const sqliteVec = require('sqlite-vec');

			// sqlite-vec exports a load function that takes the database instance
			// It internally handles finding and loading the platform-specific extension
			const loadFn = sqliteVec.load || sqliteVec.default?.load;
			if (typeof loadFn !== 'function') {
				console.warn(
					'[BetterSqliteStore] sqlite-vec.load function not found. ' +
					'Vector similarity search will not be available.'
				);
				return false;
			}

			try {
				loadFn(db);
				// Verify extension is loaded by checking vec_version()
				const versionResult = db.prepare('SELECT vec_version() as version').get() as { version: string } | undefined;
				if (versionResult) {
					console.debug(`[BetterSqliteStore] sqlite-vec extension loaded successfully (version: ${versionResult.version})`);
					return true;
				}
				// If vec_version() failed, extension may not be fully loaded
				console.warn('[BetterSqliteStore] sqlite-vec.load() succeeded but vec_version() failed. Extension may not be fully loaded.');
			} catch (loadError: any) {
				// Error during load() call - sqlite-vec.load() internally uses getLoadablePath() and db.loadExtension()
				// In Obsidian plugin environment, path resolution may fail due to __dirname pointing to bundled location
				const errorMsg = loadError instanceof Error ? loadError.message : String(loadError);

				// Try manual loading as fallback
				if (this.tryManualLoadExtension(db, sqliteVec, app)) {
					return true;
				}

				// Report the error
				console.warn(
					'[BetterSqliteStore] Failed to load sqlite-vec extension. ' +
					'Vector similarity search will not be available. ' +
					'According to sqlite-vec docs, platform packages should be automatically handled. ' +
					'If this error persists, ensure sqlite-vec and platform-specific packages are installed. ' +
					`Error: ${errorMsg}. Fulltext search will still work.`
				);
			}

			return false;
		} catch (requireError: any) {
			if (requireError.code === 'MODULE_NOT_FOUND') {
				console.warn(
					'[BetterSqliteStore] sqlite-vec extension is not installed. ' +
					'Vector similarity search will not be available. ' +
					'To enable it, install: npm install sqlite-vec'
				);
			} else {
				const errorMsg = requireError instanceof Error ? requireError.message : String(requireError);
				console.warn(
					'[BetterSqliteStore] Failed to require sqlite-vec. ' +
					'Vector similarity search will not be available. ' +
					`Error: ${errorMsg}. Fulltext search will still work.`
				);
			}
			return false;
		}
	}

	/**
	 * Close the database connection.
	 */
	close(): void {
		if (this.db) {
			this.db.close();
			this.db = null as any;
		}
	}

	/**
	 * Check if the database is open.
	 */
	isOpen(): boolean {
		return this.db !== null && this.db.open;
	}

	exec(sql: string): void {
		this.db.exec(sql);
	}

	prepare(sql: string): any {
		return this.db.prepare(sql);
	}

	kysely<T = DbSchema>(): Kysely<T> {
		// This cast is safe because kyselyInstance is created with DbSchema.
		// For full type-safety, callers should only use the default type parameter.
		return this.kyselyInstance as unknown as Kysely<T>;
	}

	databaseType(): SqliteStoreType {
		return 'better-sqlite3';
	}

}

