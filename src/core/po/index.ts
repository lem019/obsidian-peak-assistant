
/**
 * @file index.ts
 * @description 持久化对象 (PO) 类型定义的统一导出
 */

/**
 * Persistent Object (PO) type definitions for database tables.
 * 数据库表的持久化对象（PO）类型定义
 */
export type { DocumentMetaPO } from './document-meta.po';
export type { EmbeddingPO } from './embedding.po';
export type { DocStatisticsPO } from './doc-statistics.po';
// @deprecated OramaDocumentPO has been moved to _deprecated and will be removed
// export type { OramaDocumentPO } from './orama-document.po';
export type * from './graph.po';

