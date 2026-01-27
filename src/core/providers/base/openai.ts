/**
 * @file openai.ts
 * @description OpenAI 服务提供商实现类。
 * 
 * 本文件是插件对接 OpenAI 官方生态（包括各种中转站）的“翻译官”。
 * 它的核心作用是让插件能够顺畅地与 OpenAI 的服务器沟通。
 * 
 * 为什么要写这个文件？主要解决了两个痛点：
 * 1. 【模型改名部】：AI 公司给模型起名很乱，比如 `gpt-4o-2024-11-20`。用户不想记这些日期。
 *    这个文件把它们统一映射成好记的 `gpt-4o`。
 * 2. 【多功能转换】：有的模型能看图（Vision），有的只能写字。这个文件上报每个模型的身家性命（能力值），
 *    好让插件界面知道什么时候该显示“传图按钮”。
 * 
 * 联动关系：
 * - 它是 `MultiProviderChatService` 的一个子员，听候它的调遣。
 * - 它利用 `ai-sdk-adapter.ts` 来完成真正的发包和解析回包工作。
 * 
 * 举例说明：
 * 用户在界面选了 "gpt-4o"。这个文件接到指令后，查表发现真正的代号是 `gpt-4o-2024-11-20`，
 * 然后把用户的 API Key 贴上去，打包发给 OpenAI 拿回答案，最后传回给用户。
 */

import {
	LLMRequest,
	LLMResponse,
	LLMProviderService,
	ModelMetaData,
	ProviderMetaData,
	LLMStreamEvent,
} from '../types';
import { createOpenAI, OpenAIProvider } from '@ai-sdk/openai';
import { embedMany, type EmbeddingModel, type LanguageModel } from 'ai';
import { blockChat, streamChat } from '../adapter/ai-sdk-adapter';

/** OpenAI 官方 API 的默认基础地址 */
const OPENAI_DEFAULT_BASE = 'https://api.openai.com/v1';

/**
 * Model mapping interface containing both the actual API model ID and the icon identifier.
 * 模型映射接口：记录了 AI 服务商认的“真名”和界面显示的“图标名”。
 */
interface ModelMapping {
	/** Actual API model ID to use for API calls (may include date suffix for AI SDK 5 v2 compatibility) 
	 * 实际调用 API 时使用的 ID（通常带日期后缀，如 gpt-4o-2024-08-06）*/
	modelId: string;
	/** Icon identifier for UI display, compatible with @lobehub/icons ModelIcon component 
	 * 界面显示的图标 ID，基于 lobe-chat 的图标规范 */
	icon: string;
}

/**
 * Map user-facing model IDs (without date suffixes) to actual API model IDs and icons.
 * 核心映射表：把“用户眼里的简化名”映射到“服务器认的精确 ID”。
 * 
 * DESIGN EVOLUTION 设计演进:
 * 
 * 最初，我们把所有带日期的版本都暴露给用户。但这导致设置页面非常杂乱，
 * 用户面对 `gpt-4o-2024-11-20`、`gpt-4o-2024-08-06` 往往无从下手。
 * 
 * CURRENT APPROACH 现在的处理方案:
 * 
 * 我们使用“干净”的名称作为 Key（如 'gpt-4o'）：
 * - 这样用户只需关注模型系列，不需要关心具体的发布日期。
 * - 当 OpenAI 发布新版本时，我们只需要在这里更新 `modelId` 指向最新的日期版，而无需修改界面。
 * - 我们也会根据系列分配图标，例如 gpt-4 家族统一用 'gpt-4' 图标。
 */
const MODEL_ID_MAP: Record<string, ModelMapping> = {
	// O1 系列 (推理增强型)
	'o1': { modelId: 'o1-2024-12-17', icon: 'o1' },
	'o1-mini': { modelId: 'o1-mini-2024-09-12', icon: 'o1' },
	// O3 系列
	'o3-mini': { modelId: 'o3-mini-2025-01-31', icon: 'o1' },
	'o3': { modelId: 'o3-2025-04-16', icon: 'o1' },
	// O4 系列
	'o4-mini': { modelId: 'o4-mini-2025-04-16', icon: 'o1' },
	// GPT-5 系列 (预研占位)
	'gpt-5': { modelId: 'gpt-5-2025-08-07', icon: 'gpt-5' },
	'gpt-5-mini': { modelId: 'gpt-5-mini-2025-08-07', icon: 'gpt-5' },
	'gpt-5-nano': { modelId: 'gpt-5-nano-2025-08-07', icon: 'gpt-5' },
	// GPT-4.1 系列
	'gpt-4.1': { modelId: 'gpt-4.1-2025-04-14', icon: 'gpt-4' },
	'gpt-4.1-mini': { modelId: 'gpt-4.1-mini-2025-04-14', icon: 'gpt-4' },
	'gpt-4.1-nano': { modelId: 'gpt-4.1-nano-2025-04-14', icon: 'gpt-4' },
	// GPT-4o 系列 (多模态主力)
	'gpt-4o': { modelId: 'gpt-4o-2024-11-20', icon: 'gpt-4' },
	'gpt-4o-mini': { modelId: 'gpt-4o-mini-2024-07-18', icon: 'gpt-4' },
	// GPT-4 系列
	'gpt-4-turbo': { modelId: 'gpt-4-turbo-2024-04-09', icon: 'gpt-4' },
	'gpt-4': { modelId: 'gpt-4', icon: 'gpt-4' },
	// GPT-4.5 系列
	'gpt-4.5': { modelId: 'gpt-4.5-preview-2025-02-27', icon: 'gpt-4' },
	// GPT-3.5 系列 (经典实惠型)
	'gpt-3.5-turbo': { modelId: 'gpt-3.5-turbo', icon: 'gpt-3.5' },
};

/**
 * Get list of available OpenAI model IDs (user-facing IDs without date suffixes).
 * 获取所有“干净”的可选模型 ID 列表。
 * @returns 数组，例如 ['gpt-4o', 'gpt-4o-mini', ...]
 */
export function getKnownOpenAIModelIds(): readonly string[] {
	return Object.keys(MODEL_ID_MAP);
}


/**
 * Get icon identifier for a model ID by looking up in MODEL_ID_MAP.
 * 根据模型名查找对应的图标。UI 界面通过它来给每条回复打上漂亮的 Logo。
 * 
 * @param modelId - 用户的简化名
 * @returns 图标标识符，如果没找到则原样返回
 */
export function getOpenAIAvatarType(modelId: string): string {
	return MODEL_ID_MAP[modelId]?.icon || modelId;
}

/** OpenAI 服务的初始化选项接口 */
export interface OpenAIChatServiceOptions {
	/** 支持自定义 API 代理地址 */
	baseUrl?: string;
	/** 用户存放的数据 Key */
	apiKey?: string;
	/** 预留给特定厂商的额外参数（如 Azure 的版本号） */
	extra?: Record<string, any>;
}

/**
 * OpenAI 对话服务核心类
 * 实现了 LLMProviderService 接口，供统一调度中心使用。
 */
export class OpenAIChatService implements LLMProviderService {
	// Vercel AI SDK 提供的 OpenAI 驱动客户端
	private readonly client: OpenAIProvider;

	constructor(private readonly options: OpenAIChatServiceOptions) {
		if (!this.options.apiKey) {
			throw new Error('OpenAI API key is required');
		}
		// 使用 AI SDK 创建底层连接客户端
		this.client = createOpenAI({
			apiKey: this.options.apiKey,
			baseURL: this.options.baseUrl ?? OPENAI_DEFAULT_BASE,
		});
	}

	/** 标识当前服务商的 ID */
	getProviderId(): string {
		return 'openai';
	}

	/**
	 * Normalize user-facing model ID to actual API model ID by looking up in MODEL_ID_MAP.
	 * 内部私有方法：将“马甲名”变回“真名”。
	 * 它能处理 AI SDK 5 所需的版本映射。
	 *
	 * @param modelId - 简化名（例如 'gpt-5-mini'）
	 * @returns 官网要求的 ID（例如 'gpt-5-mini-2025-08-07'）
	 */
	private normalizeModelId(modelId: string): string {
		return MODEL_ID_MAP[modelId]?.modelId || modelId;
	}

	/** 获取具体的底层模型操作对象 */
	modelClient(model: string): LanguageModel {
		return this.client(this.normalizeModelId(model)) as unknown as LanguageModel;
	}

	/** 阻塞式对话：等答案写完了，一次性拿回来 */
	async blockChat(request: LLMRequest<any>): Promise<LLMResponse> {
		return blockChat(this.modelClient(request.model), request);
	}

	/** 流式对话：字是一个个蹦出来的，实时传回前端 */
	streamChat(request: LLMRequest<any>): AsyncGenerator<LLMStreamEvent> {
		return streamChat(this.modelClient(request.model), request);
	}

	/** 获取所有支持的模型元数据，用于设置页面的勾选列表和下拉框显示 */
	async getAvailableModels(): Promise<ModelMetaData[]> {
		return getKnownOpenAIModelIds().map((modelId) => {
			const mapping = MODEL_ID_MAP[modelId];
			return {
				id: modelId,
				displayName: modelId,
				icon: mapping?.icon || modelId,
			};
		});
	}

	/** 获取本提供商的基本信息 */
	getProviderMetadata(): ProviderMetaData {
		return {
			id: 'openai',
			name: 'OpenAI',
			defaultBaseUrl: OPENAI_DEFAULT_BASE,
			icon: 'openai',
		};
	}

	/**
	 * 生成向量（Embedding）
	 * RAG（检索增强生成）功能的引擎：负责把文字变成数字列表。
	 */
	async generateEmbeddings(texts: string[], model: string): Promise<number[][]> {
		const result = await embedMany({
			model: this.client.textEmbeddingModel(model) as unknown as EmbeddingModel,
			values: texts,
		});

		return result.embeddings;
	}
}
