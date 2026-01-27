/**
 * @file SqliteStoreManager.ts
 * @description SQLite 数据库总管理类（单例）。它是整个插件的“数据心脏”，负责管理所有与数据库相关的连接、初始化和仓库分配。
 * 
 * 核心功能：
 * 1. **双库并行**：管理两个独立的数据库文件：
 *    - `search.sqlite`（搜索库）：存储文档分块、AI 向量、知识图谱等“重量级”数据。
 *    - `meta.sqlite`（元数据库）：存储聊天项目、对话列表、收藏消息等“轻量级”数据。
 * 2. **自适应引擎**：
 *    - 优先尝试加载 `better-sqlite3`（原生 C++ 引擎），速度最快。
 *    - 如果原生引擎加载失败（常见于不同系统的兼容性问题），会自动降级到 `sql.js`（WASM 引擎），保证插件在任何电脑上都能跑。
 * 3. **统一入口**：通过 `get...Repo()` 方法，为整个插件提供统一的增删改查（CRUD）接口。
 * 
 * 作用：
 * 它是数据库操作的“交通枢纽”。无论你是想存一条聊天记录，还是想搜一篇笔记，都必须通过这个单例对象拿到对应的“仓库管理员”（Repo）。
 * 
 * 举例：
 * - 场景：用户发送了一条新消息，需要存入数据库。
 * - 流程：`sqliteStoreManager.getChatMessageRepo().upsertMessages(...)`。
 */

import type { App } from 'obsidian';
import path from 'path';
import { BetterSqliteStore } from './better-sqlite3-adapter/BetterSqliteStore';
import { SqlJsStore } from './sqljs-adapter/SqlJsStore';
import type { Kysely } from 'kysely';
import type { Database as DbSchema } from './ddl';
import type { SqliteStoreType, SqliteDatabase } from './types';
import { ensureFolderRecursive } from '@/core/utils/vault-utils';
import { DocMetaRepo } from './repositories/DocMetaRepo';
import { DocChunkRepo } from './repositories/DocChunkRepo';
import { EmbeddingRepo } from './repositories/EmbeddingRepo';
import { IndexStateRepo } from './repositories/IndexStateRepo';
import { DocStatisticsRepo } from './repositories/DocStatisticsRepo';
import { GraphNodeRepo } from './repositories/GraphNodeRepo';
import { GraphEdgeRepo } from './repositories/GraphEdgeRepo';
import { GraphStore } from '../graph/GraphStore';
import { ChatProjectRepo } from './repositories/ChatProjectRepo';
import { ChatConversationRepo } from './repositories/ChatConversationRepo';
import { ChatMessageRepo } from './repositories/ChatMessageRepo';
import { ChatMessageResourceRepo } from './repositories/ChatMessageResourceRepo';
import { ChatStarRepo } from './repositories/ChatStarRepo';
import { SEARCH_DB_FILENAME, META_DB_FILENAME } from '@/core/constant';

/**
 * Global singleton manager for SQLite database connection.
 * 
 * This provides a centralized way to access the database connection
 * across different parts of the application without passing it through
 * multiple layers.
 * 
 * 全局单例管理器，用于管理 SQLite 数据库连接。
 * 提供了一个集中的方式来访问跨应用不同部分的数据库连接，无需通过多层传递。
 * 
 * Supports multiple backends:
 * 支持多种后端引擎：
 * - better-sqlite3 (native, fastest, requires manual installation) | 原生 C++ 引擎（最快，需要本地编译）
 * - sql.js (pure JS, default, cross-platform) | 纯 JS 实现（默认，跨平台兼容性最好）
 */
class SqliteStoreManager {
	// === 数据库连接实例 | Database connections ===
	private searchStore: SqliteDatabase | null = null;
	private metaStore: SqliteDatabase | null = null;
	private app: App | null = null;
	private isVectorSearchAvailable: boolean = false;

	// === 搜索库仓库管理员 (search.sqlite) ===
	private docMetaRepo: DocMetaRepo | null = null;
	private docChunkRepo: DocChunkRepo | null = null;
	private embeddingRepo: EmbeddingRepo | null = null;
	private indexStateRepo: IndexStateRepo | null = null;
	private docStatisticsRepo: DocStatisticsRepo | null = null;
	private graphNodeRepo: GraphNodeRepo | null = null;
	private graphEdgeRepo: GraphEdgeRepo | null = null;
	private graphStore: GraphStore | null = null;

	// === 元数据库仓库管理员 (meta.sqlite) ===
	private chatProjectRepo: ChatProjectRepo | null = null;
	private chatConversationRepo: ChatConversationRepo | null = null;
	private chatMessageRepo: ChatMessageRepo | null = null;
	private chatMessageResourceRepo: ChatMessageResourceRepo | null = null;
	private chatStarRepo: ChatStarRepo | null = null;


	/**
	 * Create a database connection with the specified path and settings.
	 * Returns both the database connection and the backend type used.
	 * 
	 * 创建指定路径和设置的数据库连接。
	 * 返回数据库连接实例，并自动处理降级逻辑。
	 */
	private async createDatabaseConnection(
		dbFilePath: string,
		settings?: { sqliteBackend?: 'auto' | 'better-sqlite3' | 'sql.js' }
	): Promise<SqliteDatabase> {
		const userSetting = settings?.sqliteBackend;
		// 1. 根据用户设置和运行环境，选择最合适的后端引擎
		let selectedBackend = await this.selectBackend(userSetting);

		// Open database with selected backend
		// 2. 尝试使用选定的后端打开数据库
		// If better-sqlite3 fails, automatically fallback to sql.js
		// 如果更好的原生引擎打开失败，系统会表现得很“坚强”，自动改用 sql.js
		try {
			switch (selectedBackend) {
				case 'better-sqlite3': {
					const result = await BetterSqliteStore.open({ dbFilePath, app: this.app ?? undefined });
					this.isVectorSearchAvailable = result.sqliteVecAvailable;
					return result.store;
				}
				case 'sql.js': {
					const result = await SqlJsStore.open({ dbFilePath });
					this.isVectorSearchAvailable = false;
					return result;
				}
			}
		} catch (error) {
			// 如果 better-sqlite3 报错（例如缺少 .node 文件），则走这里
			if (selectedBackend === 'better-sqlite3') {
				console.error('[SqliteStoreManager] Failed to open database with better-sqlite3:', error);
				console.log('[SqliteStoreManager] Automatically falling back to sql.js');
				this.isVectorSearchAvailable = false;
				return await SqlJsStore.open({ dbFilePath });
			} else {
				// sql.js 如果也报错，那可能就是硬盘没空间或路径读写权限问题了
				throw error;
			}
		}
	}

	/**
	 * Select the appropriate SQLite backend based on user settings and availability.
	 * 根据用户设置和环境可用性选择合适的 SQLite 后端。
	 *
	 * Priority order | 优先级顺序:
	 * 1. User setting (if explicitly set in settings) | 用户在设置页面手动指定的引擎
	 * 2. Auto-detect better-sqlite3 (if available) | 自动探测（如果 native 模块正常工作则优先用它）
	 * 3. Default to sql.js | 最后的兜底方案：纯 JS 实现
	 *
	 * @param userSetting - User's backend preference from settings ('auto' | 'better-sqlite3' | 'sql.js' | undefined)
	 * @returns Selected backend type
	 */
	private async selectBackend(userSetting?: 'auto' | 'better-sqlite3' | 'sql.js'): Promise<SqliteStoreType> {
		// 优先级 1：用户显式设置
		if (userSetting && userSetting !== 'auto') {
			if (userSetting === 'better-sqlite3') {
				const available = await BetterSqliteStore.checkAvailable(this.app ?? undefined);
				if (available) {
					console.log('[SqliteStoreManager] Using better-sqlite3 (user preference)');
					return 'better-sqlite3';
				} else {
					console.warn('[SqliteStoreManager] better-sqlite3 requested but not available, falling back to sql.js');
					return 'sql.js';
				}
			} else {
				console.log('[SqliteStoreManager] Using sql.js (user preference)');
				return 'sql.js';
			}
		}

		// 优先级 2：自动检测
		if (userSetting === 'auto' || !userSetting) {
			const available = await BetterSqliteStore.checkAvailable(this.app ?? undefined);
			if (available) {
				console.log('[SqliteStoreManager] Using better-sqlite3 (auto-detected)');
				return 'better-sqlite3';
			}
		}

		// 优先级 3：默认兜底
		console.log('[SqliteStoreManager] Using sql.js (default, cross-platform)');
		return 'sql.js';
	}

	/**
	 * Calculate database file path with proper storage folder handling.
	 * 处理并计算数据库文件在物理硬盘上的绝对路径。
	 */
	private async buildDatabasePath(
		app: App,
		storageFolder: string | undefined,
		dbFilename: string
	): Promise<string> {
		// 获取 Obsidian 库的物理根路径
		const basePath = (app.vault.adapter as any)?.basePath ?? '';
		const normalizedStorageFolder = (storageFolder ?? '').trim().replace(/^\/+/, '');

		if (normalizedStorageFolder) {
			// 自动创建存储数据库的文件夹（如果不存在）
			await ensureFolderRecursive(app, normalizedStorageFolder);
		}

		// 拼出最终的数据库文件路径
		const dbPath = basePath
			? (normalizedStorageFolder ? path.join(basePath, normalizedStorageFolder, dbFilename) : path.join(basePath, dbFilename))
			: null;

		if (!dbPath) {
			throw new Error(`SqliteStoreManager init failed: ${dbFilename} database path is missing and vault basePath is unavailable`);
		}

		return dbPath;
	}

	/**
	 * Initialize the database connection.
	 * Should be called once during plugin initialization.
	 * 
	 * 初始化数据库连接。应该在插件启动（main.ts）时调用。
	 *
	 * @param app - Obsidian app instance
	 * @param storageFolder - Storage folder path (relative to vault root) | 数据存放路径
	 * @param filename - Database filename (default: SEARCH_DB_FILENAME) | 数据库主文件名
	 * @param settings - Optional plugin settings (if provided, will use sqliteBackend from settings)
	 */
	async init(params: {
		app: App;
		storageFolder?: string;
		filename?: string;
		settings?: { sqliteBackend?: 'auto' | 'better-sqlite3' | 'sql.js' };
	}): Promise<void> {
		// 1. 如果已经初始化过，先清理库连接防止泄漏
		if (this.searchStore || this.metaStore) {
			console.warn('SqliteStoreManager already initialized, closing existing connections');
			this.close();
		}

		this.app = params.app;

		// 2. 初始化搜索库 (search.sqlite)
		const searchDbPath = await this.buildDatabasePath(params.app, params.storageFolder, SEARCH_DB_FILENAME);
		this.searchStore = await this.createDatabaseConnection(searchDbPath, params.settings);

		// 3. 初始化元数据库 (meta.sqlite)
		const metaDbPath = await this.buildDatabasePath(params.app, params.storageFolder, META_DB_FILENAME);
		this.metaStore = await this.createDatabaseConnection(metaDbPath, params.settings);

		// 4. 实例化搜索库的所有仓库 (Repositories)
		// 注意：这里使用了 Kysely，一个强大的 TypeScript SQL 查询构建器
		const searchKdb = this.searchStore.kysely<DbSchema>();
		const searchRawDb = this.searchStore;
		this.docMetaRepo = new DocMetaRepo(searchKdb);
		this.docChunkRepo = new DocChunkRepo(searchKdb, searchRawDb);
		this.embeddingRepo = new EmbeddingRepo(searchKdb, searchRawDb);
		
		// 检查向量表状态。这是 AI 语义搜索正常工作的关键步骤。
		this.embeddingRepo.initializeVecEmbeddingsTableCache();
		
		this.indexStateRepo = new IndexStateRepo(searchKdb);
		this.docStatisticsRepo = new DocStatisticsRepo(searchKdb);
		this.graphNodeRepo = new GraphNodeRepo(searchKdb);
		this.graphEdgeRepo = new GraphEdgeRepo(searchKdb);
		
		// 初始化图谱存储逻辑
		this.graphStore = new GraphStore(this.graphNodeRepo, this.graphEdgeRepo);

		// 5. 实例化元数据库的所有仓库 (Repositories)
		const metaKdb = this.metaStore.kysely<DbSchema>();
		this.chatProjectRepo = new ChatProjectRepo(metaKdb);
		this.chatConversationRepo = new ChatConversationRepo(metaKdb);
		this.chatMessageRepo = new ChatMessageRepo(metaKdb);
		this.chatMessageResourceRepo = new ChatMessageResourceRepo(metaKdb);
		this.chatStarRepo = new ChatStarRepo(metaKdb);
	}

	/**
	 * Get the Kysely instance for database queries.
	 * Returns the search database connection for backward compatibility.
	 * Throws error if not initialized.
	 * 
	 * 获取 Kysely 查询实例。主要用于搜索引擎。
	 */
	getSearchContext(): Kysely<DbSchema> {
		if (!this.searchStore) {
			throw new Error('SqliteStoreManager not initialized. Call init() first.');
		}
		return this.searchStore.kysely();
	}

	/**
	 * Get the search database backend type.
	 * 获取底层搜索库的原始接口。
	 */
	getSearchStore(): SqliteDatabase | null {
		return this.searchStore;
	}

	/**
	 * Get the meta database backend type.
	 * 获取底层元数据库的原始接口。
	 */
	getMetaStore(): SqliteDatabase | null {
		return this.metaStore;
	}

	/**
	 * Check if the stores are initialized.
	 * 检查数据库是否已经“就绪”。
	 */
	isInitialized(): boolean {
		return this.searchStore !== null && this.metaStore !== null;
	}

	// === Repository 获取方法 | Repository Accessors ===
	// 以下方法提供了对数据库各个表的结构化访问入口

	/**
	 * 获取文档元数据仓库管理员。
	 */
	getDocMetaRepo(): DocMetaRepo {
		if (!this.docMetaRepo) {
			throw new Error('SqliteStoreManager not initialized. Call init() first.');
		}
		return this.docMetaRepo;
	}

	/**
	 * 获取文档分块仓库管理员。
	 */
	getDocChunkRepo(): DocChunkRepo {
		if (!this.docChunkRepo) {
			throw new Error('SqliteStoreManager not initialized. Call init() first.');
		}
		return this.docChunkRepo;
	}

	/**
	 * 获取向量嵌入仓库管理员（处理 AI 的语义数据）。
	 */
	getEmbeddingRepo(): EmbeddingRepo {
		if (!this.embeddingRepo) {
			throw new Error('SqliteStoreManager not initialized. Call init() first.');
		}
		return this.embeddingRepo;
	}

	/**
	 * Check if vector similarity search is available.
	 * This requires sqlite-vec extension to be loaded successfully.
	 * 
	 * 检查 AI 向量搜索是否可用。
	 * 这取决于 `sqlite-vec` 扩展是否在当前系统环境下成功加载。
	 */
	isVectorSearchEnabled(): boolean {
		return this.isVectorSearchAvailable;
	}

	/**
	 * 获取索引状态仓库管理员。
	 */
	getIndexStateRepo(): IndexStateRepo {
		if (!this.indexStateRepo) {
			throw new Error('SqliteStoreManager not initialized. Call init() first.');
		}
		return this.indexStateRepo;
	}

	/**
	 * 获取文档统计信息仓库管理员。
	 */
	getDocStatisticsRepo(): DocStatisticsRepo {
		if (!this.docStatisticsRepo) {
			throw new Error('SqliteStoreManager not initialized. Call init() first.');
		}
		return this.docStatisticsRepo;
	}

	/**
	 * 获取图谱节点仓库管理员。
	 */
	getGraphNodeRepo(): GraphNodeRepo {
		if (!this.graphNodeRepo) {
			throw new Error('SqliteStoreManager not initialized. Call init() first.');
		}
		return this.graphNodeRepo;
	}

	/**
	 * 获取图谱连线仓库管理员。
	 */
	getGraphEdgeRepo(): GraphEdgeRepo {
		if (!this.graphEdgeRepo) {
			throw new Error('SqliteStoreManager not initialized. Call init() first.');
		}
		return this.graphEdgeRepo;
	}

	/**
	 * 获取图谱存储总调度。
	 */
	getGraphStore(): GraphStore {
		if (!this.graphStore) {
			throw new Error('SqliteStoreManager not initialized. Call init() first.');
		}
		return this.graphStore;
	}

	/**
	 * 获取聊天项目（文件夹）仓库管理员。
	 */
	getChatProjectRepo(): ChatProjectRepo {
		if (!this.chatProjectRepo) {
			throw new Error('SqliteStoreManager not initialized. Call init() first.');
		}
		return this.chatProjectRepo;
	}

	/**
	 * 获取 AI 对话仓库管理员。
	 */
	getChatConversationRepo(): ChatConversationRepo {
		if (!this.chatConversationRepo) {
			throw new Error('SqliteStoreManager not initialized. Call init() first.');
		}
		return this.chatConversationRepo;
	}

	/**
	 * 获取 AI 聊天消息仓库管理员。
	 */
	getChatMessageRepo(): ChatMessageRepo {
		if (!this.chatMessageRepo) {
			throw new Error('SqliteStoreManager not initialized. Call init() first.');
		}
		return this.chatMessageRepo;
	}

	/**
	 * 获取消息引用资源仓库管理员。
	 */
	getChatMessageResourceRepo(): ChatMessageResourceRepo {
		if (!this.chatMessageResourceRepo) {
			throw new Error('SqliteStoreManager not initialized. Call init() first.');
		}
		return this.chatMessageResourceRepo;
	}

	/**
	 * 获取收藏消息仓库管理员。
	 */
	getChatStarRepo(): ChatStarRepo {
		if (!this.chatStarRepo) {
			throw new Error('SqliteStoreManager not initialized. Call init() first.');
		}
		return this.chatStarRepo;
	}

	/**
	 * Save both databases (for sql.js backend).
	 * This is a no-op for other backends.
	 * 
	 * 保存数据库内容。
	 * 对于 `sql.js`（内存型），由于其数据在内存中，必须显式调用 save 来将数据同步回硬盘。
	 */
	save(): void {
		// 保存搜索数据库
		if (this.searchStore && this.searchStore.databaseType() === 'sql.js' && 'save' in this.searchStore) {
			(this.searchStore as any).save();
		}
		// 保存元数据库
		if (this.metaStore && this.metaStore.databaseType() === 'sql.js' && 'save' in this.metaStore) {
			(this.metaStore as any).save();
		}
	}

	/**
	 * Close the database connection.
	 * 关闭所有数据库连接，安全退出。
	 */
	close(): void {
		// 关闭搜索数据库
		if (this.searchStore) {
			// sql.js 关闭前必须保存
			if (this.searchStore.databaseType() === 'sql.js' && 'save' in this.searchStore) {
				(this.searchStore as any).save();
			}
			this.searchStore.close();
			this.searchStore = null;
		}

		// 关闭元数据库
		if (this.metaStore) {
			// sql.js 关闭前必须保存
			if (this.metaStore.databaseType() === 'sql.js' && 'save' in this.metaStore) {
				(this.metaStore as any).save();
			}
			this.metaStore.close();
			this.metaStore = null;
		}

		this.app = null;
		// 清理所有仓库实例，防止内存泄漏
		this.docMetaRepo = null;
		this.docChunkRepo = null;
		this.embeddingRepo = null;
		this.indexStateRepo = null;
		this.docStatisticsRepo = null;
		this.graphNodeRepo = null;
		this.graphEdgeRepo = null;
		this.graphStore = null;
		this.chatProjectRepo = null;
		this.chatConversationRepo = null;
		this.chatMessageRepo = null;
		this.chatMessageResourceRepo = null;
		this.chatStarRepo = null;
	}
}

/**
 * Global singleton instance.
 * 全局单例导出。建议通过此对象访问上述所有功能。
 */
// todo change to another way to build instance of SqliteStoreManager like AppContext.getInstance()
export const sqliteStoreManager = new SqliteStoreManager();

