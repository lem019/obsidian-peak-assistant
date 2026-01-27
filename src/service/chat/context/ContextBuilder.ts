/**
 * ============================================================================
 * 文件说明: ContextBuilder.ts - 对话上下文构建器
 * ============================================================================
 * 
 * 【这个文件是干什么的】
 * 这个文件负责在用户发送消息前，为 AI 准备完整的"上下文信息"。
 * 它就像一个聪明的秘书，在你和 AI 对话前，会把相关的背景资料、历史对话、
 * 用户画像、项目信息等所有 AI 需要知道的内容打包好，一起发给 AI。
 * 
 * 【起了什么作用】
 * 1. 上下文组装：将分散的信息（系统提示词、用户画像、项目摘要、对话历史等）组装成完整的请求
 * 2. 智能裁剪：根据 Token 预算智能选择包含哪些信息（优先级：最新消息 > 摘要 > 旧消息）
 * 3. 附件处理：处理用户上传的图片、文件等附件，转换为 AI 可理解的格式
 * 4. 资源引用：整合对话中引用的笔记、网页、文件的摘要信息
 * 5. 流式反馈：在构建过程中实时反馈进度（加载提示词、收集消息、处理附件等）
 * 
 * 【举例介绍】
 * 场景：你在一个叫"React 学习项目"的聊天项目中问："useState 怎么用？"
 * 
 * ContextBuilder 的工作流程：
 * 
 * 第 1 步：加载系统提示词
 * ```
 * role: system
 * content: "你是一个专业的 AI 助手，擅长回答编程问题..."
 * ```
 * 
 * 第 2 步：加载用户画像（如果有）
 * ```
 * role: system
 * content: "用户信息：
 * - 职业：前端开发者
 * - 擅长：TypeScript, React
 * - 偏好：简洁的代码风格"
 * ```
 * 
 * 第 3 步：加载上下文记忆
 * ```
 * role: system
 * content: "项目摘要：这是一个 React 学习项目，主要学习 Hooks 的使用...
 * 对话摘要：之前讨论了 useEffect 和 useContext 的用法..."
 * ```
 * 
 * 第 4 步：加载最近的消息历史（默认最近 10 条）
 * ```
 * [
 *   { role: 'user', content: '什么是 React Hooks?' },
 *   { role: 'assistant', content: 'Hooks 是 React 16.8 引入的特性...' },
 *   { role: 'user', content: 'useEffect 怎么用？' },
 *   { role: 'assistant', content: 'useEffect 用于处理副作用...' },
 *   ...
 * ]
 * ```
 * 
 * 第 5 步：处理当前消息中的附件和引用
 * - 如果你上传了图片：转为 Base64 编码
 * - 如果你引用了笔记：加载笔记的摘要
 * - 如果你提到了网页：包含网页内容的摘要
 * 
 * 第 6 步：组装最终请求
 * ```
 * [
 *   系统提示词,
 *   用户画像,
 *   上下文记忆,
 *   历史消息 1,
 *   历史消息 2,
 *   ...
 *   当前消息（包含附件和引用）
 * ]
 * ```
 * 
 * 【智能裁剪策略】
 * 问题：如果历史对话太长，超过了 AI 的 Token 限制怎么办？
 * 
 * 解决方案（分级裁剪）：
 * 1. 第一优先级：系统提示词（必须保留）
 * 2. 第二优先级：用户画像（如果启用了记忆功能）
 * 3. 第三优先级：上下文记忆（项目摘要、对话摘要）
 * 4. 第四优先级：最近的 N 条消息（默认 10 条）
 * 5. 第五优先级：更旧的消息会被自动裁剪掉
 * 
 * 【附件处理模式】
 * 1. direct 模式（直接模式）：
 *    - 如果模型支持多模态（如 GPT-4V），直接发送图片的 Base64 编码
 *    - 适合：OpenAI GPT-4V、Claude 3、Gemini Pro Vision
 * 
 * 2. degrade_to_text 模式（降级为文本）：
 *    - 如果模型不支持图片，先用视觉模型生成图片描述，再发送文字
 *    - 适合：纯文本模型（如 GPT-3.5）
 * 
 * 【技术实现】
 * - 使用 AsyncGenerator 实现流式进度反馈
 * - Handlebars 模板渲染上下文信息
 * - 支持多模态消息（文本、图片、文件）
 * - 自动管理 Token 预算
 * ============================================================================
 */

import { ToolEvent, type LLMRequestMessage, type LLMStreamEvent, type MessagePart } from '@/core/providers/types';
import type { ChatConversation, ChatProject, ChatMessage, ChatResourceRef } from '../types';
import type { ResourceSummaryService } from './ResourceSummaryService';
import type { PromptService } from '@/service/prompt/PromptService';
import { PromptId } from '@/service/prompt/PromptId';
import type { UserProfileService } from '@/service/chat/context/UserProfileService';
import type { ModelCapabilities } from '@/core/providers/types';
import type { App } from 'obsidian';
import { getImageMimeType, getFileMimeType } from '@/core/document/helper/FileTypeUtils';
import { readFileAsBase64 } from '@/core/utils/obsidian-utils';
import Handlebars from 'handlebars';
import * as contextMemoryTemplate from '@/service/prompt/templates/context-memory';
import * as userProfileTemplate from '@/service/prompt/templates/user-profile-context';
import * as messageResourcesTemplate from '@/service/prompt/templates/message-resources';

/**
 * Context building options
 * 上下文构建选项
 */
export interface ContextBuilderOptions {
	/**
	 * Maximum number of recent messages to include
	 * 最多包含多少条最近的消息（默认 10 条）
	 */
	maxRecentMessages?: number;
	/**
	 * Whether to include user profile prompt
	 * 是否包含用户画像提示词
	 */
	includeUserProfile?: boolean;
	/**
	 * Token budget for context (approximate, used for summary selection)
	 * Token 预算（用于决定裁剪策略，默认 16000）
	 */
	tokenBudget?: number;
}

const DEFAULT_MAX_RECENT_MESSAGES = 10;
const DEFAULT_TOKEN_BUDGET = 16000;

/**
 * Builds the final messages array to send to LLM, including context memory.
 * Combines system prompts, project/conv summaries, recent messages, and resource summaries.
 * 
 * 上下文构建器类
 * 负责构建发送给 AI 的完整消息数组，包括上下文记忆。
 * 整合系统提示词、项目/对话摘要、最近消息和资源摘要。
 */
export class ContextBuilder {
	private readonly contextMemoryTemplate: HandlebarsTemplateDelegate;
	private readonly userProfileTemplate: HandlebarsTemplateDelegate;
	private readonly messageResourcesTemplate: HandlebarsTemplateDelegate;

	constructor(
		private readonly promptService: PromptService,
		private readonly resourceSummaryService: ResourceSummaryService,
		private readonly userProfileService?: UserProfileService,
	) {
		// Pre-compile templates during initialization
		this.contextMemoryTemplate = Handlebars.compile(contextMemoryTemplate.template);
		this.userProfileTemplate = Handlebars.compile(userProfileTemplate.template);
		this.messageResourcesTemplate = Handlebars.compile(messageResourcesTemplate.template);

		// Register custom helpers
		Handlebars.registerHelper('join', (array: any[], separator: string) => array.join(separator));
	}

	/**
	 * Build LLM request messages with full context
	 */
	async *buildContextMessages(params: {
		conversation: ChatConversation;
		project?: ChatProject | null;
		messages: ChatMessage[];
		options?: ContextBuilderOptions;
		modelCapabilities?: ModelCapabilities;
		attachmentHandlingMode?: 'direct' | 'degrade_to_text';
		app?: App;
	}): AsyncGenerator<LLMStreamEvent, LLMRequestMessage[], void> {
		const startTime = Date.now();
		yield { type: 'tool-call', toolName: ToolEvent.BUILD_CONTEXT_MESSAGES, input: { startTimestamp: startTime } };
		const options = {
			maxRecentMessages: DEFAULT_MAX_RECENT_MESSAGES,
			includeUserProfile: true, // Default to true if memory/profile services are available
			tokenBudget: DEFAULT_TOKEN_BUDGET,
			...params.options,
		};

		const result: LLMRequestMessage[] = [];

		// 1. System prompt (ConversationSystem)
		yield { type: 'tool-call', toolName: ToolEvent.LOAD_SYSTEM_PROMPT, input: { promptId: PromptId.ConversationSystem } };
		const systemPrompt = await this.promptService.render(PromptId.ConversationSystem, {});
		if (systemPrompt) {
			result.push({
				role: 'system',
				content: [{ type: 'text', text: systemPrompt }],
			});
		}
		yield { type: 'tool-result', toolName: ToolEvent.LOAD_SYSTEM_PROMPT, input: { promptId: PromptId.ConversationSystem }, output: systemPrompt };

		// 2. User profile and memories (if enabled)
		if (options.includeUserProfile && this.userProfileService) {
			yield { type: 'tool-call', toolName: ToolEvent.LOAD_USER_PROFILE };
			const userProfileMessage = await this.buildUserProfileMessage();
			if (userProfileMessage) {
				result.push(userProfileMessage);
			}
			yield { type: 'tool-result', toolName: ToolEvent.LOAD_USER_PROFILE, output: userProfileMessage };
		}

		// 3. Context Memory system message
		yield { type: 'tool-call', toolName: ToolEvent.BUILD_CONTEXT_MEMORY };
		const contextMemory = await this.buildContextMemoryMessage(params, options);
		if (contextMemory) {
			result.push(contextMemory);
		}
		yield { type: 'tool-result', toolName: ToolEvent.BUILD_CONTEXT_MEMORY, output: contextMemory };

		// 4. Recent raw messages (last N messages) (include the latest user message)
		yield { type: 'tool-call', toolName: ToolEvent.COLLECT_RECENT_MESSAGES, input: { maxRecentMessages: options.maxRecentMessages! } };
		const recentMessagesCollected: LLMRequestMessage[] = [];
		const recentMessages = params.messages.slice(-options.maxRecentMessages!);
		for (let i = 0; i < recentMessages.length; i++) {
			const message = recentMessages[i];
			const messageContent = await this.buildMessageContent(message, i, recentMessages.length, params);
			if (messageContent) {
				recentMessagesCollected.push(messageContent);
			}
		}
		result.push(...recentMessagesCollected);
		yield { type: 'tool-result', toolName: ToolEvent.COLLECT_RECENT_MESSAGES, input: { maxRecentMessages: options.maxRecentMessages! }, output: recentMessagesCollected };

		yield {
			type: 'tool-result', toolName: ToolEvent.BUILD_CONTEXT_MESSAGES,
			input: { startTimestamp: startTime },
			output: { messageCount: result.length, durationMs: Date.now() - startTime }
		};

		return result;
	}

	/**
	 * Build context memory system message
	 */
	private async buildContextMemoryMessage(
		params: {
			conversation: ChatConversation;
			project?: ChatProject | null;
		},
		options: Required<ContextBuilderOptions>
	): Promise<LLMRequestMessage | null> {
		// Prepare template variables
		const projectSummary = params.project?.context?.fullSummary || params.project?.context?.shortSummary;
		const convSummary = params.conversation.context?.fullSummary || params.conversation.context?.shortSummary;

		const templateVars = {
			hasProject: !!params.project && !!projectSummary,
			projectName: params.project?.meta.name || '',
			projectSummary: projectSummary || '',
			projectResources: (params.project?.context?.resourceIndex || []).map(resource => ({
				displayName: resource.title || resource.id,
				displaySummary: resource.shortSummary || resource.source,
			})),
			hasConversation: !!convSummary,
			conversationSummary: convSummary || '',
			conversationTopics: params.conversation.context?.topics || [],
			conversationResources: (params.conversation.context?.resourceIndex || []).map(resource => ({
				displayName: resource.title || resource.id,
				displaySummary: resource.shortSummary || resource.source,
			})),
		};

		// Render using pre-compiled template
		const contextText = this.contextMemoryTemplate(templateVars).trim();

		if (!contextText) {
			return null;
		}

		return {
			role: 'system',
			content: [{ type: 'text', text: contextText }],
		};
	}

	/**
	 * Build user profile system message
	 */
	private async buildUserProfileMessage(): Promise<LLMRequestMessage | null> {
		// Load unified context
		const contextMap = await this.userProfileService!.loadContext();
		if (contextMap.size === 0) {
			return null;
		}

		const templateVars = {
			contextEntries: Array.from(contextMap.entries()).map(([category, texts]) => ({
				category,
				texts: texts.join(', '),
			})),
		};

		// Render using pre-compiled template
		const contextText = this.userProfileTemplate(templateVars).trim();

		return {
			role: 'user',
			content: [{ type: 'text', text: contextText }],
		};
	}


	/**
	 * Build message content for a single message
	 */
	private async buildMessageContent(
		message: ChatMessage,
		messageIndex: number,
		totalMessages: number,
		params: {
			attachmentHandlingMode?: 'direct' | 'degrade_to_text';
			modelCapabilities?: ModelCapabilities;
			app?: App;
		}
	): Promise<LLMRequestMessage | null> {
		// Build message content
		const contentParts: MessagePart[] = [];

		// Add text content
		if (message.content) {
			contentParts.push({ type: 'text', text: message.content });
		}

		// we need to let the model know if there are any file attached to the message.
		if (message.resources) {
			// for not the latest message, we send the summary of the resource.
			const isLatestMessage = messageIndex === totalMessages - 1;
			if (isLatestMessage && params.attachmentHandlingMode === 'direct') {
				for (const resource of message.resources) {
					const contentPart = await this.buildDirectResourceContent(resource, params.modelCapabilities, params.app!);
					if (contentPart) {
						contentParts.push(contentPart);
					}
				}
			} else {
				// Use pre-compiled template for message resources
				const attachmentText = this.messageResourcesTemplate({
					resources: message.resources.map(resource => ({ id: resource.id }))
				});
				contentParts.push({
					type: 'text',
					text: attachmentText
				});
			}
		}

		if (contentParts.length === 0) {
			return null;
		}

		return {
			role: message.role,
			content: contentParts,
		};
	}

	/**
	 * Build direct resource content for message parts
	 */
	private async buildDirectResourceContent(
		resource: ChatResourceRef,
		modelCapabilities?: ModelCapabilities,
		app?: App
	): Promise<MessagePart | null> {
		if (modelCapabilities?.vision && resource.kind === 'image') {
			// Vision model + direct mode: convert image to data URL and add to message content
			try {
				const ext = resource.source.split('.').pop()?.toLowerCase() || '';
				const base64 = await readFileAsBase64(app!, resource.source);
				if (base64) {
					const mimeType = getImageMimeType(ext);
					const dataUrl = `data:${mimeType};base64,${base64}`;
					return { type: 'image', data: dataUrl, mediaType: mimeType };
				}
			} catch (error) {
				console.warn(`[ChatService] Failed to convert image ${resource.source} to data URL:`, error);
				// Fallback: will use summary from context memory
				// todo yield error event.
			}
		} else if (modelCapabilities?.pdfInput && resource.kind === 'pdf') {
			try {
				const base64 = await readFileAsBase64(app!, resource.source);
				if (base64) {
					return { type: 'file', data: base64, mediaType: 'application/pdf' };
				}
			} catch (error) {
			}
		} else {
			const base64 = await readFileAsBase64(app!, resource.source);
			if (base64) {
				const ext = resource.source.split('.').pop()?.toLowerCase() || '';
				const mediaType = getFileMimeType(ext);
				return { type: 'file', data: base64, mediaType };
			}
		}
		return null;
	}
}

