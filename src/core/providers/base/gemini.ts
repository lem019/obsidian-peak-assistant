/**
 * @file gemini.ts
 * @description Google Gemini 服务提供商实现类。
 * 
 * 本文件实现了与 Google AI SDK (Generative Language API) 的对接。
 * 它遵循了插件统一的【ID 映射机制】，将用户的简洁模型名称（如 gemini-1.5-pro）
 * 映射为带有版本号的 API 真实 ID（如 gemini-1.5-pro-002）。
 * 
 * 主要职责：
 * 1. 管理 Google Gemini 系列模型（Pro, Flash 等）的映射和图标。
 * 2. 封装 Google AI SDK 的初始化逻辑。
 * 3. 提供流式和非流式对话能力。
 * 
 * 注意：
 * 由于 Google Gemini 的 API 格式与 OpenAI 并不完全兼容，我们专门引入了 `@ai-sdk/google` 进行适配。
 */

import {
	LLMProviderService,
	ModelMetaData,
	ProviderMetaData,
} from '../types';
import { createGoogleGenerativeAI, GoogleGenerativeAIProvider } from '@ai-sdk/google';
import { blockChat, streamChat } from '../adapter/ai-sdk-adapter';
import { LLMRequest, LLMResponse, LLMStreamEvent } from '../types';
import { LanguageModel } from 'ai';

/** Google 官方 API 的 V1Beta 版端点 */
const GEMINI_DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * 模型映射接口：记录 API 真实 ID 与 UI 图标 ID。
 */
interface ModelMapping {
	/** API 调用时使用的带有版本号的精确 ID */
	modelId: string;
	/** 用于 UI 展示的图标，兼容 @lobehub/icons */
	icon: string;
}

/**
 * 核心映射表：定义了插件支持的所有 Gemini 模型。
 * 
 * 设计演进：
 * 1. 屏蔽版本干扰：Google 经常发布类似 -002 的小版本，映射表确保用户始终看到稳定的名称。
 * 2. 自动升级：当新版本发布且更稳定时，我们只需修改 `modelId`。
 */
const MODEL_ID_MAP: Record<string, ModelMapping> = {
	// Gemini 2.5 系列 (预研支持)
	'gemini-2.5-pro': { modelId: 'gemini-2.5-pro', icon: 'gemini' },
	'gemini-2.5-flash': { modelId: 'gemini-2.5-flash', icon: 'gemini' },
	// Gemini 2.0 系列 - 当前最强闪电模型
	'gemini-2.0-flash': { modelId: 'gemini-2.0-flash-001', icon: 'gemini' },
	// Gemini 1.5 系列 - 经典大上下文模型
	'gemini-1.5-pro': { modelId: 'gemini-1.5-pro-002', icon: 'gemini' },
	'gemini-1.5-flash': { modelId: 'gemini-1.5-flash-002', icon: 'gemini' },
};

/**
 * 获取所有支持的 Gemini 模型 ID。
 */
export function getKnownGeminiModelIds(): readonly string[] {
	return Object.keys(MODEL_ID_MAP);
}

/**
 * Gemini 服务初始化选项
 */
export interface GeminiChatServiceOptions {
	/** 自定义代理或中转地址 */
	baseUrl?: string;
	/** Google AI Studio 提供的 API Key */
	apiKey?: string;
	/** 其他扩展参数 */
	extra?: Record<string, any>;
}

/**
 * Gemini 对话服务核心实现类
 */
export class GeminiChatService implements LLMProviderService {
	// 底层 AI SDK 的 Google Provider
	private readonly client: GoogleGenerativeAIProvider;

	constructor(private readonly options: GeminiChatServiceOptions) {
		if (!this.options.apiKey) {
			throw new Error('Gemini API key is required');
		}
		// 初始化 Google AI 客户端
		this.client = createGoogleGenerativeAI({
			apiKey: this.options.apiKey,
			baseURL: this.options.baseUrl ?? GEMINI_DEFAULT_BASE,
		});
	}

	getProviderId(): string {
		return 'gemini';
	}

	/**
	 * 【内部逻辑】标准化模型 ID。
	 * 将界面选择的简洁 ID 映射为 API 环境下的真实版本号 ID。
	 */
	private normalizeModelId(modelId: string): string {
		return MODEL_ID_MAP[modelId]?.modelId || modelId;
	}

	/**
	 * 创建底层模型调用客户端。
	 */
	modelClient(model: string): LanguageModel {
		return this.client(this.normalizeModelId(model)) as unknown as LanguageModel;
	}

	/**
	 * 执行单次封包对话。
	 */
	async blockChat(request: LLMRequest<any>): Promise<LLMResponse> {
		return blockChat(this.modelClient(request.model), request);
	}

	/**
	 * 执行流式异步对话。
	 */
	streamChat(request: LLMRequest<any>): AsyncGenerator<LLMStreamEvent> {
		return streamChat(this.modelClient(request.model), request);
	}

	/**
	 * 获取当前提供商支持的模型元数据列表。
	 */
	async getAvailableModels(): Promise<ModelMetaData[]> {
		return getKnownGeminiModelIds().map((modelId) => {
			const mapping = MODEL_ID_MAP[modelId];
			return {
				id: modelId,
				displayName: modelId,
				icon: mapping?.icon || 'gemini',
			};
		});
	}

	/**
	 * 获取提供商元数据。
	 */
	getProviderMetadata(): ProviderMetaData {
		return {
			id: 'gemini',
			name: 'Google',
			defaultBaseUrl: GEMINI_DEFAULT_BASE,
			icon: 'google', // UI 品牌图标标识
		};
	}

	/**
	 * 向量生成（目前 Gemini 实现类中未开启此项，建议使用 OpenAI 或专门的 Rerank 厂商进行替代）。
	 */
	async generateEmbeddings(texts: string[], model: string): Promise<number[][]> {
		throw new Error('Gemini provider does not support embedding generation');
	}
}


