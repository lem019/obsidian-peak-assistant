/**
 * @file constant.ts
 * @description 通用常量定义文件。
 * 包含插件中使用的所有全局常量，如数据库文件名、检索算法参数、UI 动画速度等。
 * 部分常量未来可能会移至设置界面供用户配置。
 */

/*
 * Common constants for the plugin. Some of them are configurable in Settings, while others are not -- so they are here.
 */

/**
 * Embedding vector dimension.
 * Can be configured based on the external embedding model used.
 * Common dimensions: 384, 512, 768, 1536, etc.
 * Must match the dimension of embeddings provided externally.
 * 
 * 嵌入向量维度。需与所使用的嵌入模型匹配（如 OpenAI 为 1536，HuggingFace 模型多为 768 或 384）。
 */
export const EMBEDDING_DIMENSION = 1536;

/**
 * Batch size for checking indexed status during index scanning.
 * Used to balance memory usage and query efficiency.
 * 
 * 索引状态检查的批处理大小。平衡内存占用与查询效率。
 */
export const INDEX_CHECK_BATCH_SIZE = 100;

/**
 * Search database filename.
 * 
 * 搜索数据库文件名（存储向量和全文索引）。
 */
export const SEARCH_DB_FILENAME = 'search.sqlite';

/**
 * Meta database filename for chat and project data.
 * 
 * 元数据数据库文件名（存储对话记录、项目信息、用户画像等）。
 */
export const META_DB_FILENAME = 'meta.sqlite';

/**
 * Progress update interval in milliseconds for indexing operations.
 * Used to control how frequently progress notifications are updated.
 * 
 * 索引扫描时的进度更新频率（毫秒）。
 */
export const INDEX_PROGRESS_UPDATE_INTERVAL = 3000; // Update every 3 seconds

/**
 * Index state keys for storing index metadata.
 * 
 * 在设置或数据库中存储索引状态的键名。
 */
export const INDEX_STATE_KEYS = {
	builtAt: 'index_built_at',
	indexedDocs: 'indexed_docs',
} as const;

/**
 * Default top K value for search results.
 * Used when query.topK is not specified.
 * 
 * 搜索结果默认返回的最大数量。
 */
export const DEFAULT_SEARCH_TOP_K = 50;

/**
 * As we may filter some results, we need to multiply the top K value by this factor. And get more results.
 * Also, we want to get more results to improve the quality of the search.
 * 
 * 搜索召回放大因子。因为后续会有去重或过滤，先多搜出一些结果以保证最终质量。
 */
export const DEFAULT_SEARCH_TOP_K_MULTI_FACTOR = 2;

/**
 * Default search mode.
 * Used when query.mode is not specified.
 * 
 * 默认搜索模式（整个库 vault）。
 */
export const DEFAULT_SEARCH_MODE = 'vault';

/**
 * RRF (Reciprocal Rank Fusion) configuration constants.
 */
export const RRF_K = 60;
// Two-stage RRF weights for hybrid search
// Stage 1: Content sources (fulltext + vector) merged with combined weight
/** 混合搜索（全文+向量）中内容得分的权重 */
export const RRF_CONTENT_WEIGHT = 0.6; // Combined weight for content hits (text + vector)
// Stage 2: Content vs Meta with equal weights
/** 内容得分与元数据得分在最终合并时的比例 */
export const RRF_CONTENT_VS_META_WEIGHT = 0.5; // Weight for content hits vs meta hits

/**
 * TODO: Turn these constants into configuration options, or make them optional parameters for tools.
 * 	This will allow the AI Agent to adjust them according to the specific scenario.
 * 	Different tasks require different "exploration scales". If the Agent can fine-tune PHYSICAL_CONNECTION_BONUS,
 * 	its ability to explore and discover will be significantly improved.
 * 
 * Graph Inspector RRF weights for document node ranking.
 * Weights are applied to each ranking dimension in the RRF formula.
 * Higher weight gives more importance to that dimension.
 * 
 * 知识图谱检视器的搜索排名权重。用于通过拓扑结构和元数据对关联笔记进行排序。
 */
export const GRAPH_RRF_WEIGHTS = {
	// Connection density (how well connected a node is) - 链接密度
	density: 1.0,
	// Update time (how recently the node was modified) - 笔记更新时间（权重略高，偏向新内容）
	updateTime: 1.2, // Slightly higher weight for recency
	// Richness score (content quality indicator) - 内容长度/丰富度
	richness: 0.8,
	// Open count (how often the user accesses this node) - 打开次数
	openCount: 0.9,
	// Last open time (how recently the user accessed this node) - 上次打开时间
	lastOpen: 0.7,
	// Similarity score (only for semantic neighbors, measures semantic closeness) - 向量语义相似度
	similarity: 1.1, // Higher weight for semantic relevance in BFS traversal
} as const;

/**
 * Base score bonus for physically connected nodes vs semantic neighbors.
 * Physical connections are considered more reliable than semantic similarity.
 * 
 * 物理连接权重奖励。显式的 [[引用]] 比单纯的语义相似更有说服力。
 */
export const PHYSICAL_CONNECTION_BONUS = 0.1;

/**
 * Path finding algorithm constants for bidirectional hybrid BFS.
 * 
 * 双向混合 BFS 路径寻找算法相关常量。
 */
export const PATH_FINDING_CONSTANTS = {
	/**
	 * Default number of iterations for hybrid path discovery.
	 * Balances diversity and computational cost.
	 * - 1st iteration: Finds most direct path
	 * - 2nd iteration: Discovers one alternative path
	 * - 3rd iteration: Provides additional exploration perspective
	 * 
	 * 默认迭代深度。平衡搜索范围和计算开销。
	 */
	DEFAULT_ITERATIONS: 3,

	/**
	 * Maximum hop limit to prevent semantic drift.
	 * Limits path length to maintain result relevance and prevent excessive computation.
	 * 
	 * 最大跳转限制。防止路径太长导致语义偏离太远。
	 */
	MAX_HOPS_LIMIT: 5,
} as const;

export const KEY_NODES_RRF_K = 60;

/**
 * for each step of graph inspection, limit their duration to avoid no response for a long time.
 * 
 * 图谱扫描每一步的时间限制（20秒），防止在大型库中卡死。
 */
export const GRAPH_INSPECT_STEP_TIME_LIMIT = 10000; // 10 seconds

// Use a reasonable limit to balance performance and ranking accuracy
// RRF works well with top-ranked nodes since low-degree nodes contribute little to the score
// Consider top 500 nodes by degree for RRF fusion
/** 参与 RRF 融合计算的候选池大小 */
export const RRF_RANKING_POOL_SIZE = 500;

/**
 * AI Search graph generation constants.
 * 
 * AI 搜索图谱生成的规模控制。
 */
export const AI_SEARCH_GRAPH_MAX_NODES_PER_SOURCE = 50; // Max nodes per source when building graph
export const AI_SEARCH_GRAPH_MAX_HOPS = 2; // Max hops from each source
export const AI_SEARCH_GRAPH_FINAL_MAX_NODES = 30; // Final max nodes in merged graph

/**
 * Minimum confidence threshold for user profile candidate items.
 * 
 * 用户画像提取时的最低置信度阈值。
 */
export const USER_PROFILE_MIN_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Default summary text when no summary is available.
 */
export const DEFAULT_SUMMARY = 'defaultSummary';

/**
 * Number of messages to accumulate before triggering summary update for conversation.
 * 
 * 每隔 3 条对话消息触发一次会话摘要生成。
 */
export const CONVERSATION_SUMMARY_UPDATE_THRESHOLD = 3;

/**
 * Number of messages to accumulate before triggering summary update for project.
 * 
 * 每隔 5 条对话消息触发一次项目摘要生成。
 */
export const PROJECT_SUMMARY_UPDATE_THRESHOLD = 5;

/**
 * Debounce delay in milliseconds before triggering summary update.
 */
export const SUMMARY_UPDATE_DEBOUNCE_MS = 5000;

/**
 * Default suggestions for chat input when no conversation context is available.
 * 
 * 新对话开始时的建议问题列表。
 */
export const DEFAULT_CHAT_SUGGESTIONS = [
	'What are the latest trends in AI?',
	'How does machine learning work?',
	'Explain quantum computing',
	'Best practices for React development',
	'How to optimize database queries?',
	'What is the difference between REST and GraphQL?',
	'Explain the concept of clean code',
	'What are design patterns?',
] as const;

/**
 * Typing speed for typewriter effect in milliseconds per character.
 * Used for displaying conversation titles with animation.
 * 
 * 打字机效果速度（毫秒/字符）。
 */
export const TYPEWRITER_EFFECT_SPEED_MS = 30;

/** 项目摘要文件的默认名称 */
export const CHAT_PROJECT_SUMMARY_FILENAME = 'Project-Summary.md';

/**
 * Default title for new conversations.
 */
export const DEFAULT_NEW_CONVERSATION_TITLE = 'New Conversation';

/**
 * Character limit for collapsed user messages in chat view.
 * Messages longer than this limit will be truncated with an expand button.
 * 
 * 用户消息折叠限制（超过 200 字符展示“展开”按钮）。
 */
export const COLLAPSED_USER_MESSAGE_CHAR_LIMIT = 200;


/**
 * Maximum number of conversations to display in conversation sections before showing "See more" button.
 */
export const MAX_CONVERSATIONS_DISPLAY = 50;

/**
 * Maximum number of projects to display in project sections before showing "See more" button.
 * This is smaller than MAX_CONVERSATIONS_DISPLAY since projects are typically fewer in number.
 */
export const MAX_PROJECTS_DISPLAY = 10;

/**
 * Maximum number of conversations to display under each project item in the project list.
 * This is much smaller than MAX_CONVERSATIONS_DISPLAY since it's shown within a nested structure.
 */
export const MAX_CONVERSATIONS_PER_PROJECT = 10;

/**
 * Minimum number of messages required for title generation.
 * Need at least user message + assistant response to generate a meaningful title.
 */
export const MIN_MESSAGES_FOR_TITLE_GENERATION = 2;

/**
 * Vault description filename in the prompt folder.
 * Best practice: be sure to write down the key notes. and the overall structure of the vault.
 */
export const VAULT_DESCRIPTION_FILENAME = 'vault-description.md';

/**
 * Top tags count for global tag cloud when get system info.
 */
export const GLOBAL_TAG_CLOUD_TOP_TAGS_COUNT = 50;