import type { Kysely } from 'kysely';
import type { Database as DbSchema } from '../ddl';

/**
 * Index State Repository
 * 
 * Manages the `index_state` table, which serves as a simple persistent Key-Value 
 * store within the SQLite database. It's primarily used to store indexing 
 * checkpoints, status flags, and small configuration bits needed for 
 * background processing.
 * 
 * 索引状态存储库
 * 
 * 管理 `index_state` 表，该表作为 SQLite 数据库中的一个简单持久化键值存储。
 * 它主要用于存储索引检查点、状态标记以及后台处理所需的小型配置信息。
 */
export class IndexStateRepo {
	constructor(private readonly db: Kysely<DbSchema>) {}

	/**
	 * Checks if a specific key exists in the states table.
	 * 检查状态表中是否存在特定的键。
	 */
	async existsByKey(key: string): Promise<boolean> {
		const row = await this.db
			.selectFrom('index_state')
			.select('key')
			.where('key', '=', key)
			.executeTakeFirst();
		return row !== undefined;
	}

	/**
	 * Inserts a new key-value pair.
	 * 插入新的键值对。
	 */
	async insert(state: { key: string; value: string }): Promise<void> {
		await this.db
			.insertInto('index_state')
			.values(state)
			.execute();
	}

	/**
	 * Updates the value for an existing key.
	 * 更新现有键的值。
	 */
	async updateByKey(key: string, value: string): Promise<void> {
		await this.db
			.updateTable('index_state')
			.set({ value })
			.where('key', '=', key)
			.execute();
	}

	/**
	 * Retrieves the value associated with a key.
	 * 检索与键关联的值。
	 * 
	 * @returns The string value or null if not found.
	 */
	async get(key: string): Promise<string | null> {
		const row = await this.db
			.selectFrom('index_state')
			.select(['value'])
			.where('key', '=', key)
			.executeTakeFirst();
		return row?.value != null ? String(row.value) : null;
	}

	/**
	 * Sets a value for a key, performing either an insert or update as needed.
	 * 为键设置值，根据需要执行插入或更新。
	 */
	async set(key: string, value: string): Promise<void> {
		const exists = await this.existsByKey(key);

		if (exists) {
			await this.updateByKey(key, value);
		} else {
			await this.insert({ key, value });
		}
	}

	/**
	 * Clears all entries from the index state table.
	 * 清除索引状态表中的所有条目。
	 */
	async clearAll(): Promise<void> {
		await this.db.deleteFrom('index_state').execute();
	}
}


