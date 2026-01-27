/**
 * @file llm.ts
 * @description 基于大模型（LLM）的重排序（Rerank）实现。
 * 
 * 本文件实现了一种非常“奢侈”但极具灵活性的重排序方案：直接通过一段精心设计的 Prompt，
 * 询问现有的聊天模型（如 GPT-4, Claude 3.5）哪些文档更符合用户的查询需求。
 * 
 * 这种模式通常被称为 RankGPT。
 * 
 * 为什么用 LLM 做重排序？
 * 1. 【现成】：用户不需要再额外购买 Cohere/Jina 的服务，只要能对话就能重排。
 * 2. 【高智商】：对于极其复杂的语义逻辑，大模型的理解能力往往超过专门的 Reranker 模型。
 * 
 * 举例逻辑：
 * 插件会将搜索词和前 10 个文档发给 GPT：“请告诉我这 10 个文档哪个最能回答‘如何养猫’，请按顺序排列索引，如 [2, 0, 5, ...]”。
 * 然后本文件负责解析这个回复并输出得分。
 */

import type { RerankProvider, RerankRequest, RerankResponse, RerankResult } from './types';
import type { AIServiceManager } from '@/service/chat/service-manager';
import { PromptId } from '@/service/prompt/PromptId';

/** 初始化配置 */
interface LLMRerankOptions {
	/** 要调用的模型 ID（如 'gpt-4o'） */
	modelId: string;
	/** 要调用的供应商（如 'openai'） */
	provider: string;
	/** 对话管理服务，用于发起实际的 AI 请求 */
	aiServiceManager: AIServiceManager;
}

/**
 * LLM-based rerank provider (RankGPT/RankLLM style).
 * 具体实现类：将重排序任务转化为一次特殊的对话请求。
 */
export class LLMRerankProvider implements RerankProvider {
	private readonly modelId: string;
	private readonly provider: string;
	private readonly aiServiceManager: AIServiceManager;

	constructor(options: LLMRerankOptions) {
		this.modelId = options.modelId;
		this.provider = options.provider;
		this.aiServiceManager = options.aiServiceManager;
	}

	getType(): string {
		return 'llm';
	}

	/**
	 * 执行重排序。
	 */
	async rerank(request: RerankRequest): Promise<RerankResponse> {
		// 1. 整理文档数组：附加上索引号，方便 AI 在回复中通过索引指代文档
		const documentsArray = request.documents.map((doc, idx) => ({
			index: idx,
			text: doc.text,
			boostInfo: doc.metadata?.boostInfo,
		}));

		// 2. 调用对话服务：使用专门的“排序 Prompt”
		// 引导 AI 对文档质量进行打分或排序
		const content = await this.aiServiceManager.chatWithPrompt(
			PromptId.SearchRerankRankGpt, // 引用的 Prompt 模板 ID
			{
				query: request.query,
				documents: documentsArray,
			},
			this.provider,
			this.modelId
		);

		// 3. 解析结果：从 AI 的“长篇大论”中提取出类似 [1, 3, 0] 的排序信息
		const results = this.parseLLMResponse(content, request.documents.length);

		// 4. 最终排序：按分数降序排列
		results.sort((a, b) => b.score - a.score);

		// 5. 应用 TopK 截断
		const finalResults = request.topK ? results.slice(0, request.topK) : results;

		return { results: finalResults };
	}

	/**
	 * Parse LLM response to extract document rankings.
	 * 私有工具方法：解析 AI 的回包。
	 * 期望格式示例： "[1, 0, 2]" 或 "The best order is 1, 0, 2"
	 */
	private parseLLMResponse(response: string, docCount: number): RerankResult[] {
		// 使用正则尝试抓取中括号包裹的数字列表
		const match = response.match(/\[?\s*(\d+(?:\s*,\s*\d+)*)\s*\]?/);
		
		if (!match) {
			// 如果 AI 胡言乱语，解析失败：降级处理，返回原始顺序且给个中间分
			return Array.from({ length: docCount }, (_, i) => ({
				index: i,
				score: 1.0,
			}));
		}

		// 将抓取到的字符串（如 "1, 2, 0"）拆解为数字数组
		const indices = match[1]
			.split(',')
			.map((s) => parseInt(s.trim(), 10))
			.filter((idx) => idx >= 0 && idx < docCount);

		// 将排名（Rank）转换为分数（Score）：
		// 排名第一的赋予最高分（文档总数），以此递减
		const results: RerankResult[] = indices.map((index, rank) => ({
			index,
			score: docCount - rank, // 越靠前，分越高
		}));

		// 容错处理：如果有些索引 AI 漏写了，给它们分配一个极低的分数（0.1）作为垫底
		const foundIndices = new Set(indices);
		for (let i = 0; i < docCount; i++) {
			if (!foundIndices.has(i)) {
				results.push({ index: i, score: 0.1 });
			}
		}

		return results;
	}
}

