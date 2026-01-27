/**
 * @file InMemoryGraphAnalyzer.ts
 * @description 内存型图谱分析器。它像是一个“临时沙盘”，专门为需要高强度计算的图谱算法（如社区发现、最短路径分析）提供动力。
 * 
 * 核心原理：
 * 绝大多数图谱算法只需要知道“谁连着谁”以及“连接的权重”，而不需要知道笔记的具体标题或内容。
 * 因此，该分析器采用“极简设计”：只把节点 ID 和 连线关系 从 SQLite 搬到内存里。这样即使你的笔记有几万篇，内存占用也非常小。
 * 
 * 作用：
 * 1. **拓扑分析**：通过 Graphology 库提供的算法，分析笔记之间的关联紧密度。
 * 2. **按需加载**：它支持“局部加载”（通常是 2 跳/2 Hops），即只分析某篇笔记周围的小圈子，而不是整个库。
 * 3. **元数据隔离**：详细的笔记信息（标题、分类等）依然留在数据库里，只有在你需要展示结果时才去数据库里查。
 * 
 * 举例：
 * 当你想看“与当前笔记最相关的知识领域”时，分析器会：
 * 1. 从数据库找到当前笔记及周边 2 层的所有连线。
 * 2. 在内存里构建一个临时的数学模型。
 * 3. 运行算法算出哪些笔记是一个整体（社区）。
 * 4. 给出结果后，这个临时模型就会被销毁释放内存。
 */

import Graph from 'graphology';
import type { GraphStore } from './GraphStore';
import type { GraphNodePO, GraphEdgePO, GraphNodeType, GraphEdgeType } from '@/core/po/graph.po';
import type { GraphPreview, GraphPreviewParams } from './types';

// Graphology types are incomplete, use any for graph instance
type GraphInstance = any;

/**
 * In-memory graph analyzer for advanced graph algorithms.
 * 
 * This class builds temporary Graphology graphs on-demand for complex analyses.
 * The graph is loaded from SQLite, used for analysis, and then discarded.
 * 
 * 用于高级图谱算法的内存分析器。
 * 该类根据需要从 SQLite 加载数据，构建临时的 Graphology 图实例进行复杂分析，完成后即丢弃。
 * 
 * Design Principles:
 * 设计原则：
 * 
 * 1. **Minimal Graph Structure**: Only stores essential graph topology:
 *    **极简图结构**：只存储核心拓扑信息：
 *    - Node IDs only (no metadata like attributes, type, label) | 仅存储节点 ID（不存属性、类型、标签等元数据）
 *    - Edge connections and weights (no edge type or attributes) | 仅存储边连接和权重（不存边类型或属性）
 *    This keeps memory footprint minimal while preserving graph structure for algorithms.
 *    这使得内存占用极小，同时保留了算法所需的图结构。
 * 
 * 2. **On-Demand Metadata Loading**: Metadata (attributes, type, label) is stored in SQLite
 *    and queried on-demand via GraphStore when needed, not loaded into memory.
 *    **元数据按需加载**：元数据存储在 SQLite 中，仅在需要时通过 GraphStore 查询，不常驻内存。
 * 
 * 3. **Selective Loading**: Supports loading only nodes within N hops (typically 2) of
 *    specified center nodes, avoiding full graph loading for large datasets.
 *    **选择性加载**：支持仅加载中心节点 N 跳（通常为 2 跳）范围内的节点，避免在大数据量下加载全图。
 * 
 * 4. **Temporary Nature**: Graphs are built only when complex algorithms are truly needed,
 *    used for analysis, and then released immediately.
 *    **临时性**：仅在确实需要复杂算法时才构建图，分析完成后立即释放。
 * 
 * Typical usage:
 * 典型用法：
 * 1. Create analyzer instance with GraphStore | 使用 GraphStore 创建分析器实例
 * 2. Call buildGraph() with center node IDs to load 2-hop neighborhood (or empty for full graph) | 传入中心节点 ID 调用 buildGraph()
 * 3. Perform analysis using Graphology algorithms via getGraph() | 通过 getGraph() 进行算法分析
 * 4. Query metadata on-demand using getNodeMetadata() if needed | 如有需要，按需查询元数据
 * 5. Analyzer instance is garbage collected, graph is released | 分析器实例被回收，内存释放
 * 
 * @deprecated Use GraphStore instead
 */
export class InMemoryGraphAnalyzer {
	private graph: GraphInstance | null = null;

	constructor(private readonly graphStore: GraphStore) {}

	/**
	 * Build an in-memory Graphology graph from SQLite data.
	 * 
	 * 从 SQLite 数据构建一个内存中的 Graphology 图实例。
	 * 
	 * This method implements a minimal graph structure approach:
	 * 该方法实现了极简图结构方案：
	 * - Only loads node IDs and edge connections (no metadata) | 仅加载节点 ID 和边连接（无元数据）
	 * - Metadata (attributes, type, label) can be queried on-demand via GraphStore.getNode() | 元数据可按需查询
	 * - Supports selective loading: only loads nodes within 2 hops of center nodes | 支持选择性加载：仅加载中心节点 2 跳范围内的内容
	 * 
	 * Why this approach? 为什么要用这种方案？
	 * - Reduces memory footprint significantly (especially for large graphs) | 显著降低内存占用（特别是大图）
	 * - Metadata can change, keeping it in SQLite ensures we always get latest data | 数据库中的元数据始终是最新的
	 * - Graph algorithms typically only need topology (connections), not metadata | 图算法通常只需要拓扑结构
	 * - Allows working with large graphs by loading only relevant subgraphs | 通过只加载相关子图来处理大型图谱
	 * 
	 * @param centerNodeIds Optional: Only load nodes within 2 hops of these center nodes.
	 *   If not provided, loads all nodes (use with caution for large graphs).
	 *   Recommended: Always specify center nodes to load only needed subgraph.
	 */
	buildGraph(centerNodeIds?: string[]): void {
		// 1. 初始化一个新的 Graphology 实例
		this.graph = new Graph() as GraphInstance;

		if (centerNodeIds && centerNodeIds.length > 0) {
			// 2. 如果提供了中心节点，则执行“局部搜索”
			// 这种方式非常高效，因为它只加载用户关心的那部分“知识脉络”
			const nodesToLoad = this.collectNodesWithinHops(centerNodeIds, 2);
			this.addNodesToGraph(nodesToLoad);
			this.addEdgesBetweenNodes(nodesToLoad);
		} else {
			// 3. 否则加载全图节点（慎用！）
			const allNodeIds = this.collectAllNodeIds();
			this.addNodesToGraph(allNodeIds);
			this.addEdgesBetweenNodes(allNodeIds);
		}
	}

	/**
	 * Collect node IDs within N hops of center nodes.
	 * 获取指定节点周边 N 层级的所有关联节点 ID。
	 */
	private collectNodesWithinHops(centerNodeIds: string[], maxHops: number): Set<string> {
		const nodesToLoad = new Set<string>(centerNodeIds);
		
		// 采用经典的广度优先搜索（BFS）逻辑来扩展圈子
		for (let hop = 0; hop < maxHops; hop++) {
			const currentLevel = Array.from(nodesToLoad);
			for (const nodeId of currentLevel) {
				// 通过底层的 GraphStore 从数据库查询邻居
				const neighbors = this.graphStore.getNeighborIds(nodeId);
				for (const neighborId of neighbors) {
					nodesToLoad.add(neighborId);
				}
			}
		}

		return nodesToLoad;
	}

	/**
	 * Collect all node IDs from the graph store.
	 * 从数据库中收集所有类型的节点 ID。
	 */
	private collectAllNodeIds(): Set<string> {
		const allNodeIds = new Set<string>();
		// 项目中定义的各种节点类型
		const nodeTypes: GraphNodeType[] = 
			['document', 'tag', 'category', 'link', 'resource', 'concept', 'person', 'project'];
		
		for (const nodeType of nodeTypes) {
			const nodes = this.graphStore.getNodesByType(nodeType);
			for (const node of nodes) {
				allNodeIds.add(node.id);
			}
		}

		return allNodeIds;
	}

	/**
	 * Add nodes to the in-memory graph (only node IDs, no metadata).
	 * 将节点 ID 注入内存图模型中。注意：这里没有存具体的名字，只存了 ID。
	 */
	private addNodesToGraph(nodeIds: Set<string>): void {
		for (const nodeId of nodeIds) {
			if (!this.graph?.hasNode(nodeId)) {
				this.graph?.addNode(nodeId);
			}
		}
	}

	/**
	 * Add edges between nodes to the in-memory graph (only connections and weights).
	 * 将节点之间的连线关系（及权重）注入内存图模型。
	 */
	private addEdgesBetweenNodes(nodeIds: Set<string>): void {
		if (!this.graph) return;

		for (const nodeId of nodeIds) {
			// 只获取“出边”来避免重复添加或遗漏
			const outgoingEdges = this.graphStore.getOutgoingEdges(nodeId);
			for (const edge of outgoingEdges) {
				// 关键点：只有两个节点都在我们选择的子图中，才添加这条边
				if (nodeIds.has(edge.to_node_id)) {
					this.addEdgeToGraph(edge);
				}
			}
		}
	}

	/**
	 * Add an edge to the in-memory graph.
	 * 
	 * Only stores essential graph structure:
	 * 仅存储基本的图结构：
	 * - Connection (from_node_id -> to_node_id) | 连接关系
	 * - Weight (for algorithm calculations) | 权重值（影响算法计算的关联强度）
	 * 
	 * Does NOT store:
	 * 不进行存储的内容：
	 * - Edge type (use getEdgeMetadata() to query if needed) | 边的类型（需要时按需查询）
	 * - Edge attributes (use getEdgeMetadata() to query if needed) | 边的属性（需要时按需查询）
	 * 
	 * This keeps the graph minimal and focused on topology.
	 * 这保持了图的极简化，使其专注于拓扑结构。
	 */
	private addEdgeToGraph(edge: GraphEdgePO): void {
		if (!this.graph) return;
		
		const edgeKey = edge.id;
		// 确保节点已存在，防止 Graphology 报错
		if (!this.graph.hasEdge(edgeKey) && this.graph.hasNode(edge.from_node_id) && this.graph.hasNode(edge.to_node_id)) {
			try {
				// 使用有向边，并携带权重
				// Only store essential graph structure: connection and weight
				this.graph.addDirectedEdgeWithKey(
					edgeKey,
					edge.from_node_id,
					edge.to_node_id,
					{
						weight: edge.weight,
					},
				);
			} catch (e) {
				// 边可能已存在或由于某些极罕见原因失败，直接忽略以保证流程继续
				// Edge might already exist, ignore
			}
		}
	}

	/**
	 * Get the underlying Graphology graph instance.
	 * Use this to perform advanced graph algorithms.
	 * 
	 * 获取底层的 Graphology 实例，这是你进行所有数学运算的入口。
	 * 
	 * Note: The graph only contains node IDs and edge connections.
	 * 注意：内存图里只有 ID 和连线。
	 * To get node metadata (type, label, attributes), use GraphStore.getNode().
	 * 
	 * @throws Error if graph has not been built yet
	 */
	getGraph(): GraphInstance {
		if (!this.graph) {
			throw new Error('Graph has not been built. Call buildGraph() first.');
		}
		return this.graph;
	}

	/**
	 * Get node metadata from GraphStore (on-demand loading).
	 * 从数据库查询节点的元数据（按需加载）。
	 * 
	 * The in-memory graph only contains node IDs. Use this method to query
	 * full node information (type, label, attributes) from SQLite when needed.
	 * 
	 * 内存图只存 ID，如果算法运行完你想显示这篇笔记的标题，请调用这个方法。
	 * 
	 * This approach ensures:
	 * 这种设计的优势：
	 * - Minimal memory usage (metadata not duplicated in memory) | 极简内存占用（内存里不存重复的大段文本）
	 * - Always up-to-date metadata (queried fresh from SQLite) | 数据总是保持最新
	 * - Metadata only loaded when actually needed | 只有真正要展示时才花时间去读取数据
	 * 
	 * @param nodeId The node ID to query metadata for
	 * @returns Node metadata including type, label, attributes, or null if not found
	 */
	getNodeMetadata(nodeId: string): GraphNodePO | null {
		return this.graphStore.getNode(nodeId);
	}

	/**
	 * Get edge metadata from GraphStore (on-demand loading).
	 * 按需查询边的详细元数据（如：连线类型）。
	 * 
	 * @param fromNodeId Source node ID
	 * @param toNodeId Target node ID
	 * @param edgeType Edge type to match
	 * @returns Edge metadata including type, attributes, or null if not found
	 */
	getEdgeMetadata(fromNodeId: string, toNodeId: string, edgeType: GraphEdgeType): GraphEdgePO | null {
		const edges = this.graphStore.getOutgoingEdges(fromNodeId);
		return edges.find(e => e.to_node_id === toNodeId && e.type === edgeType) ?? null;
	}

	/**
	 * Check if graph has been built.
	 * 检查内存图模型是否已经构建好。
	 */
	hasGraph(): boolean {
		return this.graph !== null;
	}

	/**
	 * Release the in-memory graph to free memory.
	 * 显式释放内存。虽然 JS 有垃圾回收，但在处理大型图谱后手动清理是个好习惯。
	 */
	release(): void {
		if (this.graph) {
			this.graph.clear();
			this.graph = null;
		}
	}

	/**
	 * Build a preview subgraph for UI display (2-hop from start node).
	 * 为前台 UI 构建一个“预览图谱”（默认加载中心节点周围 2 层的情况）。
	 * 
	 * This method uses efficient SQL queries via GraphStore without building
	 * an in-memory Graphology graph. Metadata (label, type) is loaded on-demand.
	 * 
	 * 重点：对于简单的 UI 预览，直接用 SQL 查数据库比构建复杂的内存分析器要快得多。
	 */
	buildPreview(params: GraphPreviewParams): GraphPreview {
		// 直接复用 GraphStore 中已经优化过的 SQL 查询逻辑
		// Use GraphStore's getPreview which already implements efficient SQL-based query
		return this.graphStore.getPreview({ currentFilePath: params.startNodeId, maxNodes: params.maxNodes });
	}

	/**
	 * Get related document IDs within N hops (uses SQL queries, no Graphology needed).
	 * 查找指定笔记在 N 级范围内的所有相关笔记 ID。
	 */
	getRelatedDocumentIds(params: { documentId: string; maxHops?: number }): Set<string> {
		const maxHops = params.maxHops ?? 2;
		const relatedNodeIds = this.graphStore.getRelatedNodeIds(params.documentId, maxHops);

		// 过滤逻辑：我们只关心这些关联节点中哪些是“真正的笔记文件”（document）
		const documentIds = new Set<string>();
		for (const nodeId of relatedNodeIds) {
			const node = this.graphStore.getNode(nodeId);
			if (node?.type === 'document') {
				documentIds.add(nodeId);
			}
		}
		return documentIds;
	}
}


