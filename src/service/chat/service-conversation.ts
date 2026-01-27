/**
 * ============================================================================
 * 文件说明: service-conversation.ts - 对话服务
 * ============================================================================
 * 
 * 【这个文件是干什么的】
 * 这个文件负责管理单个对话（Conversation）的完整生命周期，包括创建对话、
 * 发送消息、接收 AI 回复、管理上下文窗口等。就像一个专业的对话助手，
 * 负责记录你和 AI 的每一轮交流。
 * 
 * 【起了什么作用】
 * 1. 对话管理: 创建、更新、删除对话，管理对话的元数据（标题、时间等）
 * 2. 消息处理: 处理用户消息和 AI 回复，维护消息历史
 * 3. 上下文构建: 为 AI 构建合适的上下文（历史消息、附加资源、用户画像等）
 * 4. 流式输出: 支持流式接收 AI 回复，实时显示生成的内容
 * 5. 资源管理: 处理对话中的附件（图片、PDF、文档等）
 * 6. 自动摘要: 自动生成对话摘要，帮助快速回顾
 * 
 * 【举例介绍】
 * 当你与 AI 进行一次对话时：
 * 
 * 1. 创建对话：
 *    createConversation({ title: "讨论项目计划", project: myProject })
 *    - 生成唯一的对话 ID
 *    - 创建对话文件
 *    - 初始化对话元数据
 * 
 * 2. 发送消息：
 *    sendMessage(conversation, "帮我分析这个项目的风险")
 *    - 构建上下文：包含历史消息、项目资源、用户偏好
 *    - 调用 AI 模型生成回复
 *    - 流式返回结果，边生成边显示
 *    - 保存完整的消息记录
 * 
 * 3. 添加资源：
 *    - 上传文件或添加笔记链接
 *    - 自动生成资源摘要
 *    - 将资源纳入对话上下文
 * 
 * 4. 自动功能：
 *    - 自动生成对话标题（基于前几条消息）
 *    - 自动更新对话摘要
 *    - 智能管理上下文窗口大小
 * 
 * 【技术实现】
 * - 使用 AsyncGenerator 实现流式输出
 * - ContextBuilder 负责智能构建上下文
 * - ResourceLoaderManager 处理各种类型的附件
 * - 与存储层解耦，通过 ChatStorageService 持久化
 * ============================================================================
 */

import { App } from 'obsidian';
import { generateUuidWithoutHyphens } from '@/core/utils/id-utils';
import { LLMProviderService, LLMUsage, LLMOutputControlSettings, LLMStreamEvent, ToolEvent } from '@/core/providers/types';
import { AIServiceSettings, DEFAULT_AI_SERVICE_SETTINGS } from '@/app/settings/types';
import { ChatStorageService } from '@/core/storage/vault/ChatStore';
import { DEFAULT_SUMMARY } from '@/core/constant';
import { EventBus, MessageSentEvent, ConversationCreatedEvent, ConversationUpdatedEvent } from '@/core/eventBus';
import { LLMRequestMessage } from '@/core/providers/types';
import {
	ChatContextWindow,
	ChatConversation,
	ChatConversationMeta,
	ChatMessage,
	ChatProject,
	ChatProjectMeta,
	StarredMessageRecord,
	ChatResourceRef,
} from './types';
import { PromptService } from '@/service/prompt/PromptService';
import { UserProfileService } from '@/service/chat/context/UserProfileService';
import { PromptId } from '@/service/prompt/PromptId';
import { ResourceSummaryService } from './context/ResourceSummaryService';
import { ContextBuilder } from './context/ContextBuilder';
import { DocumentLoaderManager } from '@/core/document/loader/helper/DocumentLoaderManager';
import { ResourceLoaderManager } from '@/core/document/resource/helper/ResourceLoaderManager';
import type { AIServiceManager } from './service-manager';
import { createChatMessage } from '@/service/chat/utils/chat-message-builder';
import { generateContentPreview, generateAttachmentSummary } from '@/core/utils/message-preview-utils';
import { getFileTypeFromPath } from '@/core/document/helper/FileTypeUtils';
import { resolveModelCapabilities } from '@/core/providers/types';
import { detectTimezone } from '@/ui/view/shared/date-utils';
import { uploadFilesToVault } from '@/core/utils/vault-utils';

interface ChatPreparationResult {
	modelId: string;
	provider: string;
	timezone: string;
	prompt: LLMRequestMessage[];
	outputControl?: LLMOutputControlSettings;
}

/**
 * 对话管理服务
 * 
 * 【核心职责】
 * 负责处理用户与 AI 之间的对话，是整个聊天功能的核心
 * 
 * 【主要功能】
 * 1. 创建和管理对话
 * 2. 发送消息并接收 AI 回复
 * 3. 构建上下文（历史消息、资源、用户画像）
 * 4. 处理文件上传和资源管理
 * 5. 生成对话摘要
 * 
 * Service for managing chat conversations.
 */
export class ConversationService {
	// 上下文构建器：负责为 AI 组装合适的上下文
	// 包括历史消息、系统提示词、用户画像等
	private readonly contextBuilder: ContextBuilder;
	
	// 资源加载器管理器：处理各种类型的附件
	// 支持图片、PDF、音频、Obsidian 笔记等
	private readonly resourceLoaderManager: ResourceLoaderManager;

	/**
	 * 构造函数
	 * 
	 * 【参数说明】
	 * @param app - Obsidian 应用实例，用于访问 vault、文件系统等
	 * @param storage - 存储服务，负责对话的持久化存储
	 * @param chat - LLM 提供商服务，用于与 AI 模型通信
	 * @param promptService - 提示词服务，管理各种提示词模板
	 * @param defaultModel - 默认使用的 AI 模型（如 {provider: 'openai', modelId: 'gpt-4'})
	 * @param resourceSummaryService - 资源摘要服务，为上传的文件生成摘要
	 * @param aiServiceManager - AI 服务管理器，用于访问其他服务
	 * @param profileService - 用户画像服务（可选），提供个性化信息
	 * @param settings - 插件设置（可选）
	 */
	constructor(
		private readonly app: App,
		private readonly storage: ChatStorageService,
		private readonly chat: LLMProviderService,
		private readonly promptService: PromptService,
		private readonly defaultModel: { provider: string; modelId: string },
		private readonly resourceSummaryService: ResourceSummaryService,
		private readonly aiServiceManager: AIServiceManager,
		private readonly profileService?: UserProfileService,
		private readonly settings?: AIServiceSettings,
	) {
		// 创建资源加载器管理器
		// 这个管理器能处理各种类型的资源：
		// - 图片（PNG, JPG）：转为 base64 发给支持视觉的 AI
		// - PDF：提取文本内容
		// - 音频/视频：转写为文本
		// - Obsidian 笔记：读取内容并解析链接
		this.resourceLoaderManager = new ResourceLoaderManager(
			this.app,                              // Obsidian 应用实例
			this.aiServiceManager,                 // 用于访问其他服务（如语音转写）
			DocumentLoaderManager.getInstance()    // 文档加载器（用于加载 Obsidian 笔记）
		);
		
		// 初始化上下文构建器
		// 这个构建器是智能对话的关键，它会：
		// 1. 选择合适的历史消息（避免超过上下文窗口）
		// 2. 添加系统提示词（告诉 AI 它的角色和任务）
		// 3. 注入用户画像（让 AI 了解用户的偏好）
		// 4. 添加相关资源（附件、引用的笔记等）
		// Initialize context builder
		this.contextBuilder = new ContextBuilder(
			this.promptService,            // 提示词服务
			this.resourceSummaryService,   // 资源摘要服务
			this.profileService,           // 用户画像服务
		);
	}

	/**
	 * 列出对话，可按项目筛选
	 * 
	 * 【功能说明】
	 * 获取对话列表，支持分页和按项目筛选
	 * 
	 * 【参数说明】
	 * @param projectId - 项目 ID（null 表示获取所有对话）
	 * @param limit - 每页数量（可选）
	 * @param offset - 跳过的数量（可选）
	 * 
	 * 【使用示例】
	 * // 获取所有对话
	 * const all = await service.listConversations(null);
	 * 
	 * // 获取特定项目的对话
	 * const projectConvs = await service.listConversations('proj_123');
	 * 
	 * // 分页查询：第2页，每页20条
	 * const page2 = await service.listConversations(null, 20, 20);
	 * 
	 * List conversations, optionally filtered by project.
	 * Supports pagination with limit and offset.
	 */
	async listConversations(projectId: string | null, limit?: number, offset?: number): Promise<ChatConversation[]> {
		// 直接委托给存储服务来查询
		// 存储服务会扫描 Chats/ 文件夹，读取 frontmatter
		// 如果指定了 projectId，只返回该项目下的对话
		return this.storage.listConversations(projectId, limit, offset);
	}

	/**
	 * 统计对话数量
	 * 
	 * 【功能说明】
	 * 计算对话的总数，可按项目筛选
	 * 
	 * 【参数说明】
	 * @param projectId - 项目 ID（null 表示统计所有对话）
	 * 
	 * 【使用场景】
	 * 用于分页显示，计算总页数
	 * 
	 * 【使用示例】
	 * const total = await service.countConversations(null);
	 * const pageCount = Math.ceil(total / pageSize);
	 * 
	 * Count conversations, optionally filtered by project.
	 */
	async countConversations(projectId: string | null): Promise<number> {
		// 直接委托给存储服务来统计
		// 存储服务会扫描 Chats/ 文件夹并计数
		return this.storage.countConversations(projectId);
	}

	/**
	 * 创建新对话
	 * 
	 * 【功能说明】
	 * 创建一个新的聊天对话，可以选择性地添加初始消息
	 * 
	 * 【参数说明】
	 * @param params 
	 *   - title: 对话标题，例如："讨论项目计划"
	 *   - project: 所属项目（可选），例如：{ id: 'proj_123', title: 'React学习' }
	 *   - initialMessages: 初始消息（可选），例如：[{ role: 'user', content: '你好' }]
	 *   - modelId: 使用的模型 ID（可选），例如：'gpt-4'
	 *   - provider: AI 提供商（可选），例如：'openai'
	 * 
	 * 【返回值】
	 * 返回创建的对话对象，包含 ID、元数据、消息等
	 * 
	 * 【执行流程】
	 * 1. 生成对话 ID 和元数据
	 * 2. 保存到文件系统（创建 .md 文件）
	 * 3. 触发对话创建事件（通知其他服务）
	 * 
	 * 【使用示例】
	 * // 创建空白对话
	 * const conv1 = await service.createConversation({
	 *   title: '新对话'
	 * });
	 * 
	 * // 创建带初始消息的对话
	 * const conv2 = await service.createConversation({
	 *   title: 'React 咨询',
	 *   project: myProject,
	 *   initialMessages: [
	 *     { role: 'user', content: '请介绍 React Hooks' }
	 *   ],
	 *   modelId: 'gpt-4'
	 * });
	 * 
	 * Create a new conversation with optional seed messages.
	 */
	async createConversation(params: {
		title: string;
		project?: ChatProjectMeta | null;
		initialMessages?: ChatMessage[];
		modelId?: string;
		provider?: string;
	}): Promise<ChatConversation> {
		// 获取当前时间戳
		// 用于记录对话的创建和更新时间
		const timestamp = Date.now();
		
		// 构建对话元数据
		// 元数据包含对话的所有关键信息，会保存在文件的 frontmatter 中
		const meta: ChatConversationMeta = {
			// 生成唯一的对话 ID（无连字符的 UUID）
			// 例如："abc123def456"，用作文件名和标识符
			id: generateUuidWithoutHyphens(),
			
			// 对话标题，显示在对话列表中
			// 如果用户没提供标题，后续可以根据前几条消息自动生成
			title: params.title,
			
			// 所属项目 ID（如果有的话）
			// 这样可以将对话组织到项目下，例如："React学习"项目下的多个对话
			projectId: params.project?.id,
			
			// 创建时间戳（毫秒）
			// 用于排序和显示创建时间
			createdAtTimestamp: timestamp,
			
			// 最后更新时间戳（毫秒）
			// 每次发送消息时会更新，用于排序"最近使用"
			updatedAtTimestamp: timestamp,
			
			// 当前使用的 AI 模型
			// 如果没指定，使用默认模型（如 'gpt-4'）
			activeModel: params.modelId || this.defaultModel.modelId,
			
			// 当前使用的 AI 提供商
			// 如果没指定，使用默认提供商（如 'openai'）
			activeProvider: params.provider || this.defaultModel.provider,
			
			// Token 使用总量（初始为 0）
			// 每次发送消息后会累加，用于统计成本
			tokenUsageTotal: 0,
		};

		// 获取初始消息
		// 如果没有提供初始消息，使用空数组
		const messages = params.initialMessages ?? [];
		
		// 保存对话到文件系统
		// 这会创建一个 Chats/conv_xxx.md 文件
		// 文件包含：frontmatter（元数据）+ 消息内容（Markdown 格式）
		const conversation = await this.storage.saveConversation(
			params.project ?? null,  // 项目信息（可选）
			meta,                    // 对话元数据
			undefined,               // 上下文信息（首次创建时为空）
			messages                 // 初始消息列表
		);

		// 触发对话创建事件
		// 其他服务（如统计服务、索引服务）会监听这个事件并做出响应
		// 例如：统计服务会记录"今天创建了几个对话"
		// Trigger conversation created event
		const eventBus = EventBus.getInstance(this.app);
		eventBus.dispatch(new ConversationCreatedEvent({
			conversationId: conversation.meta.id,  // 新建对话的 ID
			projectId: conversation.meta.projectId ?? null,  // 所属项目 ID（如果有）
		}));

		// 返回创建的对话对象
		// 包含完整的元数据和消息列表
		return conversation;
	}

	/**
	 * Upload files and create resource references.
	 * Uploads files to vault and creates resourceRef for each file.
	 * 
	 * @param files Files to upload
	 * @returns Array of resource references
	 */
	async uploadFilesAndCreateResources(files: File[]): Promise<ChatResourceRef[]> {
		if (!files || files.length === 0) {
			return [];
		}

		// Get upload folder from settings
		const uploadFolder = this.settings?.uploadFolder || 'uploads';

		// Upload files to vault
		const uploadedPaths = await uploadFilesToVault(this.app, files, uploadFolder);

		// Create resource references for uploaded files
		const resources: ChatResourceRef[] = [];
		for (const filePath of uploadedPaths) {
			const resourceRef = this.resourceSummaryService!.createResourceRef(filePath);
			const summaryPath = this.resourceSummaryService!.getResourceSummaryPath(resourceRef.id);
			resourceRef.summaryNotePath = summaryPath;

			// only generate when streaming
			// // Ensure resource summary exists, generate if missing
			// await this.ensureResourceSummary(filePath, resourceRef);

			resources.push(resourceRef);
		}

		return resources;
	}

	/**
	 * Send a message and stream incremental model output.
	 */
	streamChat(params: {
		conversation: ChatConversation;
		project?: ChatProject | null;
		userContent: string;
		attachments?: string[];
	}): AsyncGenerator<LLMStreamEvent> {
		const self = this;
		return (async function* (): AsyncGenerator<LLMStreamEvent> {
			const preparationGenerator = self.prepareChatRequest(params);
			// Manually iterate through the generator to get both events and final result
			let prepared: ChatPreparationResult | undefined;
			let result: IteratorResult<LLMStreamEvent, ChatPreparationResult>;
			while (!(result = await preparationGenerator.next()).done) {
				// Yield all intermediate events
				if (result.value) {
					yield result.value;
				}
			}
			// Get the final return value
			prepared = result.value;

			const stream = self.chat.streamChat({
				provider: prepared.provider,
				model: prepared.modelId,
				messages: prepared.prompt,
				outputControl: prepared.outputControl,
			});
			yield* stream;
		})();
	}

	/**
	 * Prepare chat request: create user message, process attachments, build LLM messages
	 */
	private async *prepareChatRequest(params: {
		conversation: ChatConversation;
		project?: ChatProject | null;
		userContent: string;
		attachments?: string[];
	}): AsyncGenerator<LLMStreamEvent, ChatPreparationResult, void> {
		const { conversation, project, userContent, attachments } = params;
		const modelId = conversation.meta.activeModel || this.defaultModel.modelId;
		const provider = conversation.meta.activeProvider || this.defaultModel.provider;
		// Get model capabilities and attachment handling mode
		const currentModel = await this.aiServiceManager.getModelInfo(modelId, provider);
		const modelCapabilities = resolveModelCapabilities(currentModel);

		const timezone = detectTimezone();
		const originalUserMessage = createChatMessage('user', userContent, modelId, provider, timezone);

		// Convert legacy attachments to resources if provided
		const attachmentHandlingMode = conversation.meta.attachmentHandlingOverride
			?? this.settings?.attachmentHandlingDefault
			?? DEFAULT_AI_SERVICE_SETTINGS.attachmentHandlingDefault;
		if (attachments && attachments.length > 0) {
			const resources = [];
			for (const attachment of attachments) {
				const resourceRef = this.resourceSummaryService!.createResourceRef(attachment);
				const summaryPath = this.resourceSummaryService!.getResourceSummaryPath(resourceRef.id);
				resourceRef.summaryNotePath = summaryPath;

				// Check if we should generate summary or use direct mode
				if (attachmentHandlingMode !== 'direct') {
					// Degrade mode or non-vision: ensure resource summary exists
					yield { type: 'tool-call', toolName: ToolEvent.GENERATE_SUMMARY, input: attachment };
					await this.ensureResourceSummary(attachment, resourceRef);
					yield { type: 'tool-result', toolName: ToolEvent.GENERATE_SUMMARY, input: attachment };
				}

				resources.push(resourceRef);
			}
			originalUserMessage.resources = resources;
		}

		// Build prompt from context and user input
		const historyMessage = [...conversation.messages, originalUserMessage];
		const contextGenerator = this.contextBuilder.buildContextMessages({
			conversation,
			project,
			messages: historyMessage,
			modelCapabilities,
			attachmentHandlingMode,
			app: this.app,
		});
		// Consume progress events
		let result: IteratorResult<LLMStreamEvent, LLMRequestMessage[]>;
		while (!(result = await contextGenerator.next()).done) {
			// Yield all intermediate events
			if (result.value) {
				yield result.value;
			}
		}
		const prompt = result.value;

		// todo check result length and check whether overflow the model's context window. if so, we need to truncate the result.

		// Get output control settings: priority: conversation override > global default
		const outputControl = conversation.meta.outputControlOverride
			?? this.settings?.defaultOutputControl
			?? DEFAULT_AI_SERVICE_SETTINGS.defaultOutputControl;

		return {
			modelId,
			provider,
			timezone,
			prompt: prompt,
			outputControl,
		};
	}

	/**
	 * Update conversation context only (summary), keeping messages unchanged.
	 * Uses optimistic locking by checking updatedAtTimestamp.
	 */
	async updateConversationContext(params: {
		conversation: ChatConversation;
		project?: ChatProject | null;
		context: ChatContextWindow;
		messageIndex: number; // Message index when context was updated
	}): Promise<ChatConversation> {
		const { conversation, project, context, messageIndex } = params;
		// Update context but keep messages unchanged
		const updatedMeta: ChatConversationMeta = {
			...conversation.meta,
			updatedAtTimestamp: Date.now(),
			contextLastUpdatedTimestamp: Date.now(),
			contextLastMessageIndex: messageIndex,
		};
		return await this.storage.saveConversation(
			project?.meta ?? null,
			updatedMeta,
			context
		);
	}

	/**
	 * Update conversation's active model.
	 */
	async updateConversationModel(params: {
		conversationId: string;
		modelId: string;
		provider: string;
	}): Promise<void> {
		const { conversationId, modelId, provider } = params;

		// Save updated meta
		await this.storage.upsertConversationMeta(
			conversationId,
			{
				activeModel: modelId,
				activeProvider: provider,
				updatedAtTimestamp: Date.now(),
			}
		);
	}

	/**
	 * Update conversation's output control override settings.
	 */
	async updateConversationOutputControl(params: {
		conversationId: string;
		outputControlOverride?: LLMOutputControlSettings;
	}): Promise<void> {
		const { conversationId, outputControlOverride } = params;

		// Save updated meta
		await this.storage.upsertConversationMeta(
			conversationId,
			{
				outputControlOverride: outputControlOverride && Object.keys(outputControlOverride).length > 0 ? outputControlOverride : undefined,
				updatedAtTimestamp: Date.now(),
			}
		);
	}

	/**
	 * Update conversation's attachment handling mode override.
	 */
	async updateConversationAttachmentHandling(params: {
		conversationId: string;
		attachmentHandlingOverride?: 'direct' | 'degrade_to_text';
	}): Promise<void> {
		const { conversationId, attachmentHandlingOverride } = params;

		// Save updated meta
		await this.storage.upsertConversationMeta(
			conversationId,
			{
				attachmentHandlingOverride: attachmentHandlingOverride,
				updatedAtTimestamp: Date.now(),
			}
		);

		// Trigger conversation updated event
		const updatedConversation = await this.storage.readConversation(conversationId, false);
		if (updatedConversation) {
			const eventBus = EventBus.getInstance(this.app);
			eventBus.dispatch(new ConversationUpdatedEvent({
				conversation: updatedConversation,
			}));
		}
	}

	/**
	 * Update conversation title by renaming the file.
	 * @param params.titleManuallyEdited - If true, marks the title as manually edited (default: true)
	 * @param params.titleAutoUpdated - If true, marks the title as auto-updated (default: false)
	 */
	async updateConversationTitle(params: {
		conversationId: string;
		title: string;
		titleManuallyEdited?: boolean;
		titleAutoUpdated?: boolean;
	}): Promise<void> {
		const { conversationId, title, titleManuallyEdited = true, titleAutoUpdated = false } = params;

		// Rename file and get new relative path
		const newFileRelPath = await this.storage.renameConversationFile(conversationId, title);

		// Save updated meta (file path is updated in sqlite)
		await this.storage.upsertConversationMeta(conversationId, {
			id: conversationId,
			title,
			titleManuallyEdited,
			titleAutoUpdated,
			fileRelPath: newFileRelPath,
		});

		// Trigger conversation updated event
		const updatedConversation = await this.storage.readConversation(conversationId, false);
		if (updatedConversation) {
			const eventBus = EventBus.getInstance(this.app);
			eventBus.dispatch(new ConversationUpdatedEvent({
				conversation: updatedConversation,
			}));
		}
	}

	/**
	 * Toggle star status on a message.
	 * When starring, generates and saves content preview and attachment summary.
	 */
	async toggleStar(params: {
		messageId: string;
		conversationId: string;
		starred: boolean;
	}): Promise<void> {
		const { messageId, starred, conversationId } = params;

		let contentPreview: string | null = null;
		let attachmentSummary: string | null = null;

		// When starring, load message content to generate preview
		if (starred) {
			const conversation = await this.storage.readConversation(conversationId, true);
			if (conversation) {
				const message = conversation.messages.find((m) => m.id === messageId);
				if (message) {
					// Generate preview and summary
					contentPreview = generateContentPreview(message.content);
					attachmentSummary = generateAttachmentSummary(message.resources);
				}
			}
		}

		// Update starred status with preview data
		await this.storage.updateMessageStarred(messageId, starred, contentPreview, attachmentSummary);
	}

	/**
	 * Load starred message records.
	 */
	async loadStarred(): Promise<StarredMessageRecord[]> {
		return this.storage.listStarred();
	}

	/**
	 * Add a message to conversation and save it.
	 */
	async addMessage(params: {
		conversationId: string;
		message: ChatMessage;
		model: string;
		provider: string;
		usage: LLMUsage;
	}): Promise<void> {
		const { conversationId, message, model, provider, usage } = params;

		// Save message to storage (low-level operation: updates DB and file)
		await this.storage.saveNewMessage(conversationId, message);

		// Update conversation meta only (model, provider, token usage, updated timestamp)
		// This is a lightweight operation that doesn't rebuild context
		const updatedMeta = await this.storage.upsertConversationMeta(conversationId, {
			activeModel: model,
			activeProvider: provider,
			tokenUsageTotal: usage?.totalTokens ?? 0,
		});
		if (!updatedMeta) {
			throw new Error(`Failed to update conversation meta: ${conversationId}`);
		}

		// Trigger message sent event
		const eventBus = EventBus.getInstance(this.app);
		eventBus.dispatch(new MessageSentEvent({
			conversationId: conversationId,
			projectId: null,
		}));
	}

	/**
	 * Generate a title for conversation based on messages and context.
	 * Uses the ApplicationGenerateTitle prompt to generate a concise title.
	 */
	async generateConversationTitle(messages: ChatMessage[], context: ChatContextWindow): Promise<string | null> {
		if (messages.length === 0) {
			return null;
		}

		try {
			// Use first few messages to generate title (to keep it focused on the initial topic)
			const messagesForTitle = messages.slice(0, Math.min(5, messages.length));
			const messagesForPrompt = messagesForTitle.map((m) => ({
				role: m.role,
				content: m.content,
			}));

			// Use context summary if available to provide better context for title generation
			const contextInfo = context.shortSummary && context.shortSummary !== DEFAULT_SUMMARY
				? `Context: ${context.shortSummary}`
				: undefined;

			const title = await this.promptService.chatWithPrompt(
				PromptId.ApplicationGenerateTitle,
				{
					messages: messagesForPrompt,
					contextInfo,
				}
			);

			// Clean up title: remove quotes, trim, and limit length
			const cleanedTitle = title
				.replace(/^["']|["']$/g, '') // Remove surrounding quotes
				.trim()
				.substring(0, 50); // Limit to 50 characters

			return cleanedTitle || null;
		} catch (error) {
			console.warn('[ConversationService] Failed to generate title:', error);
			return null;
		}
	}


	/**
	 * Build a compact context window for summarization.
	 */
	async buildContextWindow(
		messages: ChatMessage[],
		project?: ChatProject | null,
	): Promise<ChatContextWindow> {
		if (messages.length === 0) {
			return {
				lastUpdatedTimestamp: Date.now(),
				recentMessagesWindow: [],
				shortSummary: DEFAULT_SUMMARY,
			};
		}

		const recent = messages.slice(-10);
		const recentMessagesWindow = [
			{
				fromMessageId: recent[0].id,
				toMessageId: recent[recent.length - 1].id,
			},
		];

		// Generate real summary using LLM
		try {
			const messagesForSummary = recent.map((m) => ({
				role: m.role,
				content: m.content,
			}));

			// Build project context if available
			const projectContext = project
				? `Project: ${project.meta.name}${project.context?.shortSummary ? `\n${project.context.shortSummary}` : ''}`
				: undefined;

			// Generate short summary
			const shortSummary = await this.promptService.chatWithPrompt(
				PromptId.ConversationSummaryShort,
				{
					messages: messagesForSummary,
					projectContext,
				},
			) || DEFAULT_SUMMARY;

			// Generate full summary if conversation is substantial
			let fullSummary: string | undefined;
			if (messages.length > 5) {
				fullSummary = await this.promptService.chatWithPrompt(
					PromptId.ConversationSummaryFull,
					{
						messages: messagesForSummary,
						projectContext,
						shortSummary,
					},
				);
			}

			return {
				lastUpdatedTimestamp: Date.now(),
				recentMessagesWindow,
				shortSummary,
				fullSummary,
			};
		} catch (error) {
			console.warn('[ConversationService] Failed to generate summary:', error);
			return {
				lastUpdatedTimestamp: Date.now(),
				recentMessagesWindow,
				shortSummary: DEFAULT_SUMMARY,
			};
		}
	}

	/**
	 * Ensure resource summary exists, generate if missing.
	 * For images: uses ImageDescription prompt for generating descriptions.
	 */
	private async ensureResourceSummary(sourcePath: string, resourceRef: ChatResourceRef): Promise<void> {
		if (!this.resourceSummaryService) {
			return;
		}

		// Check if summary already exists
		const existing = await this.resourceSummaryService.readResourceSummary(resourceRef.id);
		if (existing?.meta.shortSummary || existing?.meta.fullSummary) {
			// Summary already exists
			return;
		}

		// Generate summary for the resource
		try {
			const summary = await this.resourceLoaderManager.getSummary(
				sourcePath,
				resourceRef.kind,
			) || { shortSummary: `Resource: ${sourcePath}` };

			// Save summary
			await this.resourceSummaryService.saveResourceSummary({
				resourceId: resourceRef.id,
				source: resourceRef.source,
				kind: resourceRef.kind,
				shortSummary: summary.shortSummary,
				fullSummary: summary.fullSummary,
			});
		} catch (error) {
			console.warn(`[ConversationService] Failed to generate resource summary for ${sourcePath}:`, error);
			// Create summary with error information
			const errorReason = error instanceof Error ? error.message : String(error);
			const errorDate = new Date().toISOString();
			const errorSummary = `GenSummaryFailed.[${errorReason}][${errorDate}]`;
			await this.resourceSummaryService.saveResourceSummary({
				resourceId: resourceRef.id,
				source: resourceRef.source,
				kind: resourceRef.kind,
				shortSummary: errorSummary,
			});
		}
	}

}
