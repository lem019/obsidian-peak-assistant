/**
 * ============================================================================
 * 文件说明: PromptId.ts - 提示词标识符与注册表
 * ============================================================================
 * 
 * 【这个文件是干什么的】
 * 这个文件是整个提示词系统的"目录"和"索引"，集中管理所有提示词的 ID、模板内容和类型定义。
 * 就像一本"剧本目录"，列出了所有可用的剧本（提示词模板）及其用途。
 * 
 * 【起了什么作用】
 * 1. **提示词枚举**：定义所有提示词的唯一标识符（PromptId 枚举）
 * 2. **模板注册**：将模板文件导入并注册到全局注册表（PROMPT_REGISTRY）
 * 3. **类型安全**：为每个提示词定义变量类型（PromptVariables），确保调用时参数正确
 * 4. **配置管理**：定义哪些提示词允许在设置界面配置模型
 * 5. **中心化管理**：所有提示词相关的定义都在这一个文件中，便于维护
 * 
 * 【举例介绍】
 * 场景 1：添加新提示词
 * ```typescript
 * // 第 1 步：创建模板文件 templates/my-new-prompt.ts
 * export const template = `你的提示词模板 {{variable}}`;
 * 
 * // 第 2 步：在 PromptId 枚举中添加
 * export enum PromptId {
 *   MyNewPrompt = 'my-new-prompt',  // 添加这一行
 * }
 * 
 * // 第 3 步：在 PromptVariables 中定义变量类型
 * export interface PromptVariables {
 *   'my-new-prompt': { variable: string };  // 添加这一行
 * }
 * 
 * // 第 4 步：在 PROMPT_REGISTRY 中注册
 * export const PROMPT_REGISTRY: Record<PromptId, PromptTemplate> = {
 *   [PromptId.MyNewPrompt]: createTemplate(myNewPrompt),  // 添加这一行
 * };
 * 
 * // 完成！现在可以使用了
 * await promptService.chatWithPrompt(PromptId.MyNewPrompt, { variable: '测试' });
 * ```
 * 
 * 场景 2：查看所有提示词用途
 * ```typescript
 * // 对话相关
 * PromptId.ConversationSystem          // 对话系统提示词（定义 AI 的角色）
 * PromptId.ConversationSummaryShort    // 生成对话的短摘要
 * PromptId.ConversationSummaryFull     // 生成对话的完整摘要
 * 
 * // 搜索相关
 * PromptId.SearchAiSummary             // 为搜索结果生成 AI 摘要
 * PromptId.SearchTopicExtractJson      // 从搜索结果提取主题（JSON 格式）
 * PromptId.SearchRerankRankGpt         // 使用 GPT 对搜索结果重排序
 * 
 * // 用户画像相关
 * PromptId.MemoryExtractCandidatesJson // 从对话中提取记忆候选项
 * PromptId.UserProfileUpdateJson       // 更新用户画像
 * 
 * // 文档分析相关
 * PromptId.DocSummary                  // 生成文档摘要
 * PromptId.DocTypeClassifyJson         // 分类文档类型
 * PromptId.DocTagGenerateJson          // 为文档生成标签
 * ```
 * 
 * 场景 3：类型安全的变量传递
 * ```typescript
 * // ✅ 正确：类型系统会检查变量
 * await promptService.chatWithPrompt(
 *   PromptId.ConversationSummaryShort,
 *   { messages: [...] }  // TypeScript 知道需要 messages 参数
 * );
 * 
 * // ❌ 错误：类型系统会报错
 * await promptService.chatWithPrompt(
 *   PromptId.ConversationSummaryShort,
 *   { wrongParam: '...' }  // TypeScript 报错：缺少 messages 参数
 * );
 * ```
 * 
 * 【核心数据结构】
 * 1. **PromptId**：枚举类型，定义所有提示词的唯一标识
 * 2. **PromptTemplate**：接口，定义模板的结构（template 文本、是否期望 JSON 输出等）
 * 3. **PromptVariables**：接口，定义每个提示词需要的变量类型
 * 4. **PROMPT_REGISTRY**：注册表，映射 PromptId 到具体的模板内容
 * 5. **CONFIGURABLE_PROMPTS**：数组，列出哪些提示词允许在设置中配置模型
 * 
 * 【模板分类】
 * - **Chat**：对话系统相关（system prompt、摘要生成等）
 * - **Search**：搜索功能相关（AI 摘要、主题提取、重排序）
 * - **Memory/Profile**：用户画像和记忆管理
 * - **Document**：文档分析（摘要、分类、标签生成）
 * - **Application**：应用功能（标题生成、提示词优化）
 * - **Context**：上下文构建（内部使用的模板）
 * ============================================================================
 */

// Import all prompt templates
// 导入所有提示词模板
import * as conversationSystem from './templates/conversation-system';
import * as conversationSummaryShort from './templates/conversation-summary-short';
import * as conversationSummaryFull from './templates/conversation-summary-full';
import * as projectSummaryShort from './templates/project-summary-short';
import * as projectSummaryFull from './templates/project-summary-full';
import * as searchAiSummary from './templates/search-ai-summary';
import * as searchTopicExtractJson from './templates/search-topic-extract-json';
import * as searchRerankRankGpt from './templates/search-rerank-rank-gpt';
import * as aiSearchSystem from './templates/ai-search-system';
import * as applicationGenerateTitle from './templates/application-generate-title';
import * as memoryExtractCandidatesJson from './templates/memory-extract-candidates-json';
import * as memoryUpdateBulletList from './templates/memory-update-bullet-list';
import * as userProfileUpdateJson from './templates/user-profile-update-json';
import * as instructionUpdate from './templates/instruction-update';
import * as promptQualityEvalJson from './templates/prompt-quality-eval-json';
import * as promptRewriteWithLibrary from './templates/prompt-rewrite-with-library';
import * as docSummary from './templates/doc-summary';
import * as imageSummary from './templates/image-summary';
import * as imageDescription from './templates/image-description';
import * as folderProjectSummary from './templates/folder-project-summary';
import * as docTypeClassifyJson from './templates/doc-type-classify-json';
import * as docTagGenerateJson from './templates/doc-tag-generate-json';
import * as contextMemory from './templates/context-memory';
import * as userProfileContext from './templates/user-profile-context';
import * as messageResources from './templates/message-resources';

/**
 * Prompt template definition.
 */
export interface PromptTemplate {
	/** Template text with {{variable}} placeholders */
	template: string;
	/** Whether this prompt expects JSON output */
	expectsJson?: boolean;
	/** Additional instructions for JSON output (e.g., "Return only JSON array") */
	jsonConstraint?: string;
}

/**
 * Helper to create PromptTemplate from module exports.
 */
function createTemplate(module: { template: string; expectsJson?: boolean; jsonConstraint?: string }): PromptTemplate {
	return {
		template: module.template,
		expectsJson: module.expectsJson,
		jsonConstraint: module.jsonConstraint,
	};
}

/**
 * Centralized prompt identifier enum.
 * All prompts used across the application should be registered here.
 */
export enum PromptId {
	// Chat prompts
	ConversationSystem = 'conversation-system', // todo we need to tell the model. that we have [[xxx]] @xxx@ /xxx/ tags syntax. to let it know he can read these things.
	ConversationSummaryShort = 'conversation-summary-short',
	ConversationSummaryFull = 'conversation-summary-full',
	ProjectSummaryShort = 'project-summary-short',
	ProjectSummaryFull = 'project-summary-full',

	// Search prompts
	SearchAiSummary = 'search-ai-summary',
	SearchTopicExtractJson = 'search-topic-extract-json',
	SearchRerankRankGpt = 'search-rerank-rank-gpt',
	AiSearchSystem = 'ai-search-system',

	// Application prompts (title generation)
	ApplicationGenerateTitle = 'application-generate-title',

	// Memory/Profile prompts
	MemoryExtractCandidatesJson = 'memory-extract-candidates-json',
	MemoryUpdateBulletList = 'memory-update-bullet-list',
	UserProfileUpdateJson = 'user-profile-update-json',
	InstructionUpdate = 'instruction-update',

	// Prompt rewrite prompts
	PromptQualityEvalJson = 'prompt-quality-eval-json',
	PromptRewriteWithLibrary = 'prompt-rewrite-with-library',

	// Document analysis prompts (for future use)
	DocSummary = 'doc-summary',
	ImageDescription = 'image-description',
	ImageSummary = 'image-summary',
	FolderProjectSummary = 'folder-project-summary',
	// Classify document type: principle, profile, index, daily, project, note, or other
	DocTypeClassifyJson = 'doc-type-classify-json',
	DocTagGenerateJson = 'doc-tag-generate-json',

	// Context building templates (internal use)
	ContextMemory = 'context-memory',
	UserProfileContext = 'user-profile-context',
	MessageResources = 'message-resources',
}

/**
 * Prompt IDs that allow model configuration in settings.
 * Only prompts listed here will appear in the Model Configuration UI.
 * 
 * Prompts not listed here (e.g., internal/system prompts) will always use the default model.
 */
export const CONFIGURABLE_PROMPT_IDS: readonly PromptId[] = [
	// Chat summary prompts - users may want different models for summaries
	PromptId.ConversationSummaryShort,
	PromptId.ConversationSummaryFull,
	PromptId.ProjectSummaryShort,
	PromptId.ProjectSummaryFull,

	// Search prompts - users may want specialized models for search
	PromptId.SearchAiSummary,
	PromptId.SearchTopicExtractJson,
	PromptId.SearchRerankRankGpt,

	// Application prompts - title generation may benefit from different models
	PromptId.ApplicationGenerateTitle,

	// Memory/Profile prompts
	PromptId.MemoryExtractCandidatesJson,
	PromptId.MemoryUpdateBulletList,
	PromptId.UserProfileUpdateJson,
	PromptId.InstructionUpdate,

	// Prompt rewrite prompts
	PromptId.PromptQualityEvalJson,
	PromptId.PromptRewriteWithLibrary,

	// Document analysis prompts - users may want different models for different document types
	PromptId.DocSummary,
	PromptId.ImageDescription,
	PromptId.ImageSummary,
	PromptId.FolderProjectSummary,
	// Classify document type: principle, profile, index, daily, project, note, or other
	PromptId.DocTypeClassifyJson,
	PromptId.DocTagGenerateJson,
] as const;

/**
 * Check if a prompt ID allows model configuration.
 */
export function isPromptModelConfigurable(promptId: PromptId): boolean {
	return CONFIGURABLE_PROMPT_IDS.includes(promptId);
}

/**
 * Variable schemas for each prompt type.
 * Used for type-safe rendering.
 * // todo some prompts may have expected output format, we should add it to the interface. maybe turn into an agent
 */
export interface PromptVariables {
	[PromptId.ConversationSystem]: Record<string, never>;
	[PromptId.ConversationSummaryShort]: {
		messages: Array<{ role: string; content: string }>;
		projectContext?: string;
	};
	[PromptId.ConversationSummaryFull]: {
		messages: Array<{ role: string; content: string }>;
		projectContext?: string;
		shortSummary?: string;
	};
	[PromptId.ProjectSummaryShort]: {
		conversations: Array<{ title: string; shortSummary?: string }>;
		resources?: Array<{ title: string; source: string }>;
	};
	[PromptId.ProjectSummaryFull]: {
		conversations: Array<{ title: string; shortSummary?: string; fullSummary?: string }>;
		resources?: Array<{ title: string; source: string; shortSummary?: string }>;
		shortSummary?: string;
	};
	[PromptId.SearchAiSummary]: {
		query: string;
		sources: Array<{ title: string; path: string; snippet?: string }>;
		graphContext?: string;
		webEnabled?: boolean;
		userPreferences?: string;
	};
	[PromptId.SearchTopicExtractJson]: {
		query: string;
		summary: string;
		sources: Array<{ title: string; path: string }>;
		graphContext?: string;
	};
	[PromptId.SearchRerankRankGpt]: {
		query: string;
		documents: Array<{ index: number; text: string; boostInfo?: string }>;
	};
	[PromptId.ApplicationGenerateTitle]: {
		messages: Array<{ role: string; content: string }>;
		contextInfo?: string;
	};
	[PromptId.MemoryExtractCandidatesJson]: {
		userMessage: string;
		assistantReply: string;
		context?: Record<string, string>;
	};
	[PromptId.MemoryUpdateBulletList]: {
		newStatement: string;
		existingMemories: string[];
	};
	[PromptId.UserProfileUpdateJson]: {
		recentConversations: Array<{ summary: string; topics?: string[] }>;
		existingProfile?: string;
	};
	[PromptId.InstructionUpdate]: {
		profile: string;
		recentSummary: string;
		existingInstructions?: string;
	};
	[PromptId.PromptQualityEvalJson]: {
		prompt: string;
		taskHint?: string;
	};
	[PromptId.PromptRewriteWithLibrary]: {
		originalPrompt: string;
		qualityIssues: string[];
	};
	[PromptId.DocSummary]: {
		content: string;
		title?: string;
		path?: string;
		wordCount?: string;
	};
	[PromptId.ImageDescription]: Record<string, never>;
	[PromptId.ImageSummary]: {
		content: string;
		title?: string;
		path?: string;
	};
	[PromptId.FolderProjectSummary]: {
		documents: Array<{ title: string; summary?: string; path: string }>;
	};
	[PromptId.DocTypeClassifyJson]: {
		content: string;
		title?: string;
		path?: string;
	};
	[PromptId.DocTagGenerateJson]: {
		content: string;
		title?: string;
		existingTags?: string[];
	};
	[PromptId.ContextMemory]: {
		hasProject: boolean;
		projectName: string;
		projectSummary: string;
		projectResources: Array<{
			displayName: string;
			displaySummary: string;
		}>;
		hasConversation: boolean;
		conversationSummary: string;
		conversationTopics: string[];
		conversationResources: Array<{
			displayName: string;
			displaySummary: string;
		}>;
	};
	[PromptId.UserProfileContext]: {
		contextEntries: Array<{
			category: string;
			texts: string;
		}>;
	};
	[PromptId.MessageResources]: {
		resources: Array<{
			id: string;
		}>;
	};
}

/**
 * Central prompt registry.
 * All prompts are loaded from individual template files in the templates/ directory.
 */
export const PROMPT_REGISTRY: Record<PromptId, PromptTemplate> = {
	[PromptId.ConversationSystem]: createTemplate(conversationSystem),
	[PromptId.ConversationSummaryShort]: createTemplate(conversationSummaryShort),
	[PromptId.ConversationSummaryFull]: createTemplate(conversationSummaryFull),
	[PromptId.ProjectSummaryShort]: createTemplate(projectSummaryShort),
	[PromptId.ProjectSummaryFull]: createTemplate(projectSummaryFull),
	[PromptId.SearchAiSummary]: createTemplate(searchAiSummary),
	[PromptId.SearchTopicExtractJson]: createTemplate(searchTopicExtractJson),
	[PromptId.SearchRerankRankGpt]: createTemplate(searchRerankRankGpt),
	[PromptId.ApplicationGenerateTitle]: createTemplate(applicationGenerateTitle),
	[PromptId.MemoryExtractCandidatesJson]: createTemplate(memoryExtractCandidatesJson),
	[PromptId.MemoryUpdateBulletList]: createTemplate(memoryUpdateBulletList),
	[PromptId.UserProfileUpdateJson]: createTemplate(userProfileUpdateJson),
	[PromptId.InstructionUpdate]: createTemplate(instructionUpdate),
	[PromptId.PromptQualityEvalJson]: createTemplate(promptQualityEvalJson),
	[PromptId.PromptRewriteWithLibrary]: createTemplate(promptRewriteWithLibrary),
	[PromptId.DocSummary]: createTemplate(docSummary),
	[PromptId.ImageDescription]: createTemplate(imageDescription),
	[PromptId.ImageSummary]: createTemplate(imageSummary),
	[PromptId.FolderProjectSummary]: createTemplate(folderProjectSummary),
	[PromptId.DocTypeClassifyJson]: createTemplate(docTypeClassifyJson),
	[PromptId.DocTagGenerateJson]: createTemplate(docTagGenerateJson),
	[PromptId.ContextMemory]: createTemplate(contextMemory),
	[PromptId.UserProfileContext]: createTemplate(userProfileContext),
	[PromptId.MessageResources]: createTemplate(messageResources),
};
