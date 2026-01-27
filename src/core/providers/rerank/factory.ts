/**
 * @file factory.ts
 * @description 重排序（Rerank）服务工厂管理类。
 * 
 * 本文件是重排序服务的“总调度站”。它采用了【工厂模式】和【单例模式】。
 * 核心作用：根据用户的设置（选了 Cohere 还是 Jina），变出具体的服务实例供 RAG 检索流程使用。
 * 
 * 为什么需要它？
 * 检索增强生成（RAG）对 Reranker 的选择很灵活。用户可能想用云端精准的 Cohere API，
 * 也可能想用本地部署、保护隐私的 FlashRank。
 * 工厂类封装了所有的“创建细节”（比如检查 Key 是否漏填、注入 BaseUrl 等），
 * 让调用方只需要说一句：“给我建一个 Cohere 的 Reranker”，就能拿到可用的工具。
 * 
 * 联动逻辑：
 * - 它是 `Reranker.ts`（检索核心逻辑）的上游。
 * - 它内部聚合了 `cohere.ts`, `jina.ts`, `flashrank.ts` 和 `llm.ts` 这几种具体的工厂方法。
 * 
 * 举例：
 * 插件启动或用户修改设置时，`createFromRerankModel` 被调用。它会查看用户配置，
 * 如果发现选的是 "Jina"，就去实例化 `JinaRerankProvider`。
 */

import type { RerankProvider, RerankProviderConfig } from './types';
import { CohereRerankProvider } from './cohere';
import { JinaRerankProvider } from './jina';
import { LLMRerankProvider } from './llm';
import { FlashRankProvider } from './flashrank';

// 重排序提供商工厂函数类型：接收配置，返回实例（或者如果配置无效返回 null）
type RerankProviderFactoryFn = (config: RerankProviderConfig) => RerankProvider | null;

/**
 * Manager for creating and managing rerank providers.
 * 
 * 重排序提供商管理器。
 * 创建和管理重排序提供商实例。
 */
export class RerankProviderManager {
	// 单例模式：全局只有一个经理
	private static instance: RerankProviderManager | null = null;
	// 存储“生产线”：每种类型（如 'cohere'）对应一个制造方法
	private readonly factories = new Map<string, RerankProviderFactoryFn>();

	private constructor() {
		// 初始化时，把默认支持的“生产线”都架设起来
		this.registerDefaultProviders();
	}

	/**
	 * Register default providers.
	 * 注册默认支持的各类提供商生产逻辑。
	 */
	private registerDefaultProviders(): void {
		// 注册 Cohere 生产线
		this.register('cohere', (config) => {
			if (!config.apiKey) {
				return null; // 没给钱（Key），造不出来
			}
			return new CohereRerankProvider({
				apiKey: config.apiKey,
				baseUrl: config.baseUrl,
				modelId: config.modelId,
			});
		});

		// 注册 Jina 生产线
		this.register('jina', (config) => {
			if (!config.apiKey) {
				return null;
			}
			return new JinaRerankProvider({
				apiKey: config.apiKey,
				baseUrl: config.baseUrl,
				modelId: config.modelId,
			});
		});

		// 注册 LLM 自建重排生产线
		// 它利用现有的 GPT-4 等对话模型通过 Prompt 来重排序
		this.register('llm', (config) => {
			if (!config.extra?.provider || !config.modelId || !config.extra?.aiServiceManager) {
				return null;
			}
			return new LLMRerankProvider({
				modelId: config.modelId,
				provider: config.extra.provider,
				aiServiceManager: config.extra.aiServiceManager,
			});
		});

		// 注册 FlashRank（本地轻量化）生产线
		this.register('flashrank', (config) => {
			return new FlashRankProvider({
				modelId: config.modelId,
			});
		});
	}

	/**
	 * Register a provider factory.
	 * 扩展接口：允许动态添加新的重排类型。
	 */
	private register(type: string, factory: RerankProviderFactoryFn): void {
		this.factories.set(type, factory);
	}

	/**
	 * Get singleton instance.
	 * 获取全局唯一的经理实例。
	 */
	static getInstance(): RerankProviderManager {
		if (!RerankProviderManager.instance) {
			RerankProviderManager.instance = new RerankProviderManager();
		}
		return RerankProviderManager.instance;
	}

	/**
	 * Create a rerank provider instance.
	 * 根据具体的配置对象生产一个服务。
	 */
	create(config: RerankProviderConfig): RerankProvider | null {
		if (!config) {
			return null;
		}
		const factory = this.factories.get(config.type);
		if (!factory) {
			console.warn(`[RerankProviderManager] Unknown provider type: ${config.type}`);
			return null;
		}
		return factory(config);
	}

	/**
	 * Create rerank provider from rerank model config.
	 * 智能工厂方法：自动识别用户选的是专用重排器（如 Cohere）还是通用大模型（如 OpenAI）。
	 * 
	 * @param rerankModel - 用户的重排模型设置 (包含 provider 和 modelId)
	 * @param providerConfig - 相应的 API 配置（包含 apiKey, baseUrl 等）
	 * @param aiServiceManager - 用于 LLM 重排的对话服务管理器
	 * @returns 重排序服务实例或 null
	 */
	createFromRerankModel(
		rerankModel: { provider: string; modelId: string },
		providerConfig?: { apiKey?: string; baseUrl?: string; extra?: Record<string, any> },
		aiServiceManager?: any,
	): RerankProvider | null {
		// 哪些是专业的重排器厂商
		const knownRerankProviders = ['cohere', 'jina', 'flashrank'];
		// 逻辑：如果选的 provider 不在专业名单里，那说明用户是想用通用的对话模型（如 gpt-4）来重排
		const isLLMProvider = !knownRerankProviders.includes(rerankModel.provider);

		if (isLLMProvider) {
			// 如果是 LLM 提供商：构造一个类型为 'llm' 的配置
			return this.create({
				type: 'llm',
				modelId: rerankModel.modelId,
				extra: {
					provider: rerankModel.provider, // 比如 'openai'
					aiServiceManager,
				},
			});
		}

		// 处理 FlashRank：它在本地运行，通常不需要额外的 API 配置
		if (rerankModel.provider === 'flashrank') {
			return this.create({
				type: rerankModel.provider,
				modelId: rerankModel.modelId,
			});
		}

		// Cohere 和 Jina 这种联网的服务，必须提供 API Key
		if (!providerConfig) {
			return null;
		}

		return this.create({
			type: rerankModel.provider,
			modelId: rerankModel.modelId,
			apiKey: providerConfig.apiKey,
			baseUrl: providerConfig.baseUrl,
			extra: providerConfig.extra,
		});
	}
}

