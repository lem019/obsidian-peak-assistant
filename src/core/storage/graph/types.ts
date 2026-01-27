/**
 * @file types.ts
 * @description 图数据相关的类型定义。
 * 
 * ## 核心职能
 * 本文件定义了用于前端展示和图分析的中间数据结构。它将复杂的数据库持久化对象 (PO) 简化为更适合 UI 渲染或内存计算的轻量级接口。
 * 
 * ## 在项目中的角色
 * 充当了“视图模型 (ViewModel)”的角色。它规定了图预览组件（Graph Preview）需要哪些数据，确保前后端数据交换的一致性。
 * 
 * ## 生活化类比
 * 就像一张旅游地图。真实的城市（数据库）有无数的细节（路灯、井盖、住户名），但旅游地图只标注你关心的景点（节点）和主要路线（边）。
 */

import type { GraphNodePO, GraphEdgePO } from '@/core/po/graph.po';

/**
 * 用于 UI 展示的图预览结果。
 * 直接基于持久化对象类型，但仅提取展示所需的字段。
 */
export interface GraphPreview {
	/** 节点列表：包含 ID、标签和类型 */
	nodes: Pick<GraphNodePO, 'id' | 'label' | 'type'>[];
	/** 边列表：包含起点 ID、终点 ID 和权重 */
	edges: Pick<GraphEdgePO, 'from_node_id' | 'to_node_id' | 'weight'>[];
}

/**
 * 构建图预览所需的参数。
 */
export interface GraphPreviewParams {
	/**
	 * 起始节点 ID 或起始文件路径。
	 */
	startNodeId: string;
	/**
	 * 预览中允许包含的最大节点数（用于性能控制）。
	 */
	maxNodes?: number;
}


