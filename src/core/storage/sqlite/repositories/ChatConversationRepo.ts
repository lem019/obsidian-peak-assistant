import type { Kysely } from 'kysely';
import type { Database as DbSchema } from '../ddl';

/**
 * Chat Conversation Repository
 * 
 * Manages the `chat_conversation` table. This tracks the metadata for individual 
 * chat files (.md files in the vault), including titles, project associations, 
 * LLM model/provider info, and token usage summaries.
 * 
 * 对话存储库
 * 
 * 管理 `chat_conversation` 表。这跟踪单个对话文件（库中的 .md 文件）的元数据，
 * 包括标题、项目关联、LLM 模型/提供者信息以及令牌使用情况摘要。
 */
export class ChatConversationRepo {
	constructor(private readonly db: Kysely<DbSchema>) {}

	/**
	 * Checks if a conversation exists by its unique ID.
	 * 检查对话是否按其唯一 ID 存在。
	 */
	async existsByConversationId(conversationId: string): Promise<boolean> {
		const row = await this.db
			.selectFrom('chat_conversation')
			.select('conversation_id')
			.where('conversation_id', '=', conversationId)
			.executeTakeFirst();
		return row !== undefined;
	}

	/**
	 * Inserts a new conversation record.
	 * 插入新的对话记录。
	 */
	async insert(conversation: {
		conversation_id: string;
		project_id: string | null;
		title: string;
		file_rel_path: string;
		created_at_ts: number;
		updated_at_ts: number;
		active_model: string | null;
		active_provider: string | null;
		token_usage_total: number | null;
		title_manually_edited: number;
		title_auto_updated: number;
		context_last_updated_ts: number | null;
		context_last_message_index: number | null;
		archived_rel_path: string | null;
		meta_json: string | null;
	}): Promise<void> {
		await this.db
			.insertInto('chat_conversation')
			.values(conversation)
			.execute();
	}

	/**
	 * Updates an existing conversation record.
	 * 更新现有的对话记录。
	 */
	async updateByConversationId(conversationId: string, updates: Partial<Pick<DbSchema['chat_conversation'], 'project_id' | 'title' | 'file_rel_path' | 'updated_at_ts' | 'active_model' | 'active_provider' | 'token_usage_total' | 'title_manually_edited' | 'title_auto_updated' | 'context_last_updated_ts' | 'context_last_message_index' | 'archived_rel_path' | 'meta_json'>>): Promise<void> {
		await this.db
			.updateTable('chat_conversation')
			.set(updates)
			.where('conversation_id', '=', conversationId)
			.execute();
	}

	/**
	 * Upserts conversation metadata.
	 * 更新或插入对话元数据。
	 */
	async upsertConversation(params: {
		conversationId: string;
		projectId?: string | null;
		title: string;
		fileRelPath: string;
		createdAtTs: number;
		updatedAtTs: number;
		activeModel?: string | null;
		activeProvider?: string | null;
		tokenUsageTotal?: number | null;
		titleManuallyEdited?: boolean;
		titleAutoUpdated?: boolean;
		contextLastUpdatedTimestamp?: number | null;
		contextLastMessageIndex?: number | null;
		archivedRelPath?: string | null;
		metaJson?: string | null;
	}): Promise<void> {
		const exists = await this.existsByConversationId(params.conversationId);

		if (exists) {
			// Update existing conversation | 更新现有对话
			await this.updateByConversationId(params.conversationId, {
				project_id: params.projectId ?? null,
				title: params.title,
				file_rel_path: params.fileRelPath,
				updated_at_ts: params.updatedAtTs,
				active_model: params.activeModel ?? null,
				active_provider: params.activeProvider ?? null,
				token_usage_total: params.tokenUsageTotal ?? null,
				title_manually_edited: params.titleManuallyEdited ? 1 : 0,
				title_auto_updated: params.titleAutoUpdated ? 1 : 0,
				context_last_updated_ts: params.contextLastUpdatedTimestamp ?? null,
				context_last_message_index: params.contextLastMessageIndex ?? null,
				archived_rel_path: params.archivedRelPath ?? null,
				meta_json: params.metaJson ?? null,
			});
		} else {
			// Insert new conversation | 插入新对话
			await this.insert({
				conversation_id: params.conversationId,
				project_id: params.projectId ?? null,
				title: params.title,
				file_rel_path: params.fileRelPath,
				created_at_ts: params.createdAtTs,
				updated_at_ts: params.updatedAtTs,
				active_model: params.activeModel ?? null,
				active_provider: params.activeProvider ?? null,
				token_usage_total: params.tokenUsageTotal ?? null,
				title_manually_edited: params.titleManuallyEdited ? 1 : 0,
				title_auto_updated: params.titleAutoUpdated ? 1 : 0,
				context_last_updated_ts: params.contextLastUpdatedTimestamp ?? null,
				context_last_message_index: params.contextLastMessageIndex ?? null,
				archived_rel_path: params.archivedRelPath ?? null,
				meta_json: params.metaJson ?? null,
			});
		}
	}

	/**
	 * Retrieves conversation details by ID.
	 * 通过 ID 获取对话详情。
	 */
	async getById(conversationId: string): Promise<DbSchema['chat_conversation'] | null> {
		const row = await this.db
			.selectFrom('chat_conversation')
			.selectAll()
			.where('conversation_id', '=', conversationId)
			.executeTakeFirst();
		return row ?? null;
	}

	/**
	 * Lists conversations belonging to a project, or root-level conversations.
	 * 列出属于某个项目的对话，或根级别的对话。
	 */
	async listByProject(
		projectId: string | null,
		includeArchived: boolean = false,
		limit?: number,
		offset?: number
	): Promise<DbSchema['chat_conversation'][]> {
		let query = this.db.selectFrom('chat_conversation').selectAll();
		if (projectId === null) {
			query = query.where('project_id', 'is', null);
		} else {
			query = query.where('project_id', '=', projectId);
		}
		if (!includeArchived) {
			query = query.where('archived_rel_path', 'is', null);
		}
		query = query.orderBy('updated_at_ts', 'desc');

		if (offset !== undefined) {
			query = query.offset(offset);
		}
		if (limit !== undefined) {
			query = query.limit(limit);
		}

		return query.execute();
	}

	/**
	 * Counts the number of conversations in a specific project.
	 * 计算特定项目中的对话数量。
	 */
	async countByProject(
		projectId: string | null,
		includeArchived: boolean = false
	): Promise<number> {
		let query = this.db.selectFrom('chat_conversation').select(this.db.fn.countAll().as('count'));
		if (projectId === null) {
			query = query.where('project_id', 'is', null);
		} else {
			query = query.where('project_id', '=', projectId);
		}
		if (!includeArchived) {
			query = query.where('archived_rel_path', 'is', null);
		}
		const result = await query.executeTakeFirst();
		return Number(result?.count ?? 0);
	}

	/**
	 * Updates the markdown file path for a conversation.
	 * 更新对话的 Markdown 文件路径。
	 */
	async updateFilePath(conversationId: string, newFileRelPath: string, newArchivedRelPath?: string | null): Promise<void> {
		await this.db
			.updateTable('chat_conversation')
			.set({
				file_rel_path: newFileRelPath,
				archived_rel_path: newArchivedRelPath ?? null,
			})
			.where('conversation_id', '=', conversationId)
			.execute();
	}
}
