/**
 * @file flashrank.ts
 * @description FlashRank 本地重排序（Rerank）服务对接实现。
 * 
 * 本文件旨在支持 FlashRank —— 一个极其轻量级且快速的重排序工具。
 * 
 * 为什么需要 FlashRank？
 * 1. 【隐私保护】：FlashRank 可以在本地运行（通过 WebAssembly 或 Node.js），无需将数据发送到云端 API。
 * 2. 【低成本】：不需要购买 Cohere 或 Jina 的 Token。
 * 
 * 注意事项：
 * 当前代码是一个占位实现（Placeholder）。在未来的版本中，我们将通过引入 WebAssembly 或
 * 本地 Python 服务的形式来真正激活 FlashRank 的语义打分能力。
 */

import type { RerankProvider, RerankRequest, RerankResponse } from './types';

/** 初始化选项 */
interface FlashRankOptions {
	/** 模型 ID，例如 'ms-marco-MiniLM-L-12-v2' */
	modelId?: string;
}

/**
 * FlashRank local rerank provider.
 * 负责本地化排序逻辑的封装。
 */
export class FlashRankProvider implements RerankProvider {
	private readonly modelId: string;

	constructor(options: FlashRankOptions) {
		/** 默认使用极简、极快的模型 */
		this.modelId = options.modelId || 'ms-marco-MiniLM-L-12-v2';
	}

	getType(): string {
		return 'flashrank';
	}

	/**
	 * 执行重排序逻辑。
	 * 目前由于底层库尚未集成，暂时采用“直传”策略（不改变顺序，只给满分）。
	 */
	async rerank(request: RerankRequest): Promise<RerankResponse> {
		// TODO: 待实现 FlashRank 集成
		// 方案 1: 通过 HTTP 调用本地启动的 Python 后端服务
		// 方案 2: 使用 Node.js 版本的绑定
		// 方案 3: 使用 WebAssembly (WASM) 版本在浏览器/插件环境中直接运行
		
		console.warn(
			`[FlashRankProvider] FlashRank not yet implemented. Using fallback ranking. Model: ${this.modelId}`,
		);

		// 兜底方案：原样返回，所有分数为 1.0 (代表无法区分优先级)
		return {
			results: request.documents.map((_, index) => ({
				index,
				score: 1.0,
			})),
		};
	}
}

