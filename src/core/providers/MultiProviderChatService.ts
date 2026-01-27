/**
 * @file MultiProviderChatService.ts
 * @description 多提供商聊天服务核心管理类。
 * 
 * 本文件实现了 `MultiProviderChatService`，它是插件 AI 能力的“调度中心”。
 * 它的核心逻辑是：持有多个具体的 `LLMProviderService` 实例（如 OpenAI、Claude 等），
 * 并根据请求中指定的 `provider` 字段，将请求分发给对应的服务。
 * 
 * 主要职责：
 * 1. 【生命周期管理】管理所有已配置 AI 提供商服务的实例化与缓存。
 * 2. 【请求分发】作为统一入口，处理 `blockChat` (阻塞式) 和 `streamChat` (流式) 请求的路由。
 * 3. 【配置合并】自动将用户全局定义的输出控制参数（如 Temperature, Max Tokens）合并进每次请求。
 * 4. 【模型聚合】汇总所有启用的提供商所支持的模型列表，供 UI 下拉框展示。
 * 
 * 举例：
 * 当用户在聊天界面选择 "Claude" 并发送消息时，`MultiProviderChatService` 会从 `providerServiceMap` 
 * 找到 Claude 的服务实例，并将请求透传过去。
 */

import { LLMProviderService, ProviderConfig, ModelMetaData, ProviderMetaData, LLMStreamEvent, LLMOutputControlSettings } from './types';
import { LLMRequest } from './types';
import { ProviderServiceFactory } from './base/factory';
import { BusinessError, ErrorCode } from '@/core/errors';
import { getLLMOutputControlSettingKeys } from './types';
import { LanguageModel } from 'ai';

/**
 * 多提供商服务初始化选项
 */
export interface MultiProviderChatServiceOptions {
	/** 所有提供商的配置映射表 */
	providerConfigs?: Record<string, ProviderConfig>;
	/** 全局默认的输出控制设置（如：统一设置采样温度） */
	defaultOutputControl?: LLMOutputControlSettings;
}

const DEFAULT_TIMEOUT_MS = 60000;

/**
 * 多提供商聊天服务类
 * 采用单例模式，统一管理和调度多个 LLM 提供商的请求。
 */
export class MultiProviderChatService implements LLMProviderService {
	private static instance: MultiProviderChatService | undefined;

	/**
	 * 获取全局单例。若未初始化则抛出配置缺失异常。
	 */
	public static getInstance(): MultiProviderChatService {
		if (!MultiProviderChatService.instance) {
			throw new BusinessError(
				ErrorCode.CONFIGURATION_MISSING,
				'MultiProviderChatService is not initialized'
			);
		}
		return MultiProviderChatService.instance;
	}

	/**
	 * 已实例化的提供商服务缓存映射表
	 * key: 提供商 ID (如 'openai'), value: 对应的服务实例
	 */
	private providerServiceMap = new Map<string, LLMProviderService>();
	
	/**
	 * 原始配置数据缓存
	 */
	private configs: Record<string, ProviderConfig>;

	/**
	 * 全局兜底的输出控制设置
	 */
	private defaultOutputControl?: LLMOutputControlSettings;

	constructor(options: MultiProviderChatServiceOptions = {}) {
		this.configs = options.providerConfigs ?? {};
		this.defaultOutputControl = options.defaultOutputControl;

		// 利用工厂模式，根据配置初始化所有已启用的服务
		this.providerServiceMap = ProviderServiceFactory.getInstance().createAll(this.configs);
		MultiProviderChatService.instance = this;
	}

	/**
	 * 【核心工具方法】合并请求参数
	 * 将单次请求的特殊设置与全局默认设置进行合并。
	 * 优先级：请求级别设置 > 全局默认设置。
	 */
	private mergeOutputControl(request: LLMRequest): LLMRequest {
		let mergedOutputControl = request.outputControl ? { ...request.outputControl } : {};

		// 只有当请求中未明确定义的参数，才会使用全局默认值
		if (this.defaultOutputControl) {
			const settingKeys = getLLMOutputControlSettingKeys();
			settingKeys.forEach(key => {
				if (mergedOutputControl[key] === undefined && this.defaultOutputControl![key] !== undefined) {
					(mergedOutputControl as any)[key] = this.defaultOutputControl![key];
				}
			});
		}

		return {
			...request,
			outputControl: mergedOutputControl
		};
	}

	/**
	 * 执行单次非流式对话。
	 * 逻辑：合并配置 -> 获取目标 Provider -> 转发请求。
	 */
	async blockChat(request: LLMRequest) {
		console.debug('[MultiProviderChatService] Blocking chat:', request);
		const mergedRequest = this.mergeOutputControl(request);
		return this.getProviderService(request.provider).blockChat(mergedRequest);
	}

	/**
	 * 执行流式异步对话。
	 * 返回一个异步生成器，用于前端实时展示逐字生成的文本。
	 */
	streamChat(request: LLMRequest): AsyncGenerator<LLMStreamEvent> {
		console.debug('[MultiProviderChatService] Streaming chat:', request);
		const mergedRequest = this.mergeOutputControl(request);
		return this.getProviderService(request.provider).streamChat(mergedRequest);
	}

	/**
	 * 获取当前包装层 ID
	 * 因为它是一个容器，所以返回 'MultiProvider'
	 */
	getProviderId(): string {
		return 'MultiProvider';
	}

	/**
	 * 获取所有可用模型列表。
	 * 内部会调用 `getAllAvailableModels` 汇总所有子提供商的模型。
	 */
	async getAvailableModels(): Promise<ModelMetaData[]> {
		const allModels = await this.getAllAvailableModels();
		return allModels;
	}

	/**
	 * 获取容器本身的元数据。
	 */
	getProviderMetadata(): ProviderMetaData {
		return {
			id: 'MultiProvider',
			name: 'Multi Provider',
			defaultBaseUrl: '',
		};
	}

	/**
	 * 统一向量生成接口。
	 * RAG（检索增强生成）功能的依赖项。
	 * @param texts 待向量化的文本数组
	 * @param model 使用的模型 ID
	 * @param provider 目标提供商
	 */
	async generateEmbeddings(texts: string[], model: string, provider?: string): Promise<number[][]> {
		const targetProvider = provider;
		if (!targetProvider) {
			throw new Error('No provider available for embedding generation');
		}

		const service = this.getProviderService(targetProvider);
		return service.generateEmbeddings(texts, model);
	}

	/**
	 * 【核心路由逻辑】根据 ID 获取对应的 Service 实例。
	 * 如果缓存中没有，则尝试根据配置动态创建一个。
	 */
	public getProviderService(provider: string): LLMProviderService {
		const service = this.providerServiceMap.get(provider);
		if (service) {
			return service;
		}

		// 延迟创建模式
		const config = this.getConfigForProvider(provider);
		if (!config) {
			throw new BusinessError(
				ErrorCode.CONFIGURATION_MISSING,
				`Configuration for provider ${provider} is missing`
			);
		}
		const newService = this.createProviderService(provider, config);
		if (!newService) {
			throw new BusinessError(
				ErrorCode.MODEL_UNAVAILABLE,
				`Failed to create service for provider ${provider}`
			);
		}
		this.providerServiceMap.set(provider, newService);
		return newService;
	}

	/**
	 * 多提供商层不支持直接返回单一 modelClient
	 */
	modelClient(model: string): LanguageModel {
		throw new Error('unsupported operation: modelClient');
	}

	/**
	 * 获取特定提供商的配置。
	 */
	private getConfigForProvider(provider: string): ProviderConfig | undefined {
		return this.configs[provider] || undefined;
	}

	/**
	 * 调用工厂实例化具体服务。
	 */
	private createProviderService(provider: string, config: ProviderConfig): LLMProviderService | null {
		return ProviderServiceFactory.getInstance().create(provider, config);
	}

	/**
	 * 汇总获取所有已启用提供商的模型列表。
	 * 该列表包含了 provider 信息，方便 UI 区分同一模型在不同厂商的表现。
	 */
	async getAllAvailableModels(): Promise<Array<ModelMetaData & { provider: string }>> {
		const allModels: Array<ModelMetaData & { provider: string }> = [];

		// 遍历所有已初始化的服务，并调用它们的 getAvailableModels 方法
		for (const [provider, service] of this.providerServiceMap.entries()) {
			try {
				if (service.getAvailableModels) {
					const models = await service.getAvailableModels();
					models.forEach((model) => {
						allModels.push({
							...model,
							provider,
						});
					});
				}
			} catch (error) {
				console.warn(`Failed to get models from provider ${provider}:`, error);
			}
		}

		return allModels;
	}


	/**
	 * Refresh provider services with new configurations.
	 * Clears existing services and recreates them with updated configs.
	 * 
	 * @param newConfigs - New provider configurations to use
	 */
	refresh(newConfigs: Record<string, ProviderConfig>, newOutputControl: LLMOutputControlSettings): void {
		// Clear existing services
		this.providerServiceMap.clear();
		
		// Update configs
		this.configs = newConfigs;

		this.defaultOutputControl = newOutputControl;
		
		// Recreate services with new configs
		this.providerServiceMap = ProviderServiceFactory.getInstance().createAll(this.configs);
	}
}
