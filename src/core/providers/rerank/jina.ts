/**
 * @file jina.ts
 * @description Jina 重排序（Rerank）服务对接实现。
 * 
 * 本文件实现了与 Jina API 的通信逻辑。
 * 
 * 为什么选 Jina？
 * Jina 的 Reranker 特别是在处理中长文本和多语言环境时非常给力。它提供了具有竞争力的性能，
 * 是插件 RAG（检索增强生成）流程中提升搜索相关性的核心选择之一。
 * 
 * 逻辑流程：
 * 插件先把所有搜索到的候选结果塞给 Jina，Jina 通过其深度学习模型重新评估每个结果与查询语句的相关度，
 * 最终返回一个更加合理的排序列表。
 */

import type { RerankProvider, RerankRequest, RerankResponse } from './types';

/** 初始化配置 */
interface JinaRerankOptions {
	/** Jina AI 申请的 API Key */
	apiKey: string;
	/** API 地址（支持代理配置） */
	baseUrl?: string;
	/** 模型 ID，默认为多语言 v2 模型 */
	modelId?: string;
}

/** 对应 Jina 官方规范的请求体 */
interface JinaRerankAPIRequest {
	model: string;
	query: string;
	documents: string[];
	top_n?: number;
}

/** 对应 Jina 官方规范的响应体 */
interface JinaRerankAPIResponse {
	results: Array<{
		index: number;
		relevance_score: number;
	}>;
}

/**
 * Jina Rerank API provider.
 * 实现类：对接 Jina 官方重排序服务。
 */
export class JinaRerankProvider implements RerankProvider {
	private readonly apiKey: string;
	private readonly baseUrl: string;
	private readonly modelId: string;

	constructor(options: JinaRerankOptions) {
		this.apiKey = options.apiKey;
		// 默认地址：https://api.jina.ai/v1
		this.baseUrl = options.baseUrl || 'https://api.jina.ai/v1';
		// 默认模型：功能强大的通用多语言模型
		this.modelId = options.modelId || 'jina-reranker-v2-base-multilingual';
	}

	getType(): string {
		return 'jina';
	}

	/**
	 * 接单：执行打分任务。
	 */
	async rerank(request: RerankRequest): Promise<RerankResponse> {
		// 1. 抽取输入文档中的文本内容
		const documents = request.documents.map((d) => d.text);

		// 2. 准备发往 Jina 的 JSON 包
		const apiRequest: JinaRerankAPIRequest = {
			model: this.modelId,
			query: request.query,
			documents,
			top_n: request.topK,
		};

		// 3. 执行网络请求（Fetch API）
		const response = await fetch(`${this.baseUrl}/rerank`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify(apiRequest),
		});

		// 4. 网络层报错处理
		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Jina rerank API error: ${response.status} ${errorText}`);
		}

		// 5. 将 Jina 的原始数据转换回插件通用格式
		const data: JinaRerankAPIResponse = await response.json();

		return {
			results: data.results.map((r) => ({
				index: r.index,
				score: r.relevance_score,
			})),
		};
	}
}

