/**
 * @file perplexity.ts
 * @description Perplexity 联网搜索模型提供商实现类。
 * 
 * Perplexity 的特色在于其集成了实时搜索能力的 LLM（如 Sonar 系列）。
 * 本文件实现了与 Perplexity API 的对接，并提供了标准的对话接口。
 * 
 * 主要职责：
 * 1. 管理 Perplexity 联网搜索模型（Sonar 家族）的 ID 映射。
 * 2. 提供专门针对搜索模型的显示名称格式化逻辑（formatModelDisplayName）。
 * 3. 封装流式和阻塞式对话请求。
 * 
 * 逻辑细节：
 * 与其他厂商不同，Perplexity 的模型命名包含大量连字符和系列名（如 sonar-pro, sonar-reasoning）。
 * 我们在 UI 展示时会通过 `formatModelDisplayName` 进行美化，使其更符合用户习惯。
 */

import {
	LLMRequest,
	LLMResponse,
	LLMProviderService,
	ModelMetaData,
	ProviderMetaData,
	LLMStreamEvent,
} from '../types';
import { createPerplexity, type PerplexityProvider } from '@ai-sdk/perplexity';
import { type LanguageModel } from 'ai';
import { blockChat, streamChat } from '../adapter/ai-sdk-adapter';

/** 默认请求超时 */
const DEFAULT_PERPLEXITY_TIMEOUT_MS = 60000;
/** 官方 API 基础地址 */
const PERPLEXITY_DEFAULT_BASE = 'https://api.perplexity.ai';

export const PROVIDER_ID_PERPLEXITY = 'perplexity';

/**
 * 模型映射接口：记录 API 真实 ID 与 UI 图标 ID。
 */
interface ModelMapping {
	/** API 调用时使用的模型标识 */
	modelId: string;
	/** 图标 ID，兼容 @lobehub/icons */
	icon: string;
}

/**
 * 核心映射表：定义了插件支持的 Perplexity 联网模型。
 * 
 * Perplexity 主要提供以下几种变体：
 * - sonar-pro: 高性能联网搜索模型。
 * - sonar-reasoning: 带有思维链推理能力的搜索模型。
 * - sonar-deep-research: 深度研究模式模型。
 * 
 * 设计演进：
 * 采用统一映射结构，确保用户看到简洁名称，而 API 调用使用最新 ID。
 */
const MODEL_ID_MAP: Record<string, ModelMapping> = {
	// Sonar 家族 - 当前最强联网搜索系列
	'sonar-deep-research': { modelId: 'sonar-deep-research', icon: 'perplexity' },
	'sonar-reasoning-pro': { modelId: 'sonar-reasoning-pro', icon: 'perplexity' },
	'sonar-reasoning': { modelId: 'sonar-reasoning', icon: 'perplexity' },
	'sonar-pro': { modelId: 'sonar-pro', icon: 'perplexity' },
	'sonar': { modelId: 'sonar', icon: 'perplexity' },
};

/**
 * 获取支持的模型列表。
 */
export function getKnownPerplexityModelIds(): readonly string[] {
	return Object.keys(MODEL_ID_MAP);
}

/** Perplexity 模型列表 API 响应格式 */
interface PerplexityModelResponse {
	object: string;
	data: Array<{
		id: string;
		object: string;
		created: number;
		owned_by: string;
	}>;
}

/**
 * 【显示优化】格式化模型展示名称。
 * 将 'sonar-reasoning-pro' 转换为 'Sonar Reasoning Pro'。
 */
function formatModelDisplayName(modelId: string): string {
	let displayName = modelId;
	
	// 处理旧版以 pplx- 开头的模型名
	if (displayName.startsWith('pplx-')) {
		displayName = displayName.replace('pplx-', 'Perplexity ');
		displayName = displayName.replace(/-([a-z])/g, (_, letter) => ` ${letter.toUpperCase()}`);
		displayName = displayName.replace(/^([a-z])/g, (_, letter) => letter.toUpperCase());
		return displayName;
	}
	
	// 处理 Llama 关联的搜索模型
	if (displayName.includes('llama-3-sonar')) {
		displayName = displayName.replace('llama-3-sonar-', 'Llama 3 Sonar ');
		displayName = displayName.replace(/-([a-z])/g, (_, letter) => ` ${letter.toUpperCase()}`);
		displayName = displayName.replace(/^([a-z])/g, (_, letter) => letter.toUpperCase());
		return displayName;
	}
	
	// 常规格式化：首字母大写
	if (displayName.length > 0 && displayName[0] !== displayName[0].toUpperCase()) {
		displayName = displayName.charAt(0).toUpperCase() + displayName.slice(1);
	}
	
	return displayName;
}

/**
 * 【预留逻辑】从服务器拉取模型列表。
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function fetchPerplexityModels(
	baseUrl?: string,
	apiKey?: string,
): Promise<ModelMetaData[] | null> {
	if (!apiKey) {
		return null;
	}

	try {
		const url = baseUrl ?? PERPLEXITY_DEFAULT_BASE;
		const apiUrl = `${url}/models`;

		const response = await fetch(apiUrl, {
			method: 'GET',
			headers: {
				'Authorization': `Bearer ${apiKey}`,
				'Content-Type': 'application/json',
			},
			signal: AbortSignal.timeout(DEFAULT_PERPLEXITY_TIMEOUT_MS),
		});

		if (!response.ok) {
			throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
		}

		const data: PerplexityModelResponse = await response.json();

		if (!data.data || !Array.isArray(data.data)) {
			throw new Error('Invalid response format: data array not found');
		}

		return data.data.map((model) => {
			const displayName = formatModelDisplayName(model.id);

			return {
				id: model.id,
				displayName,
				icon: 'perplexity',
			};
		});
	} catch (error) {
		console.error('[PerplexityChatService] Error fetching models:', error);
		return null;
	}
}

/**
 * Perplexity 服务配置选项。
 */
export interface PerplexityChatServiceOptions {
	/** 自定义 API 地址 */
	baseUrl?: string;
	/** 必填：Perplexity API Key */
	apiKey?: string;
	/** 其他扩展参数 */
	extra?: Record<string, any>;
}

/**
 * Perplexity 对话服务类。
 */
export class PerplexityChatService implements LLMProviderService {
	// 底层 AI SDK 的 Perplexity 适配器
	private readonly client: PerplexityProvider;

	constructor(private readonly options: PerplexityChatServiceOptions) {
		if (!this.options.apiKey) {
			throw new Error('Perplexity API key is required');
		}
		this.client = createPerplexity({
			apiKey: this.options.apiKey,
			baseURL: this.options.baseUrl ?? PERPLEXITY_DEFAULT_BASE,
		});
	}

	getProviderId(): string {
		return PROVIDER_ID_PERPLEXITY;
	}

	/**
	 * 【内部逻辑】标准化模型 ID。
	 */
	private normalizeModelId(modelId: string): string {
		return MODEL_ID_MAP[modelId]?.modelId || modelId;
	}

	/**
	 * 获取底层语言模型客户端。
	 */
	modelClient(model: string): LanguageModel {
		return this.client(this.normalizeModelId(model)) as unknown as LanguageModel;
	}


	async blockChat(request: LLMRequest<any>): Promise<LLMResponse> {
		return blockChat(this.modelClient(request.model), request);
	}

	streamChat(request: LLMRequest<any>): AsyncGenerator<LLMStreamEvent> {
		return streamChat(this.modelClient(request.model), request);
	}

	async getAvailableModels(): Promise<ModelMetaData[]> {
		// Return model IDs from MODEL_ID_MAP
		return getKnownPerplexityModelIds().map((modelId) => {
			const mapping = MODEL_ID_MAP[modelId];
			return {
				id: modelId,
				displayName: modelId,
				icon: mapping?.icon || 'perplexity',
			};
		});
	}

	getProviderMetadata(): ProviderMetaData {
		return {
			id: 'perplexity',
			name: 'Perplexity',
			defaultBaseUrl: PERPLEXITY_DEFAULT_BASE,
			icon: 'perplexity',
		};
	}

	async generateEmbeddings(texts: string[], model: string): Promise<number[][]> {
		throw new Error('Perplexity does not support embeddings');
	}
}

