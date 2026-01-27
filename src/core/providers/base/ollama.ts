/**
 * @file ollama.ts
 * @description Ollama 本地服务提供商实现类。
 * 
 * 本文件实现了与本地运行的 Ollama 服务对接。
 * 与云端服务（OpenAI/Claude）最大的不同点在于：
 * 1. 【动态模型发现】它不是维护一个死板的模型列表，而是通过调用 Ollama 的 `/api/tags` 接口，
 *    实时获取用户本地已经下载的模型，并自动生成图标和展示名称。
 * 2. 【本地化适配】处理了 Base URL 的规范化问题（自动补全 /api 后缀）。
 * 3. 【图标推断】由于本地模型名称千奇百怪，实现了一套基于正则匹配的图标推断逻辑（MODEL_ICON_MAP）。
 * 
 * 主要职责：
 * 1. 动态获取本地已安装的模型列表。
 * 2. 规范化 Ollama API 地址。
 * 3. 将本地模型映射到对应的品牌图标（如匹配 llama3 到 Meta 图标）。
 */

import {
	LLMRequest,
	LLMResponse,
	LLMProviderService,
	ModelMetaData,
	ProviderMetaData,
	LLMStreamEvent,
} from '../types';
import { createOllama, type OllamaProvider } from 'ollama-ai-provider-v2';
import { embedMany, type LanguageModel, type EmbeddingModel } from 'ai';
import { blockChat, streamChat } from '../adapter/ai-sdk-adapter';
import { trimTrailingSlash } from '@/core/utils/format-utils';

/** 默认的本地服务超时时间 */
const DEFAULT_OLLAMA_TIMEOUT_MS = 60000;
/** Ollama 默认的本地监听地址 */
export const OLLAMA_DEFAULT_BASE = 'http://localhost:11434';

/**
 * 【关键工具】规范化 Ollama Base URL
 * 
 * 原因是 `ollama-ai-provider-v2` 库要求基准地址必须以 `/api` 结尾。
 * 用户在界面输入的往往是 `http://localhost:11434`，本函数会自动将其转换为 
 * `http://localhost:11434/api`，从而避免请求 404。
 */
function normalizeOllamaBaseUrl(baseUrl: string): string {
	// 移除结尾可能的 v1 后缀或多余斜杠
	let normalized = baseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '');

	// 强制补充 /api
	if (!normalized.endsWith('/api')) {
		normalized = `${normalized}/api`;
	}

	return normalized;
}


export interface OllamaChatServiceOptions {
	/** 本地 Ollama URL */
	baseUrl?: string;
	/** Ollama 本身不强制要求 API Key，但部分转发层可能需要 */
	apiKey?: string;
	/** 额外参数 */
	extra?: Record<string, any>;
}

/** Ollama API 返回的模型对象定义 */
interface OllamaModelResponse {
	models: Array<{
		name: string;
		modified_at: string;
		size: number;
		digest: string;
		details?: {
			format?: string;
			family?: string;
			families?: string[];
			parameter_size?: string;
			quantization_level?: string;
		};
	}>;
}

/**
 * 模型名匹配模式 -> 图标标识映射表。
 * 按照从具体到宽泛的顺序排列。
 */
const MODEL_ICON_MAP: Array<{ patterns: string[]; icon: string }> = [
	{ patterns: ['llama-3.1', 'llama3.1'], icon: 'llama-3.1' },
	{ patterns: ['llama-3', 'llama3'], icon: 'llama-3' },
	{ patterns: ['codellama', 'code-llama', 'codeqwen', 'codegemma', 'codestral'], icon: 'codellama' },
	{ patterns: ['mixtral'], icon: 'mixtral' },
	{ patterns: ['mistral'], icon: 'mistral' },
	{ patterns: ['phi-3', 'phi3'], icon: 'phi-3' },
	{ patterns: ['gemma', 'gemma2'], icon: 'gemma' },
	{ patterns: ['deepseek', 'deepseek-v2', 'deepseek-v3', 'deepseek-r1', 'deepseek-coder'], icon: 'deepseek' },
	{ patterns: ['qwen', 'qwen2', 'qwen2.5', 'qwen3', 'qwq'], icon: 'qwen' },
	{ patterns: ['neural-chat'], icon: 'neural-chat' },
	{ patterns: ['starling'], icon: 'starling-lm' },
	{ patterns: ['wizardlm', 'wizardlm2'], icon: 'wizardlm' },
	{ patterns: ['llava', 'minicpm-v'], icon: 'llava' },
	{ patterns: ['command-r', 'command-r-plus'], icon: 'command-r' },
	{ patterns: ['aya'], icon: 'aya' },
	{ patterns: ['gpt-oss'], icon: 'gpt-oss' },
];

/**
 * 根据模型名称或家族系列，推断出最合适的图标。
 */
function getModelIcon(family?: string, name?: string): string {
	if (!family && !name) {
		return 'ollama';
	}

	const searchText = `${name || ''} ${family || ''}`.toLowerCase().trim();

	// 匹配优先级：MODEL_ICON_MAP 中的特定模式 > 家族名称兜底
	for (const { patterns, icon } of MODEL_ICON_MAP) {
		if (patterns.some(pattern => searchText.includes(pattern))) {
			return icon;
		}
	}

	// 如果没有特定模式匹配，尝试硬编码的家族匹配
	if (family) {
		const lowerFamily = family.toLowerCase();
		if (lowerFamily === 'llama') return 'llama-3';
		if (lowerFamily === 'mistral') return 'mistral';
		if (lowerFamily === 'gemma') return 'gemma';
	}

	return 'ollama';
}

/**
 * 【底层网络方法】从 Ollama 接口拉取模型元数据。
 */
async function fetchOllamaModels(
	baseUrl?: string,
): Promise<ModelMetaData[] | null> {
	try {
		const url = baseUrl ?? OLLAMA_DEFAULT_BASE;
		const apiUrl = `${trimTrailingSlash(url)}/api/tags`;

		// 显式设置超时，避免本地服务卡死时插件界面失去响应
		const response = await fetch(apiUrl, {
			method: 'GET',
			headers: {
				'Content-Type': 'application/json',
			},
			signal: AbortSignal.timeout(DEFAULT_OLLAMA_TIMEOUT_MS),
		});

		if (!response.ok) {
			throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
		}

		const data: OllamaModelResponse = await response.json();

		if (!data.models || !Array.isArray(data.models)) {
			throw new Error('Invalid response format: models array not found');
		}

		// 将原始 API 数据转换为插件通用的 ModelMetaData 格式
		return data.models.map((model) => {
			const family = model.details?.family || '';
			const icon = getModelIcon(family, model.name);

			// 展示效果优化：尝试给模型名称加空格，如 llama3 -> Llama 3
			let displayName = model.name;
			displayName = displayName.replace(/([a-z])([0-9])/gi, '$1 $2');
			displayName = displayName.charAt(0).toUpperCase() + displayName.slice(1);

			return {
				id: model.name,
				displayName,
				icon,
			};
		});
	} catch (error) {
		console.error('[OllamaChatService] Error fetching models:', error);
		return null;
	}
}

/**
 * Ollama 对话服务核心类。
 */
export class OllamaChatService implements LLMProviderService {
	// 使用专门的 ollama-ai-provider-v2 库进行底层序列化
	private readonly client: OllamaProvider;

	constructor(private readonly options: OllamaChatServiceOptions) {
		const baseUrl = this.options.baseUrl ?? OLLAMA_DEFAULT_BASE;
		const normalizedBaseUrl = normalizeOllamaBaseUrl(baseUrl);
		this.client = createOllama({
			baseURL: normalizedBaseUrl,
		});
	}

	getProviderId(): string {
		return 'ollama';
	}

	/**
	 * 创建可供 AI SDK 调用的模型实例。
	 */
	modelClient(model: string): LanguageModel {
		return this.client(model) as unknown as LanguageModel;
	}

	/**
	 * 执行非流式生成耗时任务。
	 */
	async blockChat(request: LLMRequest<any>): Promise<LLMResponse> {
		return blockChat(this.modelClient(request.model), request);
	}

	/**
	 * 执行流式文本生成。
	 */
	streamChat(request: LLMRequest<any>): AsyncGenerator<LLMStreamEvent> {
		return streamChat(this.modelClient(request.model), request);
	}

	/**
	 * 【核心差异化方法】动态获取可用模型。
	 * 每次用户刷新设置，都会真实调用一次本地 API，确保能发现新拉取的模型。
	 */
	async getAvailableModels(): Promise<ModelMetaData[]> {
		const models = await fetchOllamaModels(
			this.options.baseUrl,
		);

		if (models) {

			return models;
		}

		// Original hardcoded models list (commented out but kept for reference)
		// return [
		// 	{ id: 'llama3.1', displayName: 'Llama 3.1', icon: 'llama-3.1' },
		// 	{ id: 'llama3', displayName: 'Llama 3', icon: 'llama-3' },
		// 	{ id: 'mistral', displayName: 'Mistral', icon: 'mistral' },
		// 	{ id: 'phi3', displayName: 'Phi-3', icon: 'phi-3' },
		// 	{ id: 'qwen', displayName: 'Qwen', icon: 'qwen' },
		// ];

		return [];
	}

	getProviderMetadata(): ProviderMetaData {
		return {
			id: 'ollama',
			name: 'Ollama',
			defaultBaseUrl: OLLAMA_DEFAULT_BASE,
			icon: 'ollama',
		};
	}

	async generateEmbeddings(texts: string[], model: string): Promise<number[][]> {
		try {
			// Use ollama-ai-provider-v2's embeddingModel method to create embedding model
			// Following AI SDK example: ollama.embeddingModel('nomic-embed-text')
			// Try embeddingModel first, fallback to textEmbeddingModel if not available
			const embeddingModel = this.client.textEmbeddingModel(model);
			if (!embeddingModel) {
				throw new Error('Ollama provider does not support embedding models');
			}
			const result = await embedMany({
				model: embeddingModel,
				values: texts,
			});
			return result.embeddings;
		} catch (error) {
			console.error('[OllamaChatService] Error generating embeddings:', error);
			throw error;
		}
	}
}

