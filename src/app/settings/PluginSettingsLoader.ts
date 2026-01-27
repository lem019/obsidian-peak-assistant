/**
 * @file PluginSettingsLoader.ts
 * @description 设置加载与规格化工具。
 * 负责将 Obsidian `data.json` 中保存的原始数据转换为强类型的 `MyPluginSettings` 对象。
 * 它处理了版本兼容性、缺失字段补全以及非法值的修正。
 */

import { AIServiceSettings, DEFAULT_AI_SERVICE_SETTINGS, DEFAULT_SEARCH_SETTINGS, DEFAULT_SETTINGS, MyPluginSettings, SearchSettings } from '@/app/settings/types';
import { ProviderConfig, LLMOutputControlSettings } from '@/core/providers/types';
import { DEFAULT_COMMAND_HIDDEN_SETTINGS } from '@/service/CommandHiddenControlService';

/**
 * 辅助函数：安全获取字符串，否则返回默认值。
 */
function getString(source: unknown, defaultValue: string): string {
	return typeof source === 'string' ? source : defaultValue;
}

/**
 * 辅助函数：安全获取布尔值，否则返回默认值。
 */
function getBoolean(source: unknown, defaultValue: boolean): boolean {
	return typeof source === 'boolean' ? source : defaultValue;
}

/**
 * 规格化 AI 服务设置。
 * 处理 API 密钥、默认模型、各厂商（OpenAI, Anthropic 等）的具体配置。
 * 
 * 逻辑：
 * 1. 优先读取磁盘上的 raw 数据。
 * 2. 如果缺少某个分类（如 rootFolder），则回退到 `DEFAULT_AI_SERVICE_SETTINGS`。
 * 3. 确保嵌套对象（如 defaultModel）的结构完整性，防止运行时读取 provider 报错。
 */
function normalizeAIServiceSettings(raw: Record<string, unknown>): AIServiceSettings {
	const rawAI = raw?.ai as Partial<AIServiceSettings> | undefined;
	if (!rawAI || typeof rawAI !== 'object') {
		// 如果 raw 为空或格式非法，直接返回全套默认值
		return { ...DEFAULT_AI_SERVICE_SETTINGS };
	}

	const settings = { ...DEFAULT_AI_SERVICE_SETTINGS };

	// 1. 基础文件夹路径规格化
	// 确保所有路径都是字符串，避免 null 或 undefined 导致路径拼接失败
	settings.rootFolder = getString(rawAI.rootFolder, settings.rootFolder);
	settings.promptFolder = getString(rawAI.promptFolder, settings.promptFolder);
	settings.uploadFolder = getString(rawAI.uploadFolder, settings.uploadFolder);
	settings.resourcesSummaryFolder = getString(rawAI.resourcesSummaryFolder, settings.resourcesSummaryFolder);

	// 2. 默认聊天模型设置
	if (rawAI.defaultModel && typeof rawAI.defaultModel === 'object') {
		const model = rawAI.defaultModel as { provider?: unknown; modelId?: unknown };
		settings.defaultModel = {
			provider: getString(model.provider, settings.defaultModel.provider),
			modelId: getString(model.modelId, settings.defaultModel.modelId),
		};
	}

	// 3. 具体的 Provider 配置（包含 API Key, Base URL 等私密信息）
	// 注意：此处是 Record 结构，通常直接透传。如果后续需要加密，应在此处处理。
	if (rawAI.llmProviderConfigs && typeof rawAI.llmProviderConfigs === 'object') {
		settings.llmProviderConfigs = rawAI.llmProviderConfigs as Record<string, ProviderConfig>;
	}

	// 4. 用户画像与提示词增强设置
	// 默认启用用户画像（profileEnabled），以提供更好的 AI 个性化回复
	settings.profileEnabled = getBoolean(rawAI.profileEnabled, settings.profileEnabled ?? true);
	settings.profileFilePath = getString(rawAI.profileFilePath, settings.profileFilePath ?? '');
	settings.promptRewriteEnabled = getBoolean(rawAI.promptRewriteEnabled, settings.promptRewriteEnabled ?? false);

	// 5. 针对特定任务（如标题生成）的各种模型路由映射
	// 允许用户指定生成标题用轻量模型，日常对话用重量模型
	if (rawAI.promptModelMap && typeof rawAI.promptModelMap === 'object') {
		settings.promptModelMap = rawAI.promptModelMap as Partial<Record<string, { provider: string; modelId: string }>>;
	}

	// 6. 模型输出控制（Temperature, Max Tokens 等参数）
	if (rawAI.defaultOutputControl && typeof rawAI.defaultOutputControl === 'object') {
		settings.defaultOutputControl = rawAI.defaultOutputControl as LLMOutputControlSettings;
	}

	return settings;
}

/**
 * 规格化搜索（向量数据库）相关设置。
 * 涉及 RAG (检索增强生成) 的核心配置，包括 Embedding、分块策略等。
 */
function normalizeSearchSettings(raw: Record<string, unknown>): SearchSettings {
	const rawSearch = raw?.search as Partial<SearchSettings> | undefined;
	if (!rawSearch || typeof rawSearch !== 'object') {
		return { ...DEFAULT_SEARCH_SETTINGS };
	}

	const settings = { ...DEFAULT_SEARCH_SETTINGS };

	// 1. 自动索引开关：控制是否实时监听文件变化并更新向量库
	settings.autoIndex = getBoolean(rawSearch.autoIndex, settings.autoIndex);

	// 2. 扫描范围配置：确定哪些类型的文件会被索引到向量库
	if (rawSearch.includeDocumentTypes && typeof rawSearch.includeDocumentTypes === 'object') {
		settings.includeDocumentTypes = {
			...DEFAULT_SEARCH_SETTINGS.includeDocumentTypes,
			...(rawSearch.includeDocumentTypes as Record<string, boolean>),
		};
	}

	// 3. 排除路径：支持 Regexp 字符串形式导出，避免索引 node_modules 或日记文件夹
	if (Array.isArray(rawSearch.ignorePatterns)) {
		settings.ignorePatterns = rawSearch.ignorePatterns as string[];
	}

	// 4. 分块（Chunking）与嵌入模型配置
	// 这是 RAG 召回率的关键，较小的 Chunk 适合精准匹配，较大的适合语境理解
	if (rawSearch.chunking && typeof rawSearch.chunking === 'object') {
		const rawChunking = rawSearch.chunking as Partial<typeof DEFAULT_SEARCH_SETTINGS.chunking>;
		settings.chunking = {
			...DEFAULT_SEARCH_SETTINGS.chunking,
			maxChunkSize: typeof rawChunking.maxChunkSize === 'number' ? rawChunking.maxChunkSize : DEFAULT_SEARCH_SETTINGS.chunking.maxChunkSize,
			chunkOverlap: typeof rawChunking.chunkOverlap === 'number' ? rawChunking.chunkOverlap : DEFAULT_SEARCH_SETTINGS.chunking.chunkOverlap,
			minDocumentSizeForChunking: typeof rawChunking.minDocumentSizeForChunking === 'number' ? rawChunking.minDocumentSizeForChunking : DEFAULT_SEARCH_SETTINGS.chunking.minDocumentSizeForChunking,
		};

		// 嵌入向量模型：必须保证 ModelID 存在才能正常生成向量
		if (rawChunking.embeddingModel && typeof rawChunking.embeddingModel === 'object') {
			const model = rawChunking.embeddingModel as { provider?: unknown; modelId?: unknown };
			const provider = getString(model.provider, '');
			const modelId = getString(model.modelId, '');
			if (provider && modelId) {
				settings.chunking.embeddingModel = { provider, modelId };
			}
		}

		// 重排序（Rerank）模型配置
		if (rawChunking.rerankModel && typeof rawChunking.rerankModel === 'object') {
			const model = rawChunking.rerankModel as { provider?: unknown; modelId?: unknown };
			const provider = getString(model.provider, '');
			const modelId = getString(model.modelId, '');
			if (provider && modelId) {
				settings.chunking.rerankModel = { provider, modelId };
			}
		}
	}

	// 5. 搜索摘要生成模型：用于对搜索出的多个 Chunk 进行初级概括
	if (rawSearch.searchSummaryModel && typeof rawSearch.searchSummaryModel === 'object') {
		const model = rawSearch.searchSummaryModel as { provider?: unknown; modelId?: unknown };
		const provider = getString(model.provider, '');
		const modelId = getString(model.modelId, '');
		if (provider && modelId) {
			settings.searchSummaryModel = { provider, modelId };
		}
	}

	// 6. 联网搜索选项
	// 支持两种模式：直连 Perplexity API，或使用本地 Chromium 驱动进行真实的“爬虫搜索”
	const validImplementations = ['perplexity', 'local_chromium'] as const;
	if (rawSearch.aiAnalysisWebSearchImplement && validImplementations.includes(rawSearch.aiAnalysisWebSearchImplement as any)) {
		settings.aiAnalysisWebSearchImplement = rawSearch.aiAnalysisWebSearchImplement as 'perplexity' | 'local_chromium';
	}

	// 7. 摘要长度约束：防止生成的短摘要由于太短而失去信息量，或长摘要超过 LLM 处理能力
	if (typeof rawSearch.shortSummaryLength === 'number') {
		settings.shortSummaryLength = Math.max(50, Math.min(500, rawSearch.shortSummaryLength));
	}
	if (typeof rawSearch.fullSummaryLength === 'number') {
		settings.fullSummaryLength = Math.max(500, Math.min(10000, rawSearch.fullSummaryLength));
	}

	return settings;
}

/**
 * 加载并规格化插件设置。
 * 核心原则：即便 data.json 中的数据损坏或部分缺失，也要通过 `DEFAULT_SETTINGS` 凑齐一个合法的 `MyPluginSettings` 对象。
 */
export function normalizePluginSettings(data: unknown): MyPluginSettings {
	const raw = (data ?? {}) as Record<string, unknown>;

	// 显式构建设置对象
	const settings: MyPluginSettings = {
		// 全局文件夹配置
		scriptFolder: getString(raw?.scriptFolder, DEFAULT_SETTINGS.scriptFolder),
		htmlViewConfigFile: getString(raw?.htmlViewConfigFile, DEFAULT_SETTINGS.htmlViewConfigFile),
		statisticsDataStoreFolder: getString(raw?.statisticsDataStoreFolder, DEFAULT_SETTINGS.statisticsDataStoreFolder),
		dataStorageFolder: getString(raw?.dataStorageFolder, DEFAULT_SETTINGS.dataStorageFolder),

		// 核心业务设置（分层处理）
		ai: normalizeAIServiceSettings(raw),
		search: normalizeSearchSettings(raw),

		// 用于控制或隐藏其他插件命令的配置
		commandHidden: (() => {
			const source = raw?.commandHidden;
			if (source && typeof source === 'object') {
				return { ...DEFAULT_COMMAND_HIDDEN_SETTINGS, ...source };
			}
			return DEFAULT_COMMAND_HIDDEN_SETTINGS;
		})(),
	};

	// SQLite 后端偏好设置 (auto | better-sqlite3 | sql.js)
	const sqliteBackend = raw?.sqliteBackend;
	if (sqliteBackend === 'auto' || sqliteBackend === 'better-sqlite3' || sqliteBackend === 'sql.js') {
		settings.sqliteBackend = sqliteBackend;
	}

	return settings;
}


