import type { Kysely } from 'kysely';
import type { Database as DbSchema } from '../ddl';
import type { ChatResourceRef } from '@/service/chat/types';

/**
 * Chat Message Resource Repository
 * 
 * Manages the `chat_message_resource` table. This reflects references to 
 * Obsidian files, external URLs, or other "resources" that are explicitly 
 * attached to a chat message. 
 * 
 * 对话消息资源存储库
 * 
 * 管理 `chat_message_resource` 表。这反映了对 Obsidian 文件、外部 URL
 * 或其他明确附加到对话消息的“资源”的引用。
 */
export class ChatMessageResourceRepo {
	constructor(private readonly db: Kysely<DbSchema>) {}

	/**
	 * Atomically replaces all resource associations for a given message.
	 * This involves deleting current references and inserting the new set.
	 * 
	 * 原子地替换给定消息的所有资源关联。这包括删除当前引用并插入新集。
	 */
	async replaceForMessage(messageId: string, resources: ChatResourceRef[]): Promise<void> {
		await this.db.transaction().execute(async (trx) => {
			// Delete existing resources | 删除现有资源
			await trx.deleteFrom('chat_message_resource').where('message_id', '=', messageId).execute();

			// Insert new resources | 插入新资源
			if (resources.length > 0) {
				const values = resources.map((res) => ({
					id: res.id || `${messageId}-${res.source}`,
					message_id: messageId,
					source: res.source,
					kind: res.kind ?? null,
					summary_note_rel_path: res.summaryNotePath ?? null,
					meta_json: null, // Reserved for future extension | 为未来扩展保留
				}));
				await trx.insertInto('chat_message_resource').values(values).execute();
			}
		});
	}

	/**
	 * Retrieves all resources attached to a single message.
	 * 获取附加到单条消息的所有资源。
	 */
	async getByMessageId(messageId: string): Promise<DbSchema['chat_message_resource'][]> {
		return this.db
			.selectFrom('chat_message_resource')
			.selectAll()
			.where('message_id', '=', messageId)
			.execute();
	}

	/**
	 * Efficiently fetches resources for multiple messages in a single query.
	 * Useful for rendering conversation views where many messages have attachments.
	 * 
	 * 在单次查询中高效地获取多个消息的资源。这在渲染许多消息带有附件的对话视图时非常有用。
	 */
	async getByMessageIds(messageIds: string[]): Promise<Map<string, DbSchema['chat_message_resource'][]>> {
		if (messageIds.length === 0) return new Map();
		const rows = await this.db
			.selectFrom('chat_message_resource')
			.selectAll()
			.where('message_id', 'in', messageIds)
			.execute();
		const result = new Map<string, DbSchema['chat_message_resource'][]>();
		for (const row of rows) {
			const existing = result.get(row.message_id) || [];
			existing.push(row);
			result.set(row.message_id, existing);
		}
		return result;
	}
}
