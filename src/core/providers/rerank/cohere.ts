/**
 * @file cohere.ts
 * @description Cohere 重排序（Rerank）服务对接实现。
 * 
 * 本文件是插件与 Cohere 官方重排 API 沟通的“桥梁”。
 * 
 * 为什么选 Cohere？
 * Cohere 是目前公认的最强大的重排序服务商之一，特别是它的 `rerank-multilingual-v3.0` 模型，
 * 能够完美理解中文语义，帮助插件在知识库检索时从一堆杂乱的文档中挑出最相关的部分。
 * 
 * 举例：
 * 用户输入：“Obsidian 如何安装插件？”
 * 插件找回 10 个文档，包含“Obsidian 介绍”、“安装插件步骤”、“插件解压位置”等。
 * Cohere 会接收这些文档，给出类似 [index: 1, score: 0.99] 的精确打分，
 * 告诉插件第二个文档（索引为 1）才是真正的核心答案。
 */

import type { RerankProvider, RerankRequest, RerankResponse } from './types';

/** 初始化服务的参数 */
interface CohereRerankOptions {
	/** Cohere 官方控制台申请的 API Key */
	apiKey: string;
	/** 基础地址，默认是官方 API 地址 */
	baseUrl?: string;
	/** 选择的模型 ID，默认为多语言 V3 */
	modelId?: string;
}

/** 对应 Cohere API 官方要求的 POST 请求体格式 */
interface CohereRerankAPIRequest {
	/** 模型名称 */
	model: string;
	/** 用户的搜索词 */
	query: string;
	/** 待打分的纯文本数组 */
	documents: string[];
	/** 只返回最相关的几个（可选） */
	top_n?: number;
}

/** 对应 Cohere API 返回的响应格式 */
interface CohereRerankAPIResponse {
	results: Array<{
		/** 原始数组中的老位置 */
		index: number;
		/** 计算出的相关性打分 */
		relevance_score: number;
	}>;
}

/**
 * Cohere Rerank API provider.
 * 具体实现类：负责打包、发送 HTTP 请求并处理结果。
 */
export class CohereRerankProvider implements RerankProvider {
	private readonly apiKey: string;
	private readonly baseUrl: string;
	private readonly modelId: string;

	constructor(options: CohereRerankOptions) {
		this.apiKey = options.apiKey;
		// 如果用户没填代理地址，就用官方地址
		this.baseUrl = options.baseUrl || 'https://api.cohere.ai/v1';
		// 默认推荐使用多语言版，支持中文效果好
		this.modelId = options.modelId || 'rerank-multilingual-v3.0';
	}

	/** 返回提供商类型标识 */
	getType(): string {
		return 'cohere';
	}

	/**
	 * 核心方法：执行重排序。
	 */
	async rerank(request: RerankRequest): Promise<RerankResponse> {
		// 1. 数据准备：将对象数组转换成 Cohere 接口认的纯文本字符串数组
		const documents = request.documents.map((d) => d.text);

		// 2. 构造请求包
		const apiRequest: CohereRerankAPIRequest = {
			model: this.modelId,
			query: request.query,
			documents,
			top_n: request.topK,
		};

		// 3. 发送网络请求
		const response = await fetch(`${this.baseUrl}/rerank`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.apiKey}`, // 携带身份令牌
			},
			body: JSON.stringify(apiRequest),
		});

		// 4. 异常处理
		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Cohere rerank API error: ${response.status} ${errorText}`);
		}

		// 5. 解析并归一化输出
		const data: CohereRerankAPIResponse = await response.json();

		return {
			// 将 Cohere 的 relevance_score 转换成本插件统一的 score 字段
			results: data.results.map((r) => ({
				index: r.index,
				score: r.relevance_score,
			})),
		};
	}
}

