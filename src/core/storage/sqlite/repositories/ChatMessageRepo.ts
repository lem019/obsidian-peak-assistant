import type { Kysely } from 'kysely';
import type { Database as DbSchema } from '../ddl';
import { sql } from 'kysely';
import type { ChatMessage } from '@/service/chat/types';
import { hashMD5 } from '@/core/utils/hash-utils';

/**
 * Chat Message Repository
 * 
 * Manages the `chat_message` table. This stores individual turns in a 
 * conversation (user/assistant/system), including the actual content, 
 * AI "thinking" logs, token usage, and starred status.
 * 
 * 对话消息存储库
 * 
 * 管理 `chat_message` 表。这存储对话中的各个轮次（用户/助手/系统），
 * 包括实际内容、AI“思考”日志、令牌使用情况和收藏状态。
 */
export class ChatMessageRepo {
	constructor(private readonly db: Kysely<DbSchema>) {}

	/**
	 * Checks if a message exists by its unique ID.
	 * 检查消息是否按其唯一 ID 存在。
	 */
	async existsByMessageId(messageId: string): Promise<boolean> {
		const row = await this.db
			.selectFrom('chat_message')
			.select('message_id')
			.where('message_id', '=', messageId)
			.executeTakeFirst();
		return row !== undefined;
	}

	/**
	 * Inserts a new chat message into the database.
	 * 向数据库插入新的对话消息。
	 */
	async insert(message: {
		message_id: string;
		conversation_id: string;
		role: string;
		content_hash: string;
		created_at_ts: number;
		created_at_zone: string;
		model: string | null;
		provider: string | null;
		starred: number;
		is_error: number;
		is_visible: number;
		gen_time_ms: number | null;
		token_usage_json: string | null;
		thinking: string | null;
	}): Promise<void> {
		await this.db
			.insertInto('chat_message')
			.values(message)
			.execute();
	}

	/**
	 * Updates an existing chat message.
	 * 更新现有的对话消息。
	 */
	async updateByMessageId(messageId: string, updates: Partial<Pick<DbSchema['chat_message'], 'conversation_id' | 'role' | 'content_hash' | 'created_at_ts' | 'created_at_zone' | 'model' | 'provider' | 'starred' | 'is_error' | 'is_visible' | 'gen_time_ms' | 'token_usage_json' | 'thinking'>>): Promise<void> {
		await this.db
			.updateTable('chat_message')
			.set(updates)
			.where('message_id', '=', messageId)
			.execute();
	}

	/**
	 * Upserts multiple messages for a conversation, handling duplicates based on message ID.
	 * 更新或插入对话的多个消息，基于消息 ID 处理重复项。
	 */
	async upsertMessages(conversationId: string, messages: ChatMessage[]): Promise<void> {
		if (messages.length === 0) return;

		for (const msg of messages) {
			const messageData = {
				message_id: msg.id,
				conversation_id: conversationId,
				role: msg.role,
				content_hash: hashMD5(msg.content),
				created_at_ts: msg.createdAtTimestamp,
				created_at_zone: msg.createdAtZone,
				model: msg.model ?? null,
				provider: msg.provider ?? null,
				starred: msg.starred ? 1 : 0,
				is_error: msg.isErrorMessage ? 1 : 0,
				is_visible: msg.isVisible !== false ? 1 : 0,
				gen_time_ms: msg.genTimeMs ?? null,
				token_usage_json: msg.tokenUsage ? JSON.stringify(msg.tokenUsage) : null,
				thinking: msg.thinking ?? null,
			};

			const exists = await this.existsByMessageId(msg.id);

			if (exists) {
				// Update existing message | 更新现有消息
				await this.updateByMessageId(msg.id, {
					conversation_id: conversationId,
					role: msg.role,
					content_hash: hashMD5(msg.content),
					created_at_ts: msg.createdAtTimestamp,
					created_at_zone: msg.createdAtZone,
					model: msg.model ?? null,
					provider: msg.provider ?? null,
					starred: msg.starred ? 1 : 0,
					is_error: msg.isErrorMessage ? 1 : 0,
					is_visible: msg.isVisible !== false ? 1 : 0,
					gen_time_ms: msg.genTimeMs ?? null,
					token_usage_json: msg.tokenUsage ? JSON.stringify(msg.tokenUsage) : null,
					thinking: msg.thinking ?? null,
				});
			} else {
				// Insert new message | 插入新消息
				await this.insert(messageData);
			}
		}
	}

	/**
	 * Lists all messages in a conversation, ordered chronologically.
	 * 列出对话中的所有消息，按时间顺序排列。
	 */
	async listByConversation(conversationId: string): Promise<DbSchema['chat_message'][]> {
		return this.db
			.selectFrom('chat_message')
			.selectAll()
			.where('conversation_id', '=', conversationId)
			.orderBy('created_at_ts', 'asc')
			.execute();
	}

	/**
	 * Toggles the "starred" status of a message and manages the persistence 
	 * of content previews for the starred messages list.
	 * 
	 * 切换消息的“收藏”状态，并管理收藏消息列表的内容预览持久化。
	 */
	async updateStarred(
		messageId: string,
		starred: boolean,
		contentPreview?: string | null,
		attachmentSummary?: string | null
	): Promise<void> {
		const updateData: {
			starred: number;
			content_preview?: string | null;
			attachment_summary?: string | null;
		} = {
			starred: starred ? 1 : 0,
		};

		// Only update preview fields when starring (not when unstarring)
		// 仅在收藏时更新预览字段（在取消收藏时清空）
		if (starred) {
			if (contentPreview !== undefined) {
				updateData.content_preview = contentPreview || null;
			}
			if (attachmentSummary !== undefined) {
				updateData.attachment_summary = attachmentSummary || null;
			}
		} else {
			// When unstarring, clear preview fields
			updateData.content_preview = null;
			updateData.attachment_summary = null;
		}

		await this.db
			.updateTable('chat_message')
			.set(updateData)
			.where('message_id', '=', messageId)
			.execute();
	}

	/**
	 * Retrieves all starred messages within a specific project by joining with conversations.
	 * 通过连接对话表获取特定项目内的所有收藏消息。
	 */
	async listStarredByProject(projectId: string): Promise<DbSchema['chat_message'][]> {
		return this.db
			.selectFrom('chat_message')
			.innerJoin('chat_conversation', 'chat_message.conversation_id', 'chat_conversation.conversation_id')
			.selectAll('chat_message')
			.where('chat_conversation.project_id', '=', projectId)
			.where('chat_message.starred', '=', 1)
			.orderBy('chat_message.created_at_ts', 'desc')
			.execute();
	}

	/**
	 * Efficiently counts visible messages in a conversation.
	 * 高效地计算对话中可见消息的数量。
	 */
	async countByConversation(conversationId: string): Promise<number> {
		const result = await this.db
			.selectFrom('chat_message')
			.select(({ fn }) => fn.count<number>('message_id').as('count'))
			.where('conversation_id', '=', conversationId)
			.where('is_visible', '=', 1)
			.executeTakeFirst();

		return result?.count ?? 0;
	}
}
