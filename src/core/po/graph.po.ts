/**
 * @file graph.po.ts
 * @description 知识图谱持久化对象，定义图谱节点和边的数据结构
 */

/**
 * Graph node type enumeration.
 * 图谱节点类型枚举
 */
export type GraphNodeType =
	| 'document' // Document nodes （文档节点）
	| 'tag' // Tag nodes （标签节点）
	| 'category' // Category nodes （分类节点）
	| 'resource' // Resource nodes (images, files, etc.) （资源节点：图片、文件等）
	| 'link' // Link nodes (wiki links, unresolved references) （链接节点：wiki链接、未解析引用）
	| 'concept' // Concept nodes (extracted concepts) （概念节点：提取的概念）
	| 'person' // Person nodes (from metadata) （人物节点：来自元数据）
	| 'project' // Project nodes （项目节点）
	| 'custom'; // Custom node types （自定义节点类型）

/**
 * Graph edge type enumeration.
 * 图谱边类型枚举
 */
export type GraphEdgeType =
	| 'references' // Document references document （文档引用文档）
	| 'tagged' // Document is tagged with tag （文档被标签标记）
	| 'categorized' // Document belongs to category （文档属于分类）
	| 'contains' // Document/resource contains resource （文档/资源包含资源）
	| 'related' // General related relationship （一般相关关系）
	| 'part_of' // Part-of relationship （部分-整体关系）
	| 'depends_on' // Dependency relationship （依赖关系）
	| 'similar' // Similarity relationship （相似关系）
	| 'custom'; // Custom relationship types （自定义关系类型）

/**
 * Graph node PO (Persistent Object).
 * Represents a node in the knowledge graph.
 * 
 * 图谱节点持久化对象
 * 表示知识图谱中的一个节点
 */
export interface GraphNodePO {
	/**
	 * Unique node identifier.
	 * Format depends on node type:
	 * - document: document ID (from Document.id)
	 * - tag: "tag:${tagName}"
	 * - category: "category:${categoryName}"
	 * - resource: resource identifier
	 * - link: "link:${target}"
	 * 
	 * 唯一节点标识符
	 * 格式依赖于节点类型：
	 * - document: 文档 ID（来自 Document.id）
	 * - tag: "tag:${tagName}"
	 * - category: "category:${categoryName}"
	 * - resource: 资源标识符
	 * - link: "link:${target}"
	 */
	id: string;
	/**
	 * Node type.
	 * 节点类型
	 */
	type: GraphNodeType;
	/**
	 * Node label/name for display.
	 * 节点标签/名称（用于显示）
	 */
	label: string;
	/**
	 * Node attributes (stored as JSON string).
	 * Contains type-specific data.
	 * 
	 * 节点属性（存储为 JSON 字符串）
	 * 包含类型特定数据
	 */
	attributes: string;
	/**
	 * Creation timestamp.
	 * 创建时间戳
	 */
	created_at: number;
	/**
	 * Last update timestamp.
	 * 最后更新时间戳
	 */
	updated_at: number;
}

/**
 * Graph edge PO (Persistent Object).
 * Represents an edge (relationship) in the knowledge graph.
 * 
 * 图谱边持久化对象
 * 表示知识图谱中的一条边（关系）
 */
export interface GraphEdgePO {
	/**
	 * Unique edge identifier.
	 * Format: "${fromNodeId}->${toNodeId}:${type}"
	 */
	id: string;
	/**
	 * Source node ID.
	 */
	from_node_id: string;
	/**
	 * Target node ID.
	 */
	to_node_id: string;
	/**
	 * Edge type.
	 */
	type: GraphEdgeType;
	/**
	 * Edge weight (for ranking/scoring).
	 */
	weight: number;
	/**
	 * Edge attributes (stored as JSON string).
	 * Contains type-specific data.
	 */
	attributes: string;
	/**
	 * Creation timestamp.
	 */
	created_at: number;
	/**
	 * Last update timestamp.
	 */
	updated_at: number;
}

/**
 * Document node attributes.
 */
export interface DocumentNodeAttributes {
	path: string;
	docType?: string;
}

/**
 * Tag node attributes.
 */
export interface TagNodeAttributes {
	tagName: string;
}

/**
 * Category node attributes.
 */
export interface CategoryNodeAttributes {
	categoryName: string;
}

/**
 * Resource node attributes.
 */
export interface ResourceNodeAttributes {
	resourceType: string;
	resourcePath?: string;
	resourceUrl?: string;
}

/**
 * Link node attributes.
 */
export interface LinkNodeAttributes {
	target: string;
	resolved?: boolean;
}

/**
 * Reference edge attributes.
 */
export interface ReferenceEdgeAttributes {
	context?: string; // Context where the reference appears
}

/**
 * Tagged edge attributes.
 */
export interface TaggedEdgeAttributes {
	count?: number; // Number of times tagged
}

/**
 * Contains edge attributes.
 */
export interface ContainsEdgeAttributes {
	position?: number; // Position/index in container
}

