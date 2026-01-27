/**
 * ============================================================================
 * 文件说明: ContextUpdateService.ts - 上下文自动更新服务
 * ============================================================================
 * 
 * 【这个文件是干什么的】
 * 这个文件负责"智能监控"对话和项目，当消息积累到一定数量时，自动生成或更新摘要。
 * 就像一个聪明的记录员，会定期整理会议纪要，确保你能快速了解之前讨论了什么。
 * 
 * 【起了什么作用】
 * 1. 自动摘要生成：当对话消息达到阈值（默认 5 条）时，自动生成对话摘要
 * 2. 项目摘要维护：当项目中的对话有更新时，自动更新项目级别的摘要
 * 3. 防抖处理：避免频繁更新，等消息停止一段时间（默认 3 秒）后再统一更新
 * 4. 智能标题生成：当对话超过 3 条消息且没有标题时，自动生成合适的标题
 * 
 * 【举例介绍】
 * 场景 1：自动生成对话摘要
 * - 你在一个新对话中问："React Hooks 怎么用？"
 * - AI 回答了
 * - 你又问了 3 个相关问题
 * - ✅ 达到阈值（5 条消息）！服务自动触发：
 *   - 调用 AI 生成对话摘要："讨论了 React Hooks 的基本用法，包括 useState 和 useEffect"
 *   - 将摘要存入数据库，下次对话时可以加载这个摘要作为上下文
 * 
 * 场景 2：防抖处理（避免浪费）
 * - 你快速连发了 5 条消息（每隔 1 秒发一条）
 * - 如果没有防抖：服务会触发 5 次更新，浪费计算资源
 * - ✅ 有了防抖：
 *   - 第 1 条消息发送后，启动 3 秒计时器
 *   - 第 2-5 条消息发送时，计时器不断重置
 *   - 等你停止发送消息 3 秒后，才执行一次更新
 * 
 * 场景 3：自动生成标题
 * - 你创建了一个新对话，系统默认标题是 "New Chat"
 * - 经过 3 轮问答后，服务触发：
 *   - 调用 AI 分析对话内容
 *   - 自动生成标题："React Hooks 学习笔记"
 *   - 更新对话标题，让你更容易找到这个对话
 * 
 * 场景 4：项目摘要更新
 * - 你在 "学习 React" 项目中有 3 个对话
 * - 当任意一个对话更新后，服务会：
 *   - 收集项目下所有对话的摘要
 *   - 生成项目级别的总摘要
 *   - 更新项目笔记的 Frontmatter
 * 
 * 【更新阈值】
 * - 对话摘要更新阈值：5 条新消息（CONVERSATION_SUMMARY_UPDATE_THRESHOLD）
 * - 项目摘要更新阈值：10 条新消息（PROJECT_SUMMARY_UPDATE_THRESHOLD）
 * - 防抖时间：3 秒（SUMMARY_UPDATE_DEBOUNCE_MS）
 * - 标题生成最少消息数：3 条（MIN_MESSAGES_FOR_TITLE_GENERATION）
 * 
 * 【技术实现】
 * - 使用事件总线（EventBus）监听 MESSAGE_SENT 事件
 * - 使用 setTimeout 实现防抖（debounce）
 * - 维护两个 Timer Map：一个管理对话更新，一个管理项目更新
 * - 从数据库读取 contextLastMessageIndex 判断是否需要更新
 * ============================================================================
 */

import { EventBus, MessageSentEvent, ConversationCreatedEvent, ViewEventType } from '@/core/eventBus';
import { CONVERSATION_SUMMARY_UPDATE_THRESHOLD, PROJECT_SUMMARY_UPDATE_THRESHOLD, SUMMARY_UPDATE_DEBOUNCE_MS, DEFAULT_SUMMARY, MIN_MESSAGES_FOR_TITLE_GENERATION } from '@/core/constant';
import type { ConversationService } from '../service-conversation';
import type { ProjectService } from '../service-project';
import type { ChatStorageService } from '@/core/storage/vault/ChatStore';
import type { ChatContextWindow, ChatConversation } from '../types';

/**
 * Service to automatically update summaries based on events.
 * Uses debouncing and threshold-based triggering to avoid excessive updates.
 * Both conversation and project summaries are updated based on message count.
 * 
 * 上下文自动更新服务类
 * 根据事件自动更新摘要。使用防抖和基于阈值的触发机制避免过度更新。
 * 对话摘要和项目摘要都基于消息数量更新。
 */
export class ContextUpdateService {
	private conversationTimers = new Map<string, NodeJS.Timeout>();
	private projectTimers = new Map<string, NodeJS.Timeout>();
	private unsubscribeHandlers: (() => void)[] = [];

	constructor(
		private readonly eventBus: EventBus,
		private readonly storage: ChatStorageService,
		private readonly conversationService: ConversationService,
		private readonly projectService: ProjectService,
	) {
		this.setupListeners();
	}

	/**
	 * Setup event listeners
	 */
	private setupListeners(): void {
		const unsubscribe1 = this.eventBus.on(ViewEventType.MESSAGE_SENT, (event: MessageSentEvent) => {
			console.debug('[ContextUpdateService] Message sent event received:', event);
			this.handleMessageSent(event);
		});
		this.unsubscribeHandlers.push(unsubscribe1);
	}

	/**
	 * Handle message sent event
	 */
	private async handleMessageSent(event: MessageSentEvent): Promise<void> {
		const { conversationId, projectId } = event;

		// Debounce: if timer exists, cancel it and set a new one
		// This ensures we only update after messages stop coming for SUMMARY_UPDATE_DEBOUNCE_MS
		const existingTimer = this.conversationTimers.get(conversationId);
		if (!existingTimer) {
			console.debug('[ContextUpdateService] Setting debounce timer for conversation:', conversationId);
			// Set debounce timer - will check message count difference when timer fires
			const timer = setTimeout(async () => {
				console.debug('[ContextUpdateService] Timer triggered for conversation:', conversationId);
				// Timer triggers: count messages and compare with last update from DB
				const [currentMessageCount, conversationMeta] = await Promise.all([
					this.storage.countMessages(conversationId),
					this.storage.readConversationMeta(conversationId),
				]);
				const lastUpdateMessageIndex = conversationMeta?.contextLastMessageIndex || 0;
				const messageCountDiff = currentMessageCount - lastUpdateMessageIndex;

				// Only update if message count difference is greater than threshold
				if (messageCountDiff >= CONVERSATION_SUMMARY_UPDATE_THRESHOLD) {
					console.debug('[ContextUpdateService] Updating conversation summary:', conversationId, currentMessageCount, lastUpdateMessageIndex, messageCountDiff);
					await this.updateConversationSummary(conversationId, currentMessageCount);
				}

				// Timer completes and removes itself
				this.conversationTimers.delete(conversationId);
			}, SUMMARY_UPDATE_DEBOUNCE_MS);

			this.conversationTimers.set(conversationId, timer);
		}

		// Handle project update if projectId exists
		if (projectId) {
			const existingProjectTimer = this.projectTimers.get(projectId);
			if (!existingProjectTimer) {
				console.debug('[ContextUpdateService] Setting debounce timer for project:', projectId);
				// Simple debounce for project updates
				const timer = setTimeout(async () => {
					console.debug('[ContextUpdateService] Timer triggered for project:', projectId);
					await this.updateProjectSummary(projectId);
					this.projectTimers.delete(projectId);
				}, SUMMARY_UPDATE_DEBOUNCE_MS);
				this.projectTimers.set(projectId, timer);
			}
		}
	}

	/**
	 * Update conversation summary
	 */
	private async updateConversationSummary(conversationId: string, currentMessageCount: number): Promise<void> {
		try {
			// Load conversation with messages (needed for title generation)
			const conversation = await this.storage.readConversation(conversationId, true);
			if (!conversation) {
				return;
			}

			// Get project if exists
			const project = conversation.meta.projectId ? await this.getProjectForConversation(conversation.meta.projectId) : null;

			// Build context window which will generate summary
			const context = await this.conversationService.buildContextWindow(
				conversation.messages,
				project
			);
			console.debug('[ContextUpdateService] Built context window:', conversationId, context);

			// Update conversation context only (with optimistic locking)
			await this.conversationService.updateConversationContext({
				conversation,
				project,
				context,
				messageIndex: currentMessageCount,
			});

			// Update title if it hasn't been manually edited and hasn't been auto-updated before
			// Only update if context has meaningful summary (not default) and conversation has messages
			if (
				!conversation.meta.titleManuallyEdited &&
				!conversation.meta.titleAutoUpdated &&
				context.shortSummary &&
				context.shortSummary !== DEFAULT_SUMMARY &&
				context.shortSummary !== 'No summary available yet.' &&
				conversation.messages.length > 0
			) {
				await this.updateConversationTitleIfNeeded(conversation, context);
			}
		} catch (error) {
			console.warn('[SummaryUpdateService] Failed to update conversation summary:', error);
		}
	}

	/**
	 * Update conversation title if context has changed significantly.
	 * Only updates if the new title would be different from the current one.
	 */
	private async updateConversationTitleIfNeeded(
		conversation: ChatConversation,
		context: ChatContextWindow
	): Promise<void> {
		console.debug('[ContextUpdateService] Updating conversation title if needed:', conversation, context);
		try {
			// Only update title if we have at least MIN_MESSAGES_FOR_TITLE_GENERATION messages (user + assistant)
			// This ensures the conversation has meaningful content
			if (conversation.messages.length < MIN_MESSAGES_FOR_TITLE_GENERATION) {
				return;
			}

			// Generate new title based on messages
			const newTitle = await this.conversationService.generateConversationTitle(conversation.messages, context);

			if (!newTitle || newTitle.trim().length === 0) {
				// Title generation failed, skip update
				return;
			}

			// Normalize titles for comparison (trim and lowercase)
			const currentTitleNormalized = conversation.meta.title.trim().toLowerCase();
			const newTitleNormalized = newTitle.trim().toLowerCase();

			// Only update if title is significantly different
			// This avoids unnecessary updates when the title is similar
			if (currentTitleNormalized === newTitleNormalized) {
				return;
			}

			// Update title without marking as manually edited, but mark as auto-updated
			await this.conversationService.updateConversationTitle({
				conversationId: conversation.meta.id,
				title: newTitle.trim(),
				titleManuallyEdited: false, // Keep auto-update enabled
				titleAutoUpdated: true, // Mark as auto-updated
			});
		} catch (error) {
			console.warn('[ContextUpdateService] Failed to update conversation title:', error);
		}
	}

	/**
	 * Update project summary
	 */
	private async updateProjectSummary(projectId: string): Promise<void> {
		try {
			const projects = await this.storage.listProjects();
			const project = projects.find(p => p.meta.id === projectId);
			if (!project) {
				return;
			}

			// Generate summary
			const summary = await this.projectService.summarizeProject(project);

			// Update project context
			const updatedContext = {
				...project.context,
				summary,
				shortSummary: summary,
				lastUpdatedTimestamp: Date.now(),
			};

			// Save project with updated context
			await this.storage.saveProject(project.meta, updatedContext);
		} catch (error) {
			console.warn('[SummaryUpdateService] Failed to update project summary:', error);
		}
	}

	/**
	 * Get project for conversation
	 */
	private async getProjectForConversation(projectId: string): Promise<any> {
		const projects = await this.storage.listProjects();
		return projects.find(p => p.meta.id === projectId) || null;
	}


	/**
	 * Cleanup and unsubscribe
	 */
	cleanup(): void {
		// Clear all timers
		for (const timer of this.conversationTimers.values()) {
			clearTimeout(timer);
		}
		for (const timer of this.projectTimers.values()) {
			clearTimeout(timer);
		}
		this.conversationTimers.clear();
		this.projectTimers.clear();

		// Unsubscribe from events
		for (const unsubscribe of this.unsubscribeHandlers) {
			unsubscribe();
		}
		this.unsubscribeHandlers = [];
	}
}

