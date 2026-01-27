import type { Kysely } from 'kysely';
import type { Database as DbSchema } from '../ddl';
import { generateStableUuid } from '@/core/utils/id-utils';

export type GraphEdge = DbSchema['graph_edges'];

/**
 * Graph Edge Repository
 * 
 * Manages the `graph_edges` table, which represents relationships between 
 * nodes in the knowledge graph. This repository handles the creation, 
 * updating, and analysis of connections (e.g., links between documents, 
 * tagging relationships). It also provides advanced graph analytics 
 * such as degree counting and orphan node detection.
 * 
 * 图边存储库
 * 
 * 管理 `graph_edges` 表，该表表示知识图谱中节点之间的关系。此存储库处理连接的
 * 创建、更新和分析（例如：文档之间的链接、贴标签关系）。它还提供高级图分析，
 * 如度数统计和孤点检测。
 */
export class GraphEdgeRepo {
	constructor(private readonly db: Kysely<DbSchema>) {}

	/**
	 * Generates a stable UUID for an edge based on its endpoints and relationship type.
	 * This ensures that a specific relationship between two nodes is unique and predictable.
	 * 
	 * 根据边的端点和关系类型生成稳定的 UUID。这确保了两个节点之间的特定关系是唯一且可预测的。
	 */
	static generateEdgeId(fromNodeId: string, toNodeId: string, type: string): string {
		// Import here to avoid circular dependencies
		return generateStableUuid(fromNodeId + toNodeId + type);
	}

	/**
	 * Checks if a graph edge exists by its unique identifier.
	 * 检查图边是否按其唯一标识符存在。
	 */
	async existsById(id: string): Promise<boolean> {
		const row = await this.db
			.selectFrom('graph_edges')
			.select('id')
			.where('id', '=', id)
			.executeTakeFirst();
		return row !== undefined;
	}

	/**
	 * Inserts a new graph edge record into the database.
	 * 向数据库插入新的图边记录。
	 */
	async insert(edge: {
		id: string;
		from_node_id: string;
		to_node_id: string;
		type: string;
		weight: number;
		attributes: string;
		created_at: number;
		updated_at: number;
	}): Promise<void> {
		await this.db
			.insertInto('graph_edges')
			.values(edge)
			.execute();
	}

	/**
	 * Updates properties of an existing graph edge.
	 * 更新现有图边的属性。
	 */
	async updateById(id: string, updates: Partial<Pick<DbSchema['graph_edges'], 'weight' | 'attributes' | 'updated_at'>>): Promise<void> {
		await this.db
			.updateTable('graph_edges')
			.set(updates)
			.where('id', '=', id)
			.execute();
	}

	/**
	 * Upserts a graph edge between two nodes. 
	 * Automatically generates an ID if one is not provided.
	 * 
	 * 插入或更新两个节点之间的图边。如果未提供 ID，则自动生成。
	 */
	async upsert(edge: {
		id?: string;
		from_node_id: string;
		to_node_id: string;
		type: string;
		weight?: number;
		attributes: string;
		created_at?: number;
		updated_at?: number;
	}): Promise<void> {
		const now = Date.now();
		const id = edge.id ?? GraphEdgeRepo.generateEdgeId(edge.from_node_id, edge.to_node_id, edge.type);

		const exists = await this.existsById(id);

		if (exists) {
			// Update existing edge | 更新现有边
			await this.updateById(id, {
				weight: edge.weight ?? 1.0,
				attributes: edge.attributes,
				updated_at: edge.updated_at ?? now,
			});
		} else {
			// Insert new edge | 插入新边
			await this.insert({
				id,
				from_node_id: edge.from_node_id,
				to_node_id: edge.to_node_id,
				type: edge.type,
				weight: edge.weight ?? 1.0,
				attributes: edge.attributes,
				created_at: edge.created_at ?? now,
				updated_at: edge.updated_at ?? now,
			});
		}
	}

	/**
	 * Retrieves full edge data by its ID.
	 * 按 ID 获取完整的边数据。
	 */
	async getById(id: string): Promise<DbSchema['graph_edges'] | null> {
		const row = await this.db.selectFrom('graph_edges').selectAll().where('id', '=', id).executeTakeFirst();
		return row ?? null;
	}

	/**
	 * Retrieves all outgoing edges for a specific node.
	 * 获取指定节点的所有传出边。
	 */
	async getByFromNode(fromNodeId: string): Promise<DbSchema['graph_edges'][]> {
		return await this.db.selectFrom('graph_edges').selectAll().where('from_node_id', '=', fromNodeId).execute();
	}

	/**
	 * Batch retrieves outgoing edges for multiple nodes.
	 * 批量获取多个节点的传出边。
	 */
	async getByFromNodes(fromNodeIds: string[]): Promise<DbSchema['graph_edges'][]> {
		if (!fromNodeIds.length) return [];
		return await this.db.selectFrom('graph_edges').selectAll().where('from_node_id', 'in', fromNodeIds).execute();
	}

	/**
	 * Batch retrieves relationships of specific types starting from multiple nodes.
	 * Useful for following specific link types in a graph traversal.
	 * 
	 * 批量检索从多个节点开始的特定类型的关系。在图遍历中追踪特定链接类型时非常有用。
	 */
	async getByFromNodesAndTypes(fromNodeIds: string[], types: string[]): Promise<{ to_node_id: string; from_node_id: string; }[]> {
		if (!fromNodeIds.length || !types.length) return [];
		const rows = await this.db
			.selectFrom('graph_edges')
			.select(['to_node_id', 'from_node_id'])
			.where('from_node_id', 'in', fromNodeIds)
			.where('type', 'in', types)
			.execute();
		return rows;
	}

	/**
	 * Calculates the in-degree (number of incoming connections) for multiple nodes, 
	 * optionally filtering by relationship type.
	 * 
	 * 计算多个节点的入度（传入连接的数量），可选按关系类型过滤。
	 * 
	 * @returns A Map of node_id -> count | 返回 node_id -> count 的映射
	 */
	async countInComingEdges(nodeIds: string[], type?: string): Promise<Map<string, number>> {
		const query = this.db
			.selectFrom('graph_edges')
			.select(({ fn }) => [
				fn.count<number>('id').as('count'),
				'to_node_id',
			])
			.where('to_node_id', 'in', nodeIds);

		if (type !== undefined) {
			query.where('type', '=', type);
		}

		const rows = await query
			.groupBy(['to_node_id'])
			.execute();
		const map = new Map<string, number>();
		for (const row of rows) {
			map.set(row.to_node_id, row.count);
		}
		return map;
	}

	/**
	 * Calculates the out-degree (number of outgoing connections) for multiple nodes, 
	 * optionally filtering by relationship type.
	 * 
	 * 计算多个节点的出度（传出连接的数量），可选按关系类型过滤。
	 * 
	 * @returns A Map of node_id -> count | 返回 node_id -> count 的映射
	 */
	async countOutgoingEdges(nodeIds: string[], type?: string): Promise<Map<string, number>> {
		const query = this.db
			.selectFrom('graph_edges')
			.select(({ fn }) => [
				fn.count<number>('id').as('count'),
				'from_node_id',
			])
			.where('from_node_id', 'in', nodeIds);

		if (type !== undefined) {
			query.where('type', '=', type);
		}

		const rows = await query
			.groupBy(['from_node_id'])
			.execute();
		const map = new Map<string, number>();
		for (const row of rows) {
			map.set(row.from_node_id, row.count);
		}
		return map;
	}

	/**
	 * Aggregates in-degree, out-degree, and total degree for a set of nodes.
	 * 汇总一组节点的入度、出度和总度数。
	 */
	async countEdges(nodeIds: string[], type?: string): Promise<{ incoming: Map<string, number>; outgoing: Map<string, number> , total: Map<string, number> }> {
		const incoming = await this.countInComingEdges(nodeIds, type);
		const outgoing = await this.countOutgoingEdges(nodeIds, type);
		const total = new Map<string, number>();
		for (const nodeId of nodeIds) {
			total.set(nodeId, (incoming.get(nodeId) ?? 0) + (outgoing.get(nodeId) ?? 0));
		}
		return { incoming, outgoing, total };
	}

	/**
	 * Retrieves a map of outgoing connections for multiple source nodes.
	 * Useful for building adjacency lists.
	 * 
	 * 检索多个源节点的传出连接图。对于构建邻接列表非常有用。
	 * 
	 * @returns node_id -> neighbor_id[]
	 */
	async getNeighborIdsMap(nodeIds: string[]): Promise<Map<string, string[]>> {
		if (!nodeIds.length) return new Map();
		const rows = await this.db
			.selectFrom('graph_edges')
			.select(['from_node_id', 'to_node_id'])
			.where('from_node_id', 'in', nodeIds)
			.execute();
		const out = new Map<string, string[]>();
		for (const r of rows) {
			const key = String(r.from_node_id);
			const arr = out.get(key) ?? [];
			arr.push(String(r.to_node_id));
			out.set(key, arr);
		}
		return out;
	}

	/**
	 * Retrieves all incoming edges for a specific node.
	 * 获取指定节点的所有传入边。
	 */
	async getByToNode(toNodeId: string): Promise<DbSchema['graph_edges'][]> {
		return await this.db.selectFrom('graph_edges').selectAll().where('to_node_id', '=', toNodeId).execute();
	}

	/**
	 * Retrieves all edges directly connecting two specific nodes.
	 * 获取直接连接两个特定节点的所有边。
	 */
	async getBetweenNodes(fromNodeId: string, toNodeId: string): Promise<DbSchema['graph_edges'][]> {
		const rows = await this.db
			.selectFrom('graph_edges')
			.selectAll()
			.where('from_node_id', '=', fromNodeId)
			.where('to_node_id', '=', toNodeId)
			.execute();
		return rows;
	}

	/**
	 * Retrieves all edges of a specific type across the entire graph.
	 * 获取整个图谱中特定类型的所有边。
	 */
	async getByType(type: string): Promise<DbSchema['graph_edges'][]> {
		return await this.db.selectFrom('graph_edges').selectAll().where('type', '=', type).execute();
	}

	/**
	 * Executes a custom WHERE clause against the edges table.
	 * Use caution as this bypasses the query builder's safety checks.
	 * 
	 * 针对边表执行自定义 WHERE 子句。请谨慎使用，因为这会绕过查询构建器的安全检查。
	 */
	async getByCustomWhere(whereClause: string): Promise<DbSchema['graph_edges'][]> {
		if (!whereClause.trim()) return [];
		const compiledQuery = {
			sql: `SELECT * FROM graph_edges WHERE ${whereClause}`,
			parameters: [],
			query: {} 
		} as any;
		const result = await this.db.executeQuery(compiledQuery);
		return result.rows as DbSchema['graph_edges'][];
	}

	/**
	 * Finds nodes that have no outgoing connections.
	 * 查找没有传出连接的节点。
	 */
	async getNodesWithZeroOutDegree(limit?: number): Promise<string[]> {
		let query = this.db
			.selectFrom('graph_nodes')
			.leftJoin('graph_edges', 'graph_nodes.id', 'graph_edges.from_node_id')
			.select('graph_nodes.id')
			.where('graph_edges.from_node_id', 'is', null);

		if (limit) {
			query = query.limit(limit);
		}

		const rows = await query.execute();
		return rows.map(row => row.id);
	}

	/**
	 * Finds nodes that have no incoming connections.
	 * 查找没有传入连接的节点。
	 */
	async getNodesWithZeroInDegree(limit?: number): Promise<string[]> {
		let query = this.db
			.selectFrom('graph_nodes')
			.leftJoin('graph_edges', 'graph_nodes.id', 'graph_edges.to_node_id')
			.select('graph_nodes.id')
			.where('graph_edges.to_node_id', 'is', null);

		if (limit) {
			query = query.limit(limit);
		}

		const rows = await query.execute();
		return rows.map(row => row.id);
	}

	/**
	 * Identifies "hard orphan" nodes: those with absolutely no incoming or outgoing connections.
	 * 识别“硬孤立”节点：绝对没有传入或传出连接的节点。
	 */
	async getHardOrphanNodeIds(limit?: number): Promise<string[]> {
		const zeroOutNodes = await this.getNodesWithZeroOutDegree(limit);
		const zeroInNodes = await this.getNodesWithZeroInDegree(limit);

		const zeroOutSet = new Set(zeroOutNodes);
		const hardOrphans = zeroInNodes.filter(nodeId => zeroOutSet.has(nodeId));

		return limit ? hardOrphans.slice(0, limit) : hardOrphans;
	}

	/**
	 * Retrieves orphan nodes. Alias for `getHardOrphanNodeIds`.
	 * 获取孤立节点。`getHardOrphanNodeIds` 的别名。
	 */
	async getHardOrphans(limit?: number): Promise<string[]> {
		// Get orphan node IDs first | 先获取孤立节点 ID
		const orphanIds = await this.getHardOrphanNodeIds(limit);

		if (orphanIds.length === 0) {
			return [];
		}

		return orphanIds;
	}

	/**
	 * Identifies nodes with very few connections (1-2 total).
	 * Currently a stub waiting for redundant degree fields in the schema.
	 * 
	 * 识别连接非常少的节点（总共 1-2 条）。当前为等待架构中冗余度数字段的占位实现。
	 */
	async getNodesWithLowDegree(maxConnections: number = 2, limit?: number): Promise<Array<{ nodeId: string; totalConnections: number }>> {
		// Temporary empty implementation until redundant fields are added | 在添加冗余字段之前的临时空实现
		return [];
	}

	/**
	 * Ranks nodes by their degree metrics.
	 * Returns the top N nodes by out-degree and in-degree respectively.
	 * 
	 * 按度数指标对节点进行排序。分别返回出度和入度前 N 名的节点。
	 */
	async getTopNodeIdsByDegree(limit?: number, nodeIdFilter?: string[]): Promise<{
		topByOutDegree: Array<{ nodeId: string; outDegree: number }>;
		topByInDegree: Array<{ nodeId: string; inDegree: number }>;
	}> {
		let outDegreeQuery = this.db
			.selectFrom('graph_edges')
			.select([
				'from_node_id as nodeId',
				({ fn }) => fn.count<number>('id').as('outDegree')
			])
			.groupBy('from_node_id')
			.orderBy('outDegree', 'desc');

		let inDegreeQuery = this.db
			.selectFrom('graph_edges')
			.select([
				'to_node_id as nodeId',
				({ fn }) => fn.count<number>('id').as('inDegree')
			])
			.groupBy('to_node_id')
			.orderBy('inDegree', 'desc');

		if (nodeIdFilter && nodeIdFilter.length > 0) {
			outDegreeQuery = outDegreeQuery.where('from_node_id', 'in', nodeIdFilter);
			inDegreeQuery = inDegreeQuery.where('to_node_id', 'in', nodeIdFilter);
		}

		if (limit !== undefined) {
			outDegreeQuery = outDegreeQuery.limit(limit);
			inDegreeQuery = inDegreeQuery.limit(limit);
		}

		const [outDegreeStats, inDegreeStats] = await Promise.all([
			outDegreeQuery.execute(),
			inDegreeQuery.execute()
		]);

		return {
			topByOutDegree: outDegreeStats,
			topByInDegree: inDegreeStats
		};
	}

	/**
	 * Deletes a specific edge by its ID.
	 * 按 ID 删除特定边。
	 */
	async deleteById(id: string): Promise<void> {
		await this.db.deleteFrom('graph_edges').where('id', '=', id).execute();
	}

	/**
	 * Deletes all outgoing edges from a specific node.
	 * 删除来自特定节点的所有传出边。
	 */
	async deleteByFromNode(fromNodeId: string): Promise<void> {
		await this.db.deleteFrom('graph_edges').where('from_node_id', '=', fromNodeId).execute();
	}

	/**
	 * Deletes all incoming edges to a specific node.
	 * 删除指向特定节点的所有传入边。
	 */
	async deleteByToNode(toNodeId: string): Promise<void> {
		await this.db.deleteFrom('graph_edges').where('to_node_id', '=', toNodeId).execute();
	}

	/**
	 * Deletes all edges directly connecting two specific nodes.
	 * 删除直接连接两个特定节点的所有边。
	 */
	async deleteBetweenNodes(fromNodeId: string, toNodeId: string): Promise<void> {
		await this.db.deleteFrom('graph_edges').where('from_node_id', '=', fromNodeId).where('to_node_id', '=', toNodeId).execute();
	}

	/**
	 * Deletes all edges of a specific type.
	 * 删除特定类型的所有边。
	 */
	async deleteByType(type: string): Promise<void> {
		await this.db.deleteFrom('graph_edges').where('type', '=', type).execute();
	}

	/**
	 * Deletes all edges (incoming or outgoing) associated with any of the given node IDs.
	 * 删除与任何给定节点 ID 关联的所有边（传入或传出）。
	 */
	async deleteByNodeIds(nodeIds: string[]): Promise<void> {
		if (!nodeIds.length) return;
		await this.db
			.deleteFrom('graph_edges')
			.where((eb) => eb.or([eb('from_node_id', 'in', nodeIds), eb('to_node_id', 'in', nodeIds)]))
			.execute();
	}

	/**
	 * Retrieves a sample of edges for a node across all its relationship types.
	 * Uses SQLite window functions to ensure diversity by limiting results 
	 * to a maximum number of edges PER type.
	 * 
	 * 检索节点跨其所有关系类型的边样本。使用 SQLite 窗口函数通过限制
	 * 每种类型的最大边数来确保多样性。
	 * 
	 * @param nodeId - The context node | 上下文节点
	 * @param limitPerType - Max edges per group | 每个组的最大边数
	 * @param typesExclude - Optional list of types to ignore | 可选的忽略类型列表
	 */
	async getAllEdgesForNode(
		nodeId: string,
		limitPerType: number,
		typesExclude?: string[]
	): Promise<GraphEdge[]> {
		const query = this.db
			.with('ranked_edges', (qb) => {
				let baseQb = qb
					.selectFrom('graph_edges')
					.select([
						'id',
						'from_node_id',
						'to_node_id',
						'type',
						'weight',
						'attributes',
						'created_at',
						'updated_at',
						this.db.fn.agg<number>('row_number').over((ob) =>
							ob.partitionBy('type').orderBy('updated_at', 'desc')
						).as('type_rank')
					])
					.where((eb) =>
						eb.or([
							eb('from_node_id', '=', nodeId),
							eb('to_node_id', '=', nodeId)
						])
					);

				if (typesExclude && typesExclude.length > 0) {
					baseQb = baseQb.where('type', 'not in', typesExclude);
				}

				return baseQb;
			})
			.selectFrom('ranked_edges')
			.selectAll()
			.where('type_rank', '<=', limitPerType)
			.orderBy('updated_at', 'desc');

		return await query.execute();
	}


	/**
	 * Identifies the most frequently used tags by counting "tagged" relationships.
	 * 通过统计“已标记”关系识别最常用的标签。
	 */
	async getTopTaggedNodes(limit: number = 50): Promise<Array<{ tagId: string; count: number }>> {
		return await this.db
			.selectFrom('graph_edges')
			.select([
				'to_node_id as tagId',
				({ fn }) => fn.count<number>('id').as('count')
			])
			.where('type', '=', 'tagged')
			.groupBy('to_node_id')
			.orderBy('count', 'desc')
			.limit(limit)
			.execute();
	}

	/**
	 * Clears the entire edges table.
	 * 清空整个边表。
	 */
	async deleteAll(): Promise<void> {
		await this.db.deleteFrom('graph_edges').execute();
	}
}

