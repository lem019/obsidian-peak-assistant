import type { Kysely } from 'kysely';
import type { Database as DbSchema } from '../ddl';

export type GraphNode = DbSchema['graph_nodes'];

/**
 * Graph Node Repository
 * 
 * Manages the `graph_nodes` table, which stores entities within the knowledge graph. 
 * Nodes can represent documents, tags, categories, or any other distinct entity. 
 * This repository handles the lifecycle of these nodes (upsert, retrieval, deletion).
 * 
 * 图节点存储库
 * 
 * 管理 `graph_nodes` 表，该表存储知识图谱中的实体。节点可以表示文档、标签、分类
 * 或任何其他不同的实体。此存储库处理这些节点的生命周期（插入或更新、检索、删除）。
 */
export class GraphNodeRepo {
	constructor(private readonly db: Kysely<DbSchema>) {}

	/**
	 * Checks if a graph node exists by its unique identifier.
	 * 检查图节点是否按其唯一标识符存在。
	 */
	async existsById(id: string): Promise<boolean> {
		const row = await this.db
			.selectFrom('graph_nodes')
			.select('id')
			.where('id', '=', id)
			.executeTakeFirst();
		return row !== undefined;
	}

	/**
	 * Inserts a new graph node record.
	 * 插入新的图节点记录。
	 */
	async insert(node: {
		id: string;
		type: string;
		label: string;
		attributes: string;
		created_at: number;
		updated_at: number;
	}): Promise<void> {
		await this.db
			.insertInto('graph_nodes')
			.values(node)
			.execute();
	}

	/**
	 * Updates the properties of an existing graph node.
	 * 更新现有图节点的属性。
	 */
	async updateById(id: string, updates: Partial<Pick<DbSchema['graph_nodes'], 'type' | 'label' | 'attributes' | 'updated_at'>>): Promise<void> {
		await this.db
			.updateTable('graph_nodes')
			.set(updates)
			.where('id', '=', id)
			.execute();
	}

	/**
	 * Upserts a graph node. If a node with the given ID exists, it updates it; 
	 * otherwise, it inserts a new record.
	 * 
	 * 插入或更新图节点。如果给定 ID 的节点存在，则更新它；否则，插入一条新记录。
	 *
	 * @param node.id - Unique identifier (e.g., document path, tag name) | 唯一标识符（例如：文档路径、标签名）
	 */
	async upsert(node: {
		id: string;
		type: string;
		label: string;
		attributes: string;
		created_at?: number;
		updated_at?: number;
	}): Promise<void> {
		const now = Date.now();
		const exists = await this.existsById(node.id);

		if (exists) {
			// Update existing node | 更新现有节点
			await this.updateById(node.id, {
				type: node.type,
				label: node.label,
				attributes: node.attributes,
				updated_at: node.updated_at ?? now,
			});
		} else {
			// Insert new node | 插入新节点
			await this.insert({
				id: node.id,
				type: node.type,
				label: node.label,
				attributes: node.attributes,
				created_at: node.created_at ?? now,
				updated_at: node.updated_at ?? now,
			});
		}
	}

	/**
	 * Retrieves full node data by ID.
	 * 按 ID 获取完整的节点数据。
	 */
	async getById(id: string): Promise<DbSchema['graph_nodes'] | null> {
		const row = await this.db.selectFrom('graph_nodes').selectAll().where('id', '=', id).executeTakeFirst();
		return row ?? null;
	}

	/**
	 * Batch retrieves nodes and returns them as a Map for efficient lookup.
	 * 批量检索节点并将其作为 Map 返回，以便高效查找。
	 */
	async getByIds(ids: string[]): Promise<Map<string, GraphNode>> {
		if (!ids.length) return new Map();
		const rows = await this.db.selectFrom('graph_nodes').selectAll().where('id', 'in', ids).execute();
		const result = new Map<string, GraphNode>();
		for (const row of rows) {
			result.set(row.id, row);
		}
		return result;
	}

	/**
	 * Retrieves all nodes of a specific type (e.g., all "document" nodes).
	 * 获取特定类型的所有节点（例如：所有“文档”节点）。
	 */
	async getByType(type: string): Promise<DbSchema['graph_nodes'][]> {
		return await this.db.selectFrom('graph_nodes').selectAll().where('type', '=', type).execute();
	}

	/**
	 * Retrieves nodes matching a specific type and set of labels.
	 * 获取匹配特定类型和一组标签的节点。
	 */
	async getByTypeAndLabels(type: string, labels: string[]): Promise<DbSchema['graph_nodes'][]> {
		if (!labels.length) return [];
		return await this.db
			.selectFrom('graph_nodes')
			.selectAll()
			.where('type', '=', type)
			.where('label', 'in', labels)
			.execute();
	}

	/**
	 * Batch filters node IDs based on a list of IDs and their types.
	 * Returns only IDs that match both criteria.
	 * 
	 * 基于 ID 列表及其类型批量过滤节点 ID。仅返回匹配这两个条件的 ID。
	 */
	async getIdsByIdsAndTypes(ids: string[], types: string[]): Promise<string[]> {
		if (!ids.length || !types.length) return [];
		const rows = await this.db
			.selectFrom('graph_nodes')
			.select(['id'])
			.where('id', 'in', ids)
			.where('type', 'in', types)
			.execute();
		return rows.map((row) => row.id);
	}

	/**
	 * Deletes a graph node by its ID.
	 * 按 ID 删除图节点。
	 */
	async deleteById(id: string): Promise<void> {
		await this.db.deleteFrom('graph_nodes').where('id', '=', id).execute();
	}

	/**
	 * Batch deletes graph nodes.
	 * 批量删除图节点。
	 */
	async deleteByIds(ids: string[]): Promise<void> {
		if (!ids.length) return;
		await this.db.deleteFrom('graph_nodes').where('id', 'in', ids).execute();
	}

	/**
	 * Deletes every node in the knowledge graph. Use with caution.
	 * 删除知识图谱中的每个节点。请谨慎使用。
	 */
	async deleteAll(): Promise<void> {
		await this.db.deleteFrom('graph_nodes').execute();
	}

	/**
	 * Deletes all nodes belonging to a specific type.
	 * 删除属于特定类型的所有节点。
	 */
	async deleteByType(type: string): Promise<void> {
		await this.db.deleteFrom('graph_nodes').where('type', '=', type).execute();
	}
}

