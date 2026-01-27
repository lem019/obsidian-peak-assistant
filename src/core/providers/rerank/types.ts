/**
 * @file types.ts
 * @description 重排序（Rerank）服务的基础类型与接口定义。
 * 
 * 在 RAG（检索增强生成）流程中，重排序是提升搜索精度的关键步骤。
 * 当用户发起搜索时，系统首先通过向量搜索（Vector Search）从成千上万个文档中找回几十个“可能相关”的片段。
 * 
 * 痛点：向量搜索虽然快，但它有时会因为词汇相近而找回无关内容。
 * 作用：重排序器（Reranker）就像一个“精选官”。它对这几十个片段进行深度的语义打分，选出最精准的 Top K 给到 AI。
 * 
 * 举例：
 * 1. 用户输入：“如何给猫洗澡？”
 * 2. 向量搜索找回 20 个文档，包括“给猫洗澡的步骤”和“猫每天梳毛的习惯”。
 * 3. 重排序器分析后，将“给猫洗澡的步骤”打高分（0.98），将“梳毛”打低分（0.25）。
 * 4. 插件最终将最高分的几个片段发给 LLM 生成回答。
 */

/**
 * 重排序提供商配置。
 * 
 * 根据提供商类型的不同，字段要求如下：
 * - 'cohere' / 'jina': 需要 apiKey, modelId。
 * - 'llm': 基于大模型的重排。需要 modelId, extra.provider (底层 LLM 供应商), extra.aiServiceManager。
 * - 'flashrank': 本地轻量级重排。modelId 可选。
 */
export interface RerankProviderConfig {
	/**
	 * 提供商类型标识。
	 * - 'cohere': 使用 Cohere Rerank 官方 API
	 * - 'jina': 使用 Jina Rerank 官方 API
	 * - 'llm': 使用本插件已连接的 LLM 进行语义打分重排
	 * - 'flashrank': 使用 FlashRank 在本地进行重排（无需联网，速度快）
	 */
	type: string;
	/**
	 * API 密钥（'cohere' 和 'jina' 必填）。
	 */
	apiKey?: string;
	/**
	 * API 基础地址（可选，用于反向代理或私有化部署）。
	 */
	baseUrl?: string;
	/**
	 * 模型标识符（如 'rerank-english-v3.0'）。
	 */
	modelId?: string;
	/**
	 * 特定提供商的额外选项。
	 * 对于 'llm' 类型：
	 *   - provider: 实际执行打分的 LLM 供应商名称 (例如 'ollama', 'openai')
	 *   - aiServiceManager: 用于调用对话服务的管理实例
	 */
	extra?: Record<string, any>;
}

/**
 * 待重排的文档结构（输入）。
 */
export interface RerankDocument {
	/**
	 * 文档的文本内容（会被发送给 Reranker 进行语义分析）。
	 */
	text: string;
	/**
	 * 可选的元数据。
	 * 其中 metadata.boostInfo 可能包含原始检索的分数，用于辅助排序。
	 */
	metadata?: Record<string, any>;
}

/**
 * 单个文档的重排结果（输出）。
 */
export interface RerankResult {
	/**
	 * 原始文档在输入数组中的索引位置（对应输入 list 的第几个）。
	 */
	index: number;
	/**
	 * 相关性评分（分数越高代表与查询越相关，通常在 0-1 之间）。
	 */
	score: number;
}

/**
 * 重排序请求包。
 * 打包了用户的搜索词和一堆待打分的文档片段。
 */
export interface RerankRequest {
	/**
	 * 用户的搜索查询词（搜索意图）。
	 */
	query: string;
	/**
	 * 需要参与评分的初步搜索结果列表。
	 */
	documents: RerankDocument[];
	/**
	 * 截断值：返回最相关的 Top K 个结果。
	 * 如果未指定，则返回所有并按分数降序。
	 */
	topK?: number;
}

/**
 * 重排序响应包。
 * 返回排序后的结果列表。
 */
export interface RerankResponse {
	/**
	 * 重新计算评分后的结果列表，已按分数从高到低排列。
	 */
	results: RerankResult[];
}

/**
 * 重排序提供商接口规范。
 * 所有具体的实现类（如 CohereRerankProvider）都必须遵守此规范。
 */
export interface RerankProvider {
	/**
	 * 获取当前实例的类型标识（例如 'cohere'）。
	 */
	getType(): string;

	/**
	 * 执行重排序。
	 * @param request 包含查询和待排文档的请求
	 * @returns 排序后的索引与分数列表
	 */
	rerank(request: RerankRequest): Promise<RerankResponse>;
}

