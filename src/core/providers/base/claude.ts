/**
 * @file claude.ts
 * @description Anthropic Claude 服务提供商实现类。
 * 
 * 本文件实现了与 Anthropic 官方 API 的对接。
 * 采用了与 OpenAI 类似的【ID 映射机制】，将用户的简洁选择（如 claude-3-5-sonnet）
 * 映射为带有具体日期的 API ID（如 claude-3-5-sonnet-20241022）。
 * 
 * 主要职责：
 * 1. 管理 Claude 各个版本（Opus, Sonnet, Haiku）的模型映射和图标。
 * 2. 封装 Anthropic 专有的请求参数转换。
 * 3. 提供流式和非流式对话能力。
 * 
 * 注意：
 * Claude 目前官方 API 不直接提供 Embedding（向量化）功能，因此 `generateEmbeddings` 方法会抛出不支持异常。
 */

import {
	LLMResponse,
	LLMRequest,
	LLMProviderService,
	ModelMetaData,
	ProviderMetaData,
	LLMStreamEvent,
} from '../types';
import { createAnthropic, type AnthropicProvider } from '@ai-sdk/anthropic';
import { type LanguageModel } from 'ai';
import { blockChat, streamChat } from '../adapter/ai-sdk-adapter';

/** 默认的最大输出 Token 数 */
const DEFAULT_CLAUDE_MAX_OUTPUT_TOKENS = 1024;
/** 官方 API 基础地址 */
const CLAUDE_DEFAULT_BASE = 'https://api.anthropic.com/v1';

/**
 * 模型映射接口：包含 API 真实 ID 与 UI 图标标识。
 */
interface ModelMapping {
	/** API 调用时使用的带有日期后缀的精确 ID */
	modelId: string;
	/** 用于 UI 展示的图标，兼容 @lobehub/icons */
	icon: string;
}

/**
 * 核心映射表：定义了插件支持的所有 Claude 模型。
 * 
 * 设计初衷：
 * 1. 易读性：用户只需看到 `claude-3-5-sonnet`，而非复杂的带日期名称。
 * 2. 稳定性：当 Anthropic 发布模型的小版本更新时，我们只需在此更新 `modelId`，无需修改业务逻辑。
 * 3. 图标统一：所有 Claude 系列模型目前统一使用 'claude' 图标。
 */
const MODEL_ID_MAP: Record<string, ModelMapping> = {
	// Claude 4 系列 (预定义未来支持)
	'claude-4-opus': { modelId: 'claude-4-opus-20250514', icon: 'claude' },
	'claude-4-sonnet': { modelId: 'claude-4-sonnet-20250514', icon: 'claude' },
	// Claude 3.7 系列
	'claude-3-7-sonnet': { modelId: 'claude-3-7-sonnet-20250219', icon: 'claude' },
	// Claude 3.5 系列 - 当前的主力模型
	'claude-3-5-sonnet': { modelId: 'claude-3-5-sonnet-20241022', icon: 'claude' },
	'claude-3-5-haiku': { modelId: 'claude-3-5-haiku-20241022', icon: 'claude' },
	// Claude 3 系列 - 经典平衡模型
	'claude-3-opus': { modelId: 'claude-3-opus-20240229', icon: 'claude' },
	'claude-3-sonnet': { modelId: 'claude-3-sonnet-20240229', icon: 'claude' },
	'claude-3-haiku': { modelId: 'claude-3-haiku-20240307', icon: 'claude' },
};

/**
 * 获取所有支持的简洁模型 ID 列表。
 */
export function getKnownClaudeModelIds(): readonly string[] {
	return Object.keys(MODEL_ID_MAP);
}

/**
 * Claude 服务初始化选项
 */
export interface ClaudeChatServiceOptions {
	/** 自定义代理或中转地址 */
	baseUrl?: string;
	/** API 凭证 */
	apiKey?: string;
	/** 默认最大输出限制 */
	maxOutputTokens?: number;
	/** 提供商特定的额外扩展参数 */
	extra?: Record<string, any>;
}

/**
 * Claude 对话服务核心实现类
 */
export class ClaudeChatService implements LLMProviderService {
	// 底层 AI SDK 的 Anthropic Provider
	private readonly client: AnthropicProvider;
	// 实例级别的 Token 限制开关
	private readonly maxOutputTokens: number;

	constructor(private readonly options: ClaudeChatServiceOptions) {
		if (!this.options.apiKey) {
			throw new Error('Claude API key is required');
		}
		// 优先级：显示参数 > extra 扩展参数 > 内部默认值
		this.maxOutputTokens = this.options.maxOutputTokens ?? this.options.extra?.maxOutputTokens ?? DEFAULT_CLAUDE_MAX_OUTPUT_TOKENS;
		
		// 初始化 Anthropic 客户端
		this.client = createAnthropic({
			apiKey: this.options.apiKey,
			baseURL: this.options.baseUrl ?? CLAUDE_DEFAULT_BASE,
		});
	}

	getProviderId(): string {
		return 'claude';
	}

	/**
	 * 【核心逻辑】标准化模型 ID。
	 * 在发送网络请求前，将界面选择的 ID 还原为 API 需要的带日期格式。
	 */
	private normalizeModelId(modelId: string): string {
		return MODEL_ID_MAP[modelId]?.modelId || modelId;
	}

	/**
	 * 创建可由 AI SDK 调用的 LanguageModel 实例。
	 */
	modelClient(model: string): LanguageModel {
		return this.client(this.normalizeModelId(model)) as unknown as LanguageModel;
	}

	/**
	 * 执行单次阻塞对话。
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
	 * 获取当前厂商在插件中配置的所有模型元数据。
	 */
	async getAvailableModels(): Promise<ModelMetaData[]> {
		return getKnownClaudeModelIds().map((modelId) => {
			const mapping = MODEL_ID_MAP[modelId];
			return {
				id: modelId,
				displayName: modelId,
				icon: mapping?.icon || 'claude',
			};
		});
	}

	/**
	 * 获取厂商元数据。
	 */
	getProviderMetadata(): ProviderMetaData {
		return {
			id: 'claude',
			name: 'Anthropic',
			defaultBaseUrl: CLAUDE_DEFAULT_BASE,
			icon: 'anthropic', // 品牌图标 ID
		};
	}

	/**
	 * 向量生成（目前 Claude 厂商不直接支持，需使用其他厂商如 OpenAI 或 Jina 的模型）。
	 */
	async generateEmbeddings(texts: string[], model: string): Promise<number[][]> {
		throw new Error('Claude provider does not support embedding generation');
	}
}


