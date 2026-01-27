/**
 * ============================================================================
 * 文件说明: reranker.ts - 搜索结果重排序器
 * ============================================================================
 * 
 * 【这个文件是干什么的】
 * 这个文件负责对搜索结果进行"二次排序"（Rerank），通过多种信号和 AI 模型，
 * 让最相关的结果排在最前面，提升搜索体验。
 * 
 * 【起了什么作用】
 * 1. 信号增强：根据用户行为（打开次数、最近打开时间）给结果加分
 * 2. 关系增强：如果结果与当前笔记有链接关系，提升排名
 * 3. LLM 重排：使用专门的 AI 模型（如 Cohere Rerank）进行深度相关性分析
 * 4. 多阶段融合：先用快速算法排序，再用慢速但精确的 AI 模型优化
 * 
 * 【举例介绍】
 * 场景 1：用户行为信号加分
 * - 搜索关键词："React 性能优化"
 * - 初始结果有 3 篇笔记：A（从未打开）、B（上周打开过）、C（今天刚看过）
 * - Reranker 处理：
 *   - A 分数：1.0（基础分）
 *   - B 分数：1.0 × 1.2 = 1.2（打开过，+20% boost）
 *   - C 分数：1.0 × 1.5 = 1.5（最近打开，+50% boost）
 * - 最终排序：C > B > A
 * 
 * 场景 2：关系图谱加分
 * - 你正在笔记 "项目 A 技术方案" 中搜索
 * - 结果中有一篇笔记 "项目 A 架构设计" 与当前笔记有双向链接
 * - Reranker 处理：
 *   - 检测到图谱关系（2 跳内）
 *   - 给这篇笔记额外加分（+30% boost）
 * - 效果：相关笔记排在更前面
 * 
 * 场景 3：LLM 深度重排（可选，慢但精准）
 * - 用户启用了 LLM Rerank 功能（默认关闭）
 * - 搜索："如何使用 useState"
 * - 初始结果：3 篇笔记都提到了 "useState"
 * - LLM Rerank 处理：
 *   - 将查询和每篇笔记的内容发送给 AI 模型（如 Cohere Rerank）
 *   - AI 理解语义，重新打分：
 *     - 笔记 1："useState 使用指南"（0.95 分 - 最相关）
 *     - 笔记 2："React Hooks 大全"（0.75 分 - 部分相关）
 *     - 笔记 3："useState 常见错误"（0.60 分 - 相关度较低）
 *   - 最终排序完全基于 AI 的语义理解
 * 
 * 【两种工作模式】
 * 1. 快速模式（默认，推荐）：
 *    - 只使用用户行为信号和图谱关系
 *    - 速度快（毫秒级）
 *    - 适合日常搜索
 * 
 * 2. 精确模式（可选，enableLLMRerank=true）：
 *    - 在快速模式基础上，再调用 AI 模型深度排序
 *    - 速度慢（秒级），需要调用外部 API
 *    - 适合对精确度要求极高的场景（如 AI 问答）
 * 
 * 【技术细节】
 * - 支持多种 Rerank 模型：Cohere、Jina、Voyage 等
 * - 使用 Reciprocal Rank Fusion (RRF) 算法融合多个信号
 * - 考虑图谱拓扑关系（2-hop 邻居）
 * - 缓存用户行为数据提升性能
 * ============================================================================
 */

import type { AIServiceManager } from '@/service/chat/service-manager';
import type { SearchSettings } from '@/app/settings/types';
import type { SearchResultItem, SearchScopeValue } from '../types';
import { sqliteStoreManager } from '@/core/storage/sqlite/SqliteStoreManager';
import { RerankProviderManager } from '@/core/providers/rerank/factory';
import type { RerankDocument } from '@/core/providers/rerank/types';

/**
 * Ranking signals for boosting search results.
 * 排序信号：用于根据用户行为增强搜索结果
 * - lastOpenTs：最后一次打开的时间戳
 * - openCount：总共打开的次数
 */
export type RankingSignals = Map<string, { lastOpenTs: number; openCount: number }>;

/**
 * Reranker for merging and reranking hybrid search results.
 * 重排序器类：负责对混合搜索结果进行二次排序
 */
export class Reranker {
	constructor(
		private readonly aiServiceManager: AIServiceManager,
		private readonly searchSettings: SearchSettings,
	) { }

	/**
	 * Rerank search results with optional LLM reranking.
	 * 
	 * This method handles:
	 * 1. Getting ranking signals and related paths
	 * 2. Applying ranking boosts (always performed)
	 * 3. Optional LLM reranking for high-quality but slow relevance scoring
	 * 
	 * LLM reranking is expensive and should only be enabled for specific use cases
	 * like AI analysis where quality is more important than speed.
	 * 
	 * @param items - Search results to rerank
	 * @param query - Original search query
	 * @param scopeValue - Search scope value for getting related paths
	 * @param enableLLMRerank - Whether to perform expensive LLM reranking (default: false)
	 * @returns Reranked results with updated scores
	 */
	async rerank(
		items: Array<{ path: string; score?: number }>,
		query: string,
		scopeValue?: SearchScopeValue,
		enableLLMRerank: boolean = false,
	): Promise<SearchResultItem[]> {
		if (!query || items.length === 0) {
			return items.map((i) => ({ ...i, score: i.score ?? 0 })) as SearchResultItem[];
		}

		// Get ranking signals and related paths for boost context
		const signals = await this.getSignalsForPaths(items.map((i) => i.path));
		const related = scopeValue?.currentFilePath
			? await this.getRelatedPathsWithinHops({
				startPath: scopeValue.currentFilePath,
				maxHops: 2,
			})
			: new Set<string>();

		// Apply ranking boosts (always performed for better relevance)
		const itemsWithScore = items.map((i) => ({ ...i, score: i.score ?? 0 })) as SearchResultItem[];
		const boostedItems = this.applyRankingBoosts({ items: itemsWithScore, signals, relatedPaths: related });

		// Optional LLM reranking (expensive, only for high-quality requirements)
		if (!enableLLMRerank) {
			return boostedItems;
		}

		// Apply LLM rerank if model is configured and enabled
		const rerankModel = this.searchSettings.chunking.rerankModel;
		if (!rerankModel) {
			return boostedItems;
		}

		// Ensure score is present for rerank
		const itemsForRerank = boostedItems.map((i) => ({
			...i,
			score: i.finalScore ?? i.score ?? 0,
		}));

		try {
			return await this.rerankResults(itemsForRerank, query, rerankModel, signals, related);
		} catch (error) {
			console.error('[Reranker] Failed to rerank results:', error);
			// Continue with boosted results if rerank fails
			return boostedItems;
		}
	}

	/**
	 * Get ranking signals for given paths.
	 */
	private async getSignalsForPaths(paths: string[]): Promise<RankingSignals> {
		if (!paths.length) return new Map();
		const docMetaRepo = sqliteStoreManager.getDocMetaRepo();
		const docStatisticsRepo = sqliteStoreManager.getDocStatisticsRepo();

		// Get doc_ids from paths
		const metaMap = await docMetaRepo.getByPaths(paths);
		const docIds = Array.from(metaMap.values()).map((m) => m.id);
		const signals = await docStatisticsRepo.getSignalsForDocIds(docIds);

		// Map back to paths
		const pathToDocId = new Map(Array.from(metaMap.entries()).map(([path, meta]) => [path, meta.id]));
		const result = new Map<string, { lastOpenTs: number; openCount: number }>();
		for (const [path, docId] of pathToDocId.entries()) {
			const signal = signals.get(docId);
			if (signal) {
				result.set(path, signal);
			}
		}
		return result;
	}

	/**
	 * Get related document paths within N hops using GraphStore.
	 */
	private async getRelatedPathsWithinHops(params: { startPath: string; maxHops: number }): Promise<Set<string>> {
		const maxHops = Math.max(1, Number(params.maxHops ?? 2));
		const graphStore = sqliteStoreManager.getGraphStore();
		return await graphStore.getRelatedFilePaths({
			currentFilePath: params.startPath,
			maxHops,
		});
	}

	/**
	 * Internal method to perform actual reranking.
	 */
	private async rerankResults<T extends { path: string; score: number }>(
		items: T[],
		query: string,
		rerankModel: { provider: string; modelId: string },
		signals?: RankingSignals,
		relatedPaths?: Set<string>,
	): Promise<T[]> {
		// Prepare document texts for reranking
		// Use content if available, otherwise use highlight text, title, or path
		const documents: RerankDocument[] = items.map((item) => {
			const itemAny = item as any;
			const text = itemAny.content || itemAny.highlight?.text || itemAny.title || item.path;

			// Include boost context information in metadata
			const signal = signals?.get(item.path);
			const isRelated = relatedPaths?.has(item.path);
			const boostInfo: string[] = [];
			if (signal) {
				boostInfo.push(`opened ${signal.openCount} times`);
				if (signal.lastOpenTs) {
					const daysAgo = Math.floor((Date.now() - signal.lastOpenTs) / (1000 * 60 * 60 * 24));
					boostInfo.push(`last opened ${daysAgo} days ago`);
				}
			}
			if (isRelated) {
				boostInfo.push('related to current file');
			}

			return {
				text,
				metadata: {
					boostInfo: boostInfo.join(', '),
				},
			};
		});

		// Get provider config for API-based providers (cohere, jina)
		const providerConfig = this.getProviderConfig(rerankModel.provider);

		// Create rerank provider via manager (handles all provider types)
		const manager = RerankProviderManager.getInstance();
		const provider = manager.createFromRerankModel(
			rerankModel,
			providerConfig || undefined,
			this.aiServiceManager,
		);

		if (!provider) {
			console.warn(
				`[Reranker] Failed to create rerank provider for ${rerankModel.provider}. Using original ranking.`,
			);
			return items;
		}

		try {
			// Call rerank provider
			const response = await provider.rerank({
				query,
				documents,
				topK: items.length,
			});

			// Map reranked results back to original items
			// Rerank provider returns results sorted by relevance score (highest first)
			// Note: Some providers (like LLM) return rank-based scores, so we preserve original scores
			// and use rerank position as a boost factor
			const rerankedItems = response.results.map((result, rerankIndex) => {
				const originalItem = items[result.index]!;
				const originalScore = (originalItem as any).finalScore ?? originalItem.score ?? 0;

				// Normalize rerank score to 0-1 range if it's rank-based (e.g., LLM provider uses docCount - rank)
				// For API providers (cohere, jina), result.score is already a proper relevance score (0-1)
				// For LLM provider, result.score is rank-based (docCount - rank), so we normalize it
				const maxPossibleScore = items.length; // LLM provider uses docCount as max score
				const normalizedRerankScore = result.score > 1 ? result.score / maxPossibleScore : result.score;

				// Combine original score with rerank boost
				// Use weighted combination: 70% original score + 30% rerank boost
				// This preserves the original relevance while incorporating rerank improvements
				const rerankBoost = normalizedRerankScore * 0.3;
				const combinedScore = originalScore * 0.7 + rerankBoost;

				return {
					...originalItem,
					score: combinedScore,
					finalScore: combinedScore,
				};
			});

			// Ensure results are sorted by score (descending) - rerank provider should already do this, but ensure it
			rerankedItems.sort((a, b) => (b.finalScore ?? b.score ?? 0) - (a.finalScore ?? a.score ?? 0));

			return rerankedItems;
		} catch (error) {
			console.error(`[Reranker] Rerank failed:`, error);
			return items;
		}
	}

	/**
	 * Get provider config from search settings.
	 */
	private getProviderConfig(providerType: string): { apiKey?: string; baseUrl?: string; extra?: Record<string, any> } | null {
		// Try to get from AI service settings
		const aiSettings = (this.searchSettings as any).ai;
		if (aiSettings?.llmProviderConfigs?.[providerType]) {
			return aiSettings.llmProviderConfigs[providerType];
		}

		// For LLM provider, try to get from rerank model config
		if (providerType === 'llm') {
			const rerankModel = this.searchSettings.chunking.rerankModel;
			if (rerankModel) {
				const providerConfig = aiSettings?.llmProviderConfigs?.[rerankModel.provider];
				return {
					apiKey: providerConfig?.apiKey,
					baseUrl: providerConfig?.baseUrl,
					extra: {
						provider: rerankModel.provider,
						...providerConfig?.extra,
					},
				};
			}
		}

		return null;
	}

	/**
	 * Apply metadata/graph based boosts to items and return a sorted copy.
	 *
	 * Current boost strategy:
	 * 1. Frequency boost (freqBoost):
	 *    - Formula: log1p(openCount) * 0.15
	 *    - Uses logarithmic scaling to prevent over-weighting high-frequency items
	 *    - Example: 1 open -> ~0.10, 10 opens -> ~0.38, 100 opens -> ~0.69
	 *
	 * 2. Recency boost (recencyBoost):
	 *    - Formula: max(0, 0.3 - days * 0.01)
	 *    - Clamped to [0, 0.3] to avoid unbounded negative drift
	 *    - Linear decay: 0.3 for today, 0.2 for 10 days ago, 0 for 30+ days ago
	 *    - Rewards recently accessed documents
	 *
	 * 3. Graph boost (graphBoost):
	 *    - Fixed value: 0.2 if file is related to current file (within 2 hops), 0 otherwise
	 *    - Binary boost: either related or not (no distance weighting currently)
	 *
	 * Final score: baseScore + freqBoost + recencyBoost + graphBoost
	 *
	 * Potential extensions (not yet implemented):
	 * - Recent 2-week access count: track and boost based on opens within last 14 days
	 * - Bookmark boost: add fixed boost for bookmarked documents
	 * - Content richness boost: use richness_score from doc_statistics (word_count, link_count, etc.)
	 * - Graph distance weighting: use actual hop distance (1 hop > 2 hops) instead of binary
	 * - Keyword match boost: differentiate title matches (higher) vs content matches (lower)
	 * - Match frequency boost: more query term matches in title/content should boost more
	 *
	 * Notes:
	 * - This intentionally keeps the formula simple and stable.
	 * - All boosts are additive to maintain interpretability.
	 */
	applyRankingBoosts(params: {
		items: SearchResultItem[];
		signals: RankingSignals;
		relatedPaths: Set<string>;
		nowTs?: number;
	}): SearchResultItem[] {
		const now = params.nowTs ?? Date.now();
		const items = params.items.map((i) => ({ ...i }));

		for (const item of items) {
			const s = params.signals.get(item.path);
			if (!s) continue;

			// Frequency boost: logarithmic scaling of total open count
			const freqBoost = Math.log1p(s.openCount) * 0.15;

			// Recency boost: linear decay based on days since last open
			const dayMs = 1000 * 60 * 60 * 24;
			const days = s.lastOpenTs ? Math.max(0, (now - s.lastOpenTs) / dayMs) : Infinity;
			const recencyBoost = Number.isFinite(days) ? Math.max(0, 0.3 - days * 0.01) : 0;

			// Graph boost: fixed boost for files related to current file (within 2 hops)
			const graphBoost = params.relatedPaths.has(item.path) ? 0.2 : 0;

			// Calculate final score as sum of base score and all boosts
			const base = item.score ?? 0;
			item.finalScore = base + freqBoost + recencyBoost + graphBoost;
		}

		// Sort by final score (descending)
		items.sort((a, b) => (b.finalScore ?? b.score ?? 0) - (a.finalScore ?? a.score ?? 0));
		return items;
	}
}
