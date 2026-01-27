/**
 * @file doc-statistics.po.ts
 * @description 文档统计数据持久化对象，存储文档的统计信息用于排名和提升
 */

/**
 * Document statistics PO (Persistent Object).
 * Stores document statistics for ranking and boosting.
 * 
 * 文档统计持久化对象
 * 存储用于排名和提升的文档统计信息
 */
export interface DocStatisticsPO {
	/**
	 * File path (primary key).
	 * 文件路径（主键）
	 */
	path: string;
	/**
	 * Word count (language-specific calculation).
	 * 单词数（特定语言计算）
	 */
	word_count: number | null;
	/**
	 * Character count.
	 * 字符数
	 */
	char_count: number | null;
	/**
	 * Language code (e.g., 'en', 'zh', 'ja').
	 * 语言代码（例如：'en', 'zh', 'ja'）
	 */
	language: string | null;
	/**
	 * Richness score (computed document importance indicator).
	 * 丰富度分数（计算出的文档重要性指标）
	 */
	richness_score: number | null;
	/**
	 * Last update time (timestamp).
	 * 最后更新时间（时间戳）
	 */
	updated_at: number;
}

