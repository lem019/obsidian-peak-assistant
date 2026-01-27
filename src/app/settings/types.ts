/**
 * @file types.ts (Settings)
 * @description 插件设置的类型定义。
 * 包含了 AI 服务配置、搜索配置、分块算法配置等所有持久化数据的接口。
 */

import { ProviderConfig, LLMOutputControlSettings } from '@/core/providers/types';
import { CommandHiddenSettings, DEFAULT_COMMAND_HIDDEN_SETTINGS } from '@/service/CommandHiddenControlService';
import type { DocumentType } from '@/core/document/types';
import { PromptId, CONFIGURABLE_PROMPT_IDS } from '@/service/prompt/PromptId';

/**
 * 文档分块（Chunking）配置接口。
 * 决定了长文档如何被分割成小块以适配嵌入模型（Embedding）。
 */
export interface ChunkingSettings {
	/**
	 * 每个分块的最大字符数。
	 * 默认：1000
	 */
	maxChunkSize: number;
	/**
	 * 相邻分块之间的重叠字符数。
	 * 默认：200
	 */
	chunkOverlap: number;
	/**
	 * 触发分块的最小文档大小。
	 * 默认：1500
	 */
	minDocumentSizeForChunking: number;
	/**
	 * 嵌入模型配置。用于将文本块转换为数值向量。
	 */
	embeddingModel?: {
		provider: string;
		modelId: string;
	};
	/**
	 * 重排序模型配置。用于提高搜索结果的相关性。
	 */
	rerankModel?: {
		provider: string;
		modelId: string;
	};
}

/**
 * 默认分块设置。
 */
export const DEFAULT_CHUNKING_SETTINGS: ChunkingSettings = {
	maxChunkSize: 1000,
	chunkOverlap: 200,
	minDocumentSizeForChunking: 1500,
};

/**
 * 本地搜索与索引相关配置。
 */
export interface SearchSettings {
	/**
	 * 是否在启动时自动扫描库中变更的文件并更新索引。
	 */
	autoIndex: boolean;
	/**
	 * 参与索引的文档类型。
	 */
	includeDocumentTypes: Record<DocumentType, boolean>;
	/**
	 * 分块配置。
	 */
	chunking: ChunkingSettings;
	/**
	 * 忽略的文件/目录匹配模式。
	 */
	ignorePatterns: string[];
	/**
	 * 用于生成搜索结果摘要或 AI 分析的模型。
	 */
	searchSummaryModel?: {
		provider: string;
		modelId: string;
	};
	/**
	 * 索引刷新的节流间隔（毫秒）。
	 */
	indexRefreshInterval: number;

	/**
	 * 联网搜索实现：'perplexity' (API) 或 'local_chromium' (本地浏览器自动化)。
	 */
	aiAnalysisWebSearchImplement?: 'perplexity' | 'local_chromium';
	/**
	 * Perplexity 的模型 ID。
	 */
	perplexitySearchModel?: string;

	shortSummaryLength: number;
	fullSummaryLength: number;
}

/**
 * 默认搜索设置。
 */
export const DEFAULT_SEARCH_SETTINGS: SearchSettings = {
	autoIndex: false,
	includeDocumentTypes: {
		markdown: true,
		pdf: true,
		image: true,
		csv: false,
		json: false,
		html: false,
		xml: false,
		txt: false,
		docx: false,
		xlsx: false,
		pptx: false,
		conv: false,
		project: false,
		prompt: false,
		excalidraw: true,
		canvas: false,
		dataloom: false,
		folder: false,
		url: false,
		unknown: false,
	} as Record<DocumentType, boolean>,
	chunking: DEFAULT_CHUNKING_SETTINGS,
	ignorePatterns: [
		'.git/',
		'node_modules/',
		'.obsidian/',
		'A-control/',
		'*.tmp',
		'*.temp',
		'*.log',
		'.DS_Store',
		'Thumbs.db',
	],
	searchSummaryModel: {
		provider: 'openai',
		modelId: 'gpt-4o-mini',
	},
	indexRefreshInterval: 5000,

	aiAnalysisWebSearchImplement: 'local_chromium',

	shortSummaryLength: 150,
	fullSummaryLength: 2000,
};

/**
 * AI 服务核心配置接口。
 */
export interface AIServiceSettings {
	// 存储聊天数据的根文件夹
	rootFolder: string;
	// 存储 Prompt 模板的文件夹
	promptFolder: string;
	// 存储附件的文件夹
	uploadFolder: string;
	// 默认聊天模型
	defaultModel: {
		provider: string;
		modelId: string;
	};
	// 各个模型厂商的具体配置（API Key 等）
	llmProviderConfigs: Record<string, ProviderConfig>;
	/**
	 * 是否启用自动更新用户画像。
	 */
	profileEnabled?: boolean;
	/**
	 * 用户画像文件路径。
	 */
	profileFilePath?: string;
	/**
	 * 存储资源摘要的缓存文件夹。
	 */
	resourcesSummaryFolder: string;
	/**
	 * 是否启用 Prompt 自动改写（优化输入）。
	 */
	promptRewriteEnabled?: boolean;
	/**
	 * 默认输出控制（温度、最大 Token 等）。
	 */
	defaultOutputControl?: LLMOutputControlSettings;
	/**
	 * 模型路由映射：针对特定 Prompt ID 使用特定的模型。
	 */
	promptModelMap?: Partial<Record<PromptId, { provider: string; modelId: string }>>;
	/**
	 * 附件处理模式：'direct' (直接给模型) 或 'degrade_to_text' (先转成文字)。
	 */
	attachmentHandlingDefault?: 'direct' | 'degrade_to_text';
}

/**
 * 默认 AI 设置。
 */
export const DEFAULT_AI_SERVICE_SETTINGS: AIServiceSettings = {
	rootFolder: 'ChatFolder',
	promptFolder: 'ChatFolder/Prompts',
	uploadFolder: 'ChatFolder/Attachments',
	resourcesSummaryFolder: 'ChatFolder/resources-summary-cache',
	defaultModel: {
		provider: 'openai',
		modelId: 'gpt-4o-mini',
	},
	llmProviderConfigs: {},
	profileEnabled: true,
	profileFilePath: 'ChatFolder/system/User-Profile.md',
	promptRewriteEnabled: false,
	promptModelMap: (() => {
		const defaultModel = { provider: 'openai', modelId: 'gpt-4o-mini' };
		const map: Partial<Record<PromptId, { provider: string; modelId: string }>> = {};
		for (const promptId of CONFIGURABLE_PROMPT_IDS) {
			map[promptId] = { ...defaultModel };
		}
		return map;
	})(),
	attachmentHandlingDefault: 'direct',
	defaultOutputControl: {
		temperature: 1.0,
		topP: 0.9,
		topK: 50,
		presencePenalty: 0.0,
		frequencyPenalty: 0.0,
		maxOutputTokens: 4096,
		reasoningEffort: 'medium',
		textVerbosity: 'medium',
		timeoutTotalMs: 300000,
		timeoutStepMs: 30000,
	},
};

/**
 * 插件根配置接口。
 */
export interface MyPluginSettings {
	// 各类辅助文件夹设置
	scriptFolder: string;
	htmlViewConfigFile: string;
	statisticsDataStoreFolder: string;
	dataStorageFolder: string;

	// 核心业务设置块
	ai: AIServiceSettings;
	search: SearchSettings;

	// 操作拦截/隐藏设置
	commandHidden: CommandHiddenSettings;

	/**
	 * SQLite 数据库后端选择。
	 * - 'auto': 自动检测 Better-SQLite3 或 SQL.js。
	 * - 'better-sqlite3': 强行使用原生模块（更快，但需要特定环境）。
	 * - 'sql.js': 强行使用 WebAssembly 版（兼容性最佳）。
	 */
	sqliteBackend?: 'auto' | 'better-sqlite3' | 'sql.js';
}

/**
 * 初始兜底设置。
 */
export const DEFAULT_SETTINGS: MyPluginSettings = {
	scriptFolder: 'A-control/PeakAssistant/Scripts',
	htmlViewConfigFile: 'A-control/PeakAssistant/HtmlViewConfig.json',
	statisticsDataStoreFolder: 'A-control/PeakAssistant/Statistics',
	dataStorageFolder: 'A-control/PeakAssistant/DataStore',

	ai: DEFAULT_AI_SERVICE_SETTINGS,
	search: DEFAULT_SEARCH_SETTINGS,

	commandHidden: DEFAULT_COMMAND_HIDDEN_SETTINGS,

	sqliteBackend: 'auto',
};

