/**
 * @file openrouter.ts
 * @description OpenRouter 模型聚合服务实现类。
 * 
 * OpenRouter 是一个 LLM 代理网关，其最大特色是：【一个 Key 访问所有模型】。
 * 本文件实现了与 OpenRouter API 的对接，并通过专门的 `@openrouter/ai-sdk-provider` 进行封装。
 * 
 * 主要职责：
 * 1. 管理 OpenRouter 特有的 HTTP Header（如 HTTP-Referer 和 X-Title，用于在 OpenRouter 官网展示插件引用量）。
 * 2. 动态汇总来自 OpenAI, Anthropic, Google 等不同厂商的模型列表，并加上对应厂商的前缀（如 `anthropic/claude-3`）。
 * 3. 实现了 OpenAI 兼容格式的向量生成（Embeddings）接口。
 * 
 * 逻辑亮点：
 * `getAvailableModels` 方法通过复用 `openai.ts`, `claude.ts` 等文件定义的已知模型列表，
 * 自动生成了一套适配 OpenRouter 路径规范的模型菜单。
 */

import {
	LLMRequest,
	LLMResponse,
	LLMProviderService,
	ModelMetaData,
	ProviderMetaData,
	LLMStreamEvent,
} from '../types';
import { createOpenRouter, type OpenRouterProvider } from '@openrouter/ai-sdk-provider';
import { type LanguageModel } from 'ai';
import { blockChat, streamChat } from '../adapter/ai-sdk-adapter';
import { getKnownOpenAIModelIds, getOpenAIAvatarType } from './openai';
import { getKnownClaudeModelIds } from './claude';
import { getKnownGeminiModelIds } from './gemini';

/** 默认请求超时 */
const DEFAULT_OPENROUTER_TIMEOUT_MS = 60000;
/** OpenRouter 官方 API 地址 */
const OPENROUTER_DEFAULT_BASE = 'https://openrouter.ai/api/v1';

/**
 * OpenRouter 服务配置选项
 */
export interface OpenRouterChatServiceOptions {
	/** 自定义代理地址 */
	baseUrl?: string;
	/** 必填：OpenRouter API Key */
	apiKey?: string;
	/** 引用来源 URL，会在 OpenRouter 控制台显示 */
	referer?: string;
	/** 应用名称，会在 OpenRouter 控制台显示 */
	title?: string;
	/** 其他扩展 */
	extra?: Record<string, any>;
}

const DEFAULT_OPENROUTER_REFERER = 'https://obsidian.md';
const DEFAULT_OPENROUTER_TITLE = 'Peak Assistant';

/**
 * OpenRouter 核心服务类
 */
export class OpenRouterChatService implements LLMProviderService {
	// 底层适配器客户端
	private readonly client: OpenRouterProvider;
	private readonly referer: string;
	private readonly title: string;

	constructor(private readonly options: OpenRouterChatServiceOptions) {
		if (!this.options.apiKey) {
			throw new Error('OpenRouter API key is required');
		}
		
		// 自动从 extra 或默认值中获取身份标识信息
		this.referer = this.options.referer ?? this.options.extra?.referer ?? DEFAULT_OPENROUTER_REFERER;
		this.title = this.options.title ?? this.options.extra?.title ?? DEFAULT_OPENROUTER_TITLE;

		const headers: Record<string, string> = {};
		if (this.referer) {
			headers['HTTP-Referer'] = this.referer;
		}
		if (this.title) {
			headers['X-Title'] = this.title;
		}

		// 初始化客户端，注入特殊的身份标识 Header
		this.client = createOpenRouter({
			apiKey: this.options.apiKey,
			baseURL: this.options.baseUrl ?? OPENROUTER_DEFAULT_BASE,
			headers,
		});
	}

	getProviderId(): string {
		return 'openrouter';
	}

	modelClient(model: string): LanguageModel {
		return this.client(model) as unknown as LanguageModel;
	}

	/**
	 * 执行单次对话生成。
	 */
	async blockChat(request: LLMRequest<any>): Promise<LLMResponse> {
		return blockChat(this.modelClient(request.model), request);
	}

	/**
	 * 执行异步流式对话。
	 */
	streamChat(request: LLMRequest<any>): AsyncGenerator<LLMStreamEvent> {
		return streamChat(this.modelClient(request.model), request);
	}

	/**
	 * 【关键逻辑】汇总各家模型。
	 * 
	 * 由于 OpenRouter 包含了大部分主流模型，我们在此通过引用其他 Provider 的已知模型，
	 * 为用户预置一套常用的 OpenRouter 模型菜单。
	 * ID 格式需遵循 OpenRouter 规范：`厂商前缀/模型名`。
	 */
	async getAvailableModels(): Promise<ModelMetaData[]> {
		const models: ModelMetaData[] = [];

		// OpenAI 家族，前缀 openai/
		for (const modelId of getKnownOpenAIModelIds()) {
			models.push({
				id: `openai/${modelId}`,
				displayName: modelId,
				icon: getOpenAIAvatarType(modelId),
			});
		}

		// Claude 家族，前缀 anthropic/
		for (const modelId of getKnownClaudeModelIds()) {
			models.push({
				id: `anthropic/${modelId}`,
				displayName: modelId,
				icon: 'claude',
			});
		}

		// Gemini 家族，前缀 google/
		for (const modelId of getKnownGeminiModelIds()) {
			models.push({
				id: `google/${modelId}`,
				displayName: modelId,
				icon: 'gemini',
			});
		}

		return models;
	}

	/**
	 * 获取厂商元数据。
	 */
	getProviderMetadata(): ProviderMetaData {
		return {
			id: 'openrouter',
			name: 'OpenRouter',
			defaultBaseUrl: OPENROUTER_DEFAULT_BASE,
			icon: 'openrouter',
		};
	}

	/**
	 * 【高级功能】向量生成。
	 * OpenRouter 的 API 与 OpenAI 协议高度一致，因此这里直接封装了一个标准的 fetch POST 请求
	 * 来调用 `/embeddings` 接口，以便插件的 RAG（本地知识库）功能能配合 OpenRouter 使用。
	 */
	async generateEmbeddings(texts: string[], model: string): Promise<number[][]> {
		const timeoutMs = DEFAULT_OPENROUTER_TIMEOUT_MS;

		const headers: Record<string, string> = {
			'Authorization': `Bearer ${this.options.apiKey}`,
			'Content-Type': 'application/json',
		};
		if (this.referer) {
			headers['HTTP-Referer'] = this.referer;
		}
		if (this.title) {
			headers['X-Title'] = this.title;
		}

		const baseUrl = this.options.baseUrl ?? OPENROUTER_DEFAULT_BASE;
		const url = `${baseUrl}/embeddings`;

		// 使用原生 fetch 发起请求，确保兼容各种 HTTP 环境
		const response = await fetch(url, {
			method: 'POST',
			headers,
			body: JSON.stringify({
				input: texts,
				model: model,
			}),
			signal: AbortSignal.timeout(timeoutMs),
		});

		if (!response.ok) {
			const errorText = await response.text().catch(() => 'Unknown error');
			throw new Error(`OpenRouter embedding API error: ${response.status} ${response.statusText}. ${errorText}`);
		}

		const data = await response.json();

		if (!data.data || !Array.isArray(data.data)) {
			throw new Error('Invalid embedding API response: missing data array');
		}

		// 解析返回结果，提取核心向量数值
		const embeddings: number[][] = data.data.map((item: { embedding?: number[] }) => {
			if (!item.embedding || !Array.isArray(item.embedding)) {
				throw new Error('Invalid embedding format in API response');
			}
			return item.embedding;
		});

		return embeddings;
	}
}


