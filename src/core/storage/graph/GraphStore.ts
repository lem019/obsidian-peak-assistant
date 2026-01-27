import type { GraphNodeRepo } from '@/core/storage/sqlite/repositories/GraphNodeRepo';
import { GraphEdgeRepo } from '@/core/storage/sqlite/repositories/GraphEdgeRepo';
import type { GraphNodePO, GraphEdgePO, GraphNodeType, GraphEdgeType } from '@/core/po/graph.po';
import { extractTags, extractWikiLinks } from '@/core/utils/markdown-utils';
import type { GraphPreview } from './types';

/**
 * @file GraphStore.ts
 * @description 图数据存储中心，负责管理笔记之间的关系网。
 * 
 * ## 核心职能
 * 本文件是所有图操作的主要接口。它使用 SQLite 作为底层存储，负责：
 * 1. **节点与边的持久化**：将笔记（节点）及其关联（边）保存到数据库。
 * 2. **关系提取**：从 Markdown 内容中提取标签、双链、分类，并将其转化为图结构。
 * 3. **高效查询**：利用 SQL 的强大查询能力进行多跳搜索、邻居查找等，而无需将整个图加载到内存。
 * 
 * ## 在项目中的角色
 * 它是“大脑的连接通路”。当 AI 需要通过“关联思维”来寻找相关知识时，它会向 GraphStore 询问：“和这个笔记相关的有哪些标签？哪些笔记引用了它？”
 * 
 * ## 生活化类比
 * 就像一个城市的交通管理系统。它记录了所有的地标（节点）和道路（边）。当你询问“从天安门出发两步能到的地方有哪些”时，它能迅速给出答案。
 */
export class GraphStore {
	constructor(
		private readonly nodeRepo: GraphNodeRepo,
		private readonly edgeRepo: GraphEdgeRepo,
	) { }

	// ===== 节点操作 (Node Operations) =====

	/**
	 * 更新或插入节点。
	 * 如果节点已存在则更新，不存在则创建。
	 */
	async upsertNode(node: {
		id: string; // 节点唯一标识，通常是文件路径或特定 ID
		type: GraphNodeType; // 节点类型：document, tag, category, link 等
		label: string; // 显示名称
		attributes: Record<string, unknown>; // 额外属性（如路径、状态等）
	}): Promise<void> {
		const now = Date.now();
		await this.nodeRepo.upsert({
			id: node.id,
			type: node.type,
			label: node.label,
			attributes: JSON.stringify(node.attributes), // 属性序列化存储
			created_at: now,
			updated_at: now,
		});
	}

	/**
	 * 根据 ID 获取节点。
	 */
	async getNode(id: string): Promise<GraphNodePO | null> {
		const node = await this.nodeRepo.getById(id);
		if (!node) return null;
		return {
			id: node.id,
			type: node.type as GraphNodeType,
			label: node.label,
			attributes: node.attributes,
			created_at: node.created_at,
			updated_at: node.updated_at,
		};
	}

	/**
	 * 删除节点及其所有关联的边。
	 * 确保数据的引用完整性。
	 */
	async deleteNode(id: string): Promise<void> {
		// 先删除该节点发出的和接收的所有边
		await this.edgeRepo.deleteByFromNode(id);
		await this.edgeRepo.deleteByToNode(id);
		// 再删除节点本身
		await this.nodeRepo.deleteById(id);
	}

	/**
	 * 获取指定类型的所有节点。
	 */
	async getNodesByType(type: GraphNodeType): Promise<GraphNodePO[]> {
		const nodes = await this.nodeRepo.getByType(type);
		return nodes.map((n) => ({
			id: n.id,
			type: n.type as GraphNodeType,
			label: n.label,
			attributes: n.attributes,
			created_at: n.created_at,
			updated_at: n.updated_at,
		}));
	}

	// ===== 边操作 (Edge Operations) =====

	/**
	 * 更新或插入边。如果边已存在，其权重（weight）会增加。
	 * 这常用于表示“关联强度”。
	 */
	async upsertEdge(edge: {
		fromNodeId: string; // 起点 ID
		toNodeId: string;   // 终点 ID
		type: GraphEdgeType; // 边类型：references, tagged, categorized 等
		weight?: number;     // 权重（默认为 1.0）
		attributes?: Record<string, unknown>; // 边上的额外信息
	}): Promise<void> {
		const now = Date.now();
		const edgeId = GraphEdgeRepo.generateEdgeId(edge.fromNodeId, edge.toNodeId, edge.type);
		const existingEdge = await this.edgeRepo.getById(edgeId);

		let weight = edge.weight ?? 1.0;
		if (existingEdge) {
			// 如果边已存在，累加权重以体现更强的关联性
			weight = existingEdge.weight + (edge.weight ?? 1.0);
		}

		await this.edgeRepo.upsert({
			id: edgeId,
			from_node_id: edge.fromNodeId,
			to_node_id: edge.toNodeId,
			type: edge.type,
			weight,
			attributes: JSON.stringify(edge.attributes ?? {}),
			created_at: existingEdge?.created_at ?? now,
			updated_at: now,
		});
	}

	/**
	 * 获取从特定节点出发的所有边。
	 */
	async getOutgoingEdges(nodeId: string): Promise<GraphEdgePO[]> {
		const edges = await this.edgeRepo.getByFromNode(nodeId);
		return edges.map((e) => ({
			id: e.id,
			from_node_id: e.from_node_id,
			to_node_id: e.to_node_id,
			type: e.type as GraphEdgeType,
			weight: e.weight,
			attributes: e.attributes,
			created_at: e.created_at,
			updated_at: e.updated_at,
		}));
	}

	/**
	 * 获取指向特定节点的所有边。
	 */
	async getIncomingEdges(nodeId: string): Promise<GraphEdgePO[]> {
		const edges = await this.edgeRepo.getByToNode(nodeId);
		return edges.map((e) => ({
			id: e.id,
			from_node_id: e.from_node_id,
			to_node_id: e.to_node_id,
			type: e.type as GraphEdgeType,
			weight: e.weight,
			attributes: e.attributes,
			created_at: e.created_at,
			updated_at: e.updated_at,
		}));
	}

	/**
	 * 删除两个节点之间特定类型的边。
	 */
	async deleteEdge(fromNodeId: string, toNodeId: string, type: GraphEdgeType): Promise<void> {
		const edgeId = GraphEdgeRepo.generateEdgeId(fromNodeId, toNodeId, type);
		await this.edgeRepo.deleteById(edgeId);
	}

	// ===== 基础图查询（基于 SQL 优化） =====

	/**
	 * 获取直接相邻的邻居节点 ID 列表（仅限出边）。
	 */
	async getNeighborIds(nodeId: string): Promise<string[]> {
		const edges = await this.getOutgoingEdges(nodeId);
		return edges.map((e) => e.to_node_id);
	}

	/**
	 * 获取与起始节点在 N 跳（Hop）以内的所有相关节点 ID。
	 * 采用广度优先搜索 (BFS)，每一步都通过高效的批处理 SQL 查询。
	 */
	async getRelatedNodeIds(startNodeId: string, maxHops: number = 2): Promise<Set<string>> {
		const visited = new Set<string>([startNodeId]);
		let frontier = new Set<string>([startNodeId]);

		for (let hop = 0; hop < maxHops; hop++) {
			const next = new Set<string>();
			// 一次性加载当前层级（frontier）所有节点的邻居，避免 N+1 查询问题
			const neighborMap = await this.edgeRepo.getNeighborIdsMap(Array.from(frontier));
			for (const [, neighbors] of neighborMap) {
				for (const neighborId of neighbors) {
					if (!visited.has(neighborId)) {
						visited.add(neighborId);
						next.add(neighborId);
					}
				}
			}
			frontier = next;
			if (!frontier.size) break;
		}

		visited.delete(startNodeId); // 结果不包含起始节点本身
		return visited;
	}

	// ===== 文档专用操作 (Document Operations) =====

	/**
	 * 将文档节点插入图。
	 */
	async upsertDocument(params: { id: string; path: string; docType?: string }): Promise<void> {
		await this.upsertNode({
			id: params.id,
			type: 'document',
			label: params.path,
			attributes: {
				path: params.path,
				docType: params.docType,
			},
		});
	}

	/**
	 * 处理 Markdown 文档并提取其中的关系（标签、双链、分类）。
	 * 所有的关系都会被实例化为节点和边持久化到数据库。
	 */
	async upsertMarkdownDocument(params: {
		id: string; // 通常是文档路径
		path: string;
		content: string; // Markdown 文本内容
		docType?: string;
		categories?: string[];
	}): Promise<void> {
		// 首先确保文档节点本身存在
		await this.upsertDocument({
			id: params.id,
			path: params.path,
			docType: params.docType,
		});

		// 提取并更新双链 (Wiki Links)
		const links = extractWikiLinks(params.content);
		for (const link of links) {
			const linkId = `link:${link}`;
			// 为被引用的目标创建一个 'link' 类型的节点（如果它还不是一个真正的文档）
			await this.upsertNode({
				id: linkId,
				type: 'link',
				label: link,
				attributes: {
					target: link,
					resolved: false,
				},
			});
			// 创建从当前文档到该链接的 'references' 连线
			await this.upsertEdge({
				fromNodeId: params.id,
				toNodeId: linkId,
				type: 'references',
				weight: 1.0,
			});
		}

		// 提取并更新标签 (Tags)
		const tags = extractTags(params.content);
		for (const tag of tags) {
			const tagId = `tag:${tag}`;
			// 创建标签节点
			await this.upsertNode({
				id: tagId,
				type: 'tag',
				label: tag,
				attributes: {
					tagName: tag,
				},
			});
			// 创建从当前文档到标签的 'tagged' 连线
			await this.upsertEdge({
				fromNodeId: params.id,
				toNodeId: tagId,
				type: 'tagged',
				weight: 1.0,
			});
		}

		// 如果提供了分类信息，也进行关联
		if (params.categories) {
			for (const category of params.categories) {
				const categoryId = `category:${category}`;
				await this.upsertNode({
					id: categoryId,
					type: 'category',
					label: category,
					attributes: {
						categoryName: category,
					},
				});
				await this.upsertEdge({
					fromNodeId: params.id,
					toNodeId: categoryId,
					type: 'categorized',
					weight: 1.0,
				});
			}
		}
	}

	/**
	 * 从图中移除文档节点。
	 * 注意：为了效率，相关的标签/分类节点会被保留，即使它们已经变为空节点（没有连线）。
	 */
	async removeDocument(id: string): Promise<void> {
		await this.deleteNode(id);
	}

	/**
	 * 获取 N 跳以内的相关文件路径。
	 * 这是为上层检索提供的包装方法，只返回 'document' 类型的节点路径。
	 */
	async getRelatedFilePaths(params: { currentFilePath: string; maxHops?: number }): Promise<Set<string>> {
		const relatedNodeIds = await this.getRelatedNodeIds(params.currentFilePath, params.maxHops ?? 2);
		// 在 SQL 层面过滤掉非文档节点（如标签、链接节点），避免加载无效数据
		const documentIds = await this.nodeRepo.getIdsByIdsAndTypes(Array.from(relatedNodeIds), ['document']);
		return new Set(documentIds);
	}

	/**
	 * 构建一个小型的子图预览，用于 UI 可视化展示。
	 * 限制节点数量以保证渲染性能。
	 */
	async getPreview(params: { currentFilePath: string; maxNodes?: number; maxHops?: number }): Promise<GraphPreview> {
		const maxNodes = params.maxNodes ?? 30; // 默认最多显示 30 个节点
		const maxHops = Math.max(0, Number(params.maxHops ?? 2));
		const startNode = await this.getNode(params.currentFilePath);
		if (!startNode) {
			return { nodes: [], edges: [] };
		}

		// 确定要包含在预览中的节点集合
		const keep = new Set<string>([params.currentFilePath]);
		let frontier = new Set<string>([params.currentFilePath]);
		for (let hop = 0; hop < maxHops; hop++) {
			const next = new Set<string>();
			const neighborMap = await this.edgeRepo.getNeighborIdsMap(Array.from(frontier));
			for (const [, neighbors] of neighborMap) {
				for (const nid of neighbors) {
					if (!keep.has(nid)) {
						keep.add(nid);
						next.add(nid);
					}
				}
			}
			frontier = next;
			if (!frontier.size) break;
		}

		// 加载节点详情并构建预览数组
		const nodes: GraphPreview['nodes'] = [];
		const nodeMap = await this.nodeRepo.getByIds(Array.from(keep));
		for (const [id, nodeRow] of nodeMap) {
			if (nodes.length >= maxNodes) break;
			const node = {
				id: nodeRow.id,
				type: nodeRow.type as GraphNodeType,
				label: nodeRow.label,
			};

			let label = node.label;
			// 标签类型的显示名称前缀加上 #
			if (node.type === 'tag') {
				label = `#${node.label}`;
			}

			nodes.push({ id, label, type: node.type });
		}

		// 构建这些节点之间的边
		const nodeSet = new Set(nodes.map((n) => n.id));
		const edges: GraphPreview['edges'] = [];
		const outgoingEdges = await this.edgeRepo.getByFromNodes(Array.from(nodeSet));
		for (const e of outgoingEdges) {
			// 只保留终点也在预览节点集中的边
			if (nodeSet.has(e.to_node_id)) {
				edges.push({
					from_node_id: e.from_node_id,
					to_node_id: e.to_node_id,
					weight: e.weight,
				});
			}
		}

		return { nodes, edges };
	}

	/**
	 * 批量获取多个文档关联的标签和分类。
	 * @returns Map<文档ID, { 标签列表, 分类列表 }>
	 */
	async getTagsAndCategoriesByDocIds(docIds: string[]): Promise<Map<string, { tags: string[]; categories: string[] }>> {
		const allTagCategoryEdge = await this.edgeRepo.getByFromNodesAndTypes(docIds, ['tagged', 'categorized']);
		const allTagCategoryNodeMap = await this.nodeRepo.getByIds(allTagCategoryEdge.map(edge => edge.to_node_id));

		const map = new Map<string, { tags: string[]; categories: string[] }>();
		for (const edge of allTagCategoryEdge) {
			const tagOrCategoryNode = allTagCategoryNodeMap.get(edge.to_node_id);
			if (!tagOrCategoryNode) continue;
			if (!map.has(edge.from_node_id)) {
				map.set(edge.from_node_id, { tags: [], categories: [] });
			}
			const docTagsAndCategories = map.get(edge.from_node_id)!;
			if (tagOrCategoryNode.type === 'tag') {
				docTagsAndCategories.tags.push(tagOrCategoryNode.label);
			} else if (tagOrCategoryNode.type === 'category') {
				docTagsAndCategories.categories.push(tagOrCategoryNode.label);
			}
		}
		return map;
	}
}
