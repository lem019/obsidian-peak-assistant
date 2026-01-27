/**
 * @file factory.ts
 * @description LLM 提供商服务工厂管理类。
 * 
 * 本文件是提供商实例化逻辑的集中地，采用了【工厂模式】和【单例模式】。
 * 它的核心价值在于：将具体的服务类（如 OpenAIChatService）与业务调用方（如 MultiProviderChatService）解耦。
 * 
 * 为什么需要工厂？
 * 1. 【动态创建】插件不需要在启动时一次性加载所有 Provider。它可以根据用户的 `data.json` 配置，仅实例化用户已启用的厂商。
 * 2. 【统一控制】所有 Provider 的创建逻辑（如检查 API Key 必填项、设置默认超时）都可以在 `registerDefaultProviders` 中统一维护。
 * 3. 【扩展性】后续新增 DeepSeek 或百川等厂商时，只需在工厂中注册一行代码即可。
 * 
 * 主要职责：
 * 1. 注册并持有各个 AI 提供商的构造工厂（ProviderFactory）。
 * 2. `create`: 根据提供商 ID 和用户配置，返回一个实现了 `LLMProviderService` 接口的实例。
 * 3. `createAll`: 批量扫描配置，完成所有已选提供商的初始化。
 */

import { LLMProviderService, ModelMetaData, ProviderConfig, ProviderMetaData } from '../types';
import { OpenAIChatService } from './openai';
import { OpenRouterChatService } from './openrouter';
import { OllamaChatService } from './ollama';
import { ClaudeChatService } from './claude';
import { GeminiChatService } from './gemini';
import { PerplexityChatService } from './perplexity';
import { BusinessError, ErrorCode } from '@/core/errors';

/** 默认的 API 请求超时时间（60秒） */
const DEFAULT_TIMEOUT_MS = 60000;

/**
 * 提供商工厂函数类型定义。
 * 接收用户配置(ProviderConfig)，返回具体服务实例或 null（配置无效时）。
 */
type ProviderFactory = (config: ProviderConfig) => LLMProviderService | null;

/**
 * 【开发小贴士】
 * 为了在用户没填 API Key 时也能在设置页面看到厂商的图标和说明，
 * 我们在调用 getProviderMetadata() 时会传入一个临时的假配置。
 */
const tempConfig: ProviderConfig = {
	apiKey: 'fake-api-key-for-metadata-only',
	baseUrl: 'http://localhost:11434',
};

/**
 * 提供商服务工厂注册表（单例）
 * 管理所有已知的 AI 提供商及其构建逻辑。
 */
export class ProviderServiceFactory {
	private static instance: ProviderServiceFactory | null = null;
	
	/** 内部注册表：Provider ID -> Factory Function */
	private readonly factories = new Map<string, ProviderFactory>();
	private readonly defaultTimeout: number;

	private constructor(defaultTimeout: number = DEFAULT_TIMEOUT_MS) {
		this.defaultTimeout = defaultTimeout;
		// 初始化时自动注册内置的所有提供商
		this.registerDefaultProviders();
	}

	/**
	 * 核心注册逻辑。
	 * 在此定义每个提供商如何从 `ProviderConfig` 转换为具体的 Service 类。
	 */
	private registerDefaultProviders(): void {
		// OpenAI 注册逻辑
		this.register('openai', (config) => {
			if (!config.apiKey) {
				console.log('create service null apiKey', 'openai', config);
				return null;
			}
			return new OpenAIChatService({
				baseUrl: config.baseUrl,
				apiKey: config.apiKey,
				extra: config.extra,
			});
		});

		// OpenRouter 注册逻辑
		this.register('openrouter', (config) => {
			if (!config.apiKey) {
				console.log('create service null apiKey', 'openrouter', config);
				return null;
			}
			return new OpenRouterChatService({
				baseUrl: config.baseUrl,
				apiKey: config.apiKey,
				extra: config.extra,
			});
		});

		// Claude 注册逻辑
		this.register('claude', (config) => {
			if (!config.apiKey) {
				console.log('create service null apiKey', 'claude', config);
				return null;
			}
			return new ClaudeChatService({
				baseUrl: config.baseUrl,
				apiKey: config.apiKey,
				extra: config.extra,
			});
		});

		// Google Gemini 注册逻辑
		this.register('gemini', (config) => {
			if (!config.apiKey) {
				console.log('create service null apiKey', 'gemini', config);
				return null;
			}
			return new GeminiChatService({
				baseUrl: config.baseUrl,
				apiKey: config.apiKey,
				extra: config.extra,
			});
		});

		// 本地 Ollama 注册逻辑（API Key 可选）
		this.register('ollama', (config) => {
			return new OllamaChatService({
				baseUrl: config.baseUrl,
				apiKey: config.apiKey,
				extra: config.extra,
			});
		});

		// Perplexity 搜索模型注册逻辑
		this.register('perplexity', (config) => {
			if (!config.apiKey) {
				console.log('create service null apiKey', 'perplexity', config);
				return null;
			}
			return new PerplexityChatService({
				baseUrl: config.baseUrl,
				apiKey: config.apiKey,
				extra: config.extra,
			});
		});

		// 预留区域：如果需要支持与 OpenAI API 格式兼容的任意第三方 API
		// this.register('other', (config) => ...);
	}

	/**
	 * 向工厂添加一个新的提供商构建逻辑。
	 */
	private register(providerId: string, factory: ProviderFactory): void {
		this.factories.set(providerId, factory);
	}

	/**
	 * 获取工厂单例。
	 */
	static getInstance(): ProviderServiceFactory {
		if (!ProviderServiceFactory.instance) {
			ProviderServiceFactory.instance = new ProviderServiceFactory();
		}
		return ProviderServiceFactory.instance;
	}

	/**
	 * 【核心方法】创建具体服务实例。
	 * @param providerId 提供商唯一标识
	 * @param config 包含 API Key 和 URL 的用户配置
	 */
	create(providerId: string, config: ProviderConfig): LLMProviderService | null {
		if (!config) {
			return null;
		}
		const factory = this.factories.get(providerId);
		if (!factory) {
			return null;
		}
		const service = factory(config);
		return service;
	}

	/**
	 * 根据完整配置表，批量创建并初始化所有已启用的服务。
	 * 常用于插件启动或设置保存后的重新加载。
	 */
	createAll(configs: Record<string, ProviderConfig>): Map<string, LLMProviderService> {
		const services = new Map<string, LLMProviderService>();

		for (const [providerId, config] of Object.entries(configs)) {
			// 如果配置了 enabled 为 false，或者 API Key 校验不通过，则跳过创建
			const service = this.create(providerId, config);
			if (service) {
				services.set(providerId, service);
			}
		}

		return services;
	}

	/**
	 * 获取所有已知提供商的元数据（图标、名称等）。
	 * 用于在设置面板展示服务商列表。
	 */
	getAllProviderMetadata(): ProviderMetaData[] {
		const metadata: ProviderMetaData[] = [];

		for (const providerId of this.factories.keys()) {
			try {
				const factory = this.factories.get(providerId);
				if (factory) {
					// 使用 tempConfig 创建静默实例
					const tempService = factory(tempConfig);
					if (tempService) {
						metadata.push(tempService.getProviderMetadata());
					}
				}
			} catch (error) {
				console.error(`[ProviderServiceFactory] Error getting metadata for provider ${providerId}:`, error);
			}
		}

		return metadata;
	}

	/**
	 * 获取特定提供商支持的模型列表。
	 * @param providerId 提供商 ID
	 * @param config 可选的正式配置。若不传则使用假 Key 的临时配置。
	 * @returns Promise 包装的模型元数据数组
	 */
	async getProviderSupportModels(providerId: string, config?: ProviderConfig): Promise<ModelMetaData[]> {
		const factory = this.factories.get(providerId);
		if (!factory) {
			throw new BusinessError(ErrorCode.PROVIDER_NOT_FOUND, `Provider ${providerId} not found`);
		}

		// 构造模型查询专用配置：若用户已填 Key 则用用户的，否则用兜底假配置。
		const serviceConfig = (config && config.apiKey) ? config : {
			...tempConfig,
			// 特殊处理：Ollama 哪怕没 Key 也需要正确的 BaseUrl 才能获取模型列表
			baseUrl: config?.baseUrl,
		};

		try {
			const service = factory(serviceConfig);
			if (service) {
				return await service.getAvailableModels();
			}
		} catch (error) {
			console.warn(`[ProviderServiceFactory] Failed to get models for ${providerId}:`, error);
			throw error;
		}

		throw new BusinessError(ErrorCode.MODEL_UNAVAILABLE, `Failed to create service for provider ${providerId}`);
	}
}



