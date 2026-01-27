import type { Kysely } from 'kysely';
import type { Database as DbSchema } from '../ddl';

/**
 * Chat Star Repository
 * 
 * Manages the `chat_star` table, which serves as a specialized index for 
 * "bookmarked" or "starred" messages. Unlike the simple boolean flag in 
 * the messages table, this repository handles a more permanent track of 
 * important content, facilitating quick access to active bookmarks across 
 * different projects and conversations.
 * 
 * 对话收藏存储库
 * 
 * 管理 `chat_star` 表，该表作为“书签”或“收藏”消息的专用索引。与消息表中的
 * 简单布尔标志不同，此存储库处理更持久的重要内容跟踪，有助于快速访问不同项目
 * 和对话中的活动书签。
 */
export class ChatStarRepo {
	constructor(private readonly db: Kysely<DbSchema>) {}

	/**
	 * Checks if a star record exists for a specific original message.
	 * 检查特定原始消息是否存在收藏记录。
	 */
	async existsBySourceMessageId(sourceMessageId: string): Promise<boolean> {
		const row = await this.db
			.selectFrom('chat_star')
			.select('source_message_id')
			.where('source_message_id', '=', sourceMessageId)
			.executeTakeFirst();
		return row !== undefined;
	}

	/**
	 * Inserts a new star entry into the database.
	 * 向数据库插入新的收藏条目。
	 */
	async insert(star: {
		source_message_id: string;
		id: string;
		conversation_id: string;
		project_id: string | null;
		created_at_ts: number;
		active: number;
	}): Promise<void> {
		await this.db
			.insertInto('chat_star')
			.values(star)
			.execute();
	}

	/**
	 * Updates an existing star record based on the source message ID.
	 * 根据源消息 ID 更新现有的收藏记录。
	 */
	async updateBySourceMessageId(sourceMessageId: string, updates: Partial<Pick<DbSchema['chat_star'], 'conversation_id' | 'project_id' | 'active'>>): Promise<void> {
		await this.db
			.updateTable('chat_star')
			.set(updates)
			.where('source_message_id', '=', sourceMessageId)
			.execute();
	}

	/**
	 * Upserts a star record. If a record already exists for the message, 
	 * it updates its state; otherwise, it creates a new entry.
	 * 
	 * 插入或更新收藏记录。如果消息已存在记录，则更新其状态；否则，创建一个新条目。
	 */
	async upsert(params: {
		sourceMessageId: string;
		id: string;
		conversationId: string;
		projectId?: string | null;
		createdAtTs: number;
		active: boolean;
	}): Promise<void> {
		const exists = await this.existsBySourceMessageId(params.sourceMessageId);

		if (exists) {
			// Update existing star record | 更新现有的收藏记录
			await this.updateBySourceMessageId(params.sourceMessageId, {
				conversation_id: params.conversationId,
				project_id: params.projectId ?? null,
				active: params.active ? 1 : 0,
			});
		} else {
			// Insert new star record | 插入新的收藏记录
			await this.insert({
				source_message_id: params.sourceMessageId,
				id: params.id,
				conversation_id: params.conversationId,
				project_id: params.projectId ?? null,
				created_at_ts: params.createdAtTs,
				active: params.active ? 1 : 0,
			});
		}
	}

	/**
	 * Explicitly sets whether a star record is considered "active".
	 * 显式设置收藏记录是否被视为“有效”。
	 */
	async setActive(sourceMessageId: string, active: boolean): Promise<void> {
		await this.db
			.updateTable('chat_star')
			.set({ active: active ? 1 : 0 })
			.where('source_message_id', '=', sourceMessageId)
			.execute();
	}

	/**
	 * Lists all currently active starred messages, ordered by creation time.
	 * 列出所有当前有效的收藏消息，按创建时间排序。
	 */
	async listActive(): Promise<DbSchema['chat_star'][]> {
		return this.db
			.selectFrom('chat_star')
			.selectAll()
			.where('active', '=', 1)
			.orderBy('created_at_ts', 'desc')
			.execute();
	}

	/**
	 * Fetches the specific star record for a given message.
	 * 获取给定消息的特定收藏记录。
	 */
	async getBySourceMessageId(sourceMessageId: string): Promise<DbSchema['chat_star'] | null> {
		const row = await this.db
			.selectFrom('chat_star')
			.selectAll()
			.where('source_message_id', '=', sourceMessageId)
			.executeTakeFirst();
		return row ?? null;
	}
}

