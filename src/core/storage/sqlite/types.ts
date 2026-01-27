import type { Database as DbSchema } from './ddl';
import { Kysely } from 'kysely';

/**
 * SQLite Storage Types and Interfaces
 * 
 * Provides an abstraction layer over different SQLite backends (Better-sqlite3 
 * and Sql.js). By using this interface, the rest of the application (Repositories) 
 * can interact with the database using standard Kysely queries or raw SQL 
 * without knowing which specific engine is running.
 * 
 * SQLite 存储类型与接口
 * 
 * 提供不同 SQLite 后端（Better-sqlite3 和 Sql.js）的抽象层。
 * 通过使用此接口，应用程序的其他部分（存储库）可以使用标准的 Kysely 查询或
 * 原始 SQL 与数据库进行交互，而无需知道正在运行的具体引擎。
 */

/**
 * Supported SQLite backend types.
 * 'better-sqlite3': Native Node.js module, fast, supports vector extensions.
 * 'sql.js': WebAssembly/Pure JS version, cross-platform, no native dependencies.
 * 
 * 支持的 SQLite 后端类型。
 */
export type SqliteStoreType = 'better-sqlite3' | 'sql.js';

/**
 * Unified interface for SQLite database operations.
 * SQLite 数据库操作的统一接口。
 */
export interface SqliteDatabase {
	/**
	 * Executes a raw SQL statement without expecting a result.
	 * 执行原始 SQL 语句，不返回结果。
	 */
	exec(sql: string): void;
	
	/**
	 * Prepares a SQL statement for execution.
	 * 准备待执行的 SQL 语句。
	 */
	prepare(sql: string): any;
	
	/**
	 * Returns a Kysely instance for type-safe query building.
	 * 返回用于类型安全查询构建的 Kysely 实例。
	 */
	kysely<T>(): Kysely<T>;
	
	/**
	 * Properly closes the database connection and releases resources.
	 * 正确关闭数据库连接并释放资源。
	 */
	close(): void;
	
	/**
	 * Returns the current backend engine type.
	 * 返回当前的后端引擎类型。
	 */
	databaseType(): SqliteStoreType;
}
