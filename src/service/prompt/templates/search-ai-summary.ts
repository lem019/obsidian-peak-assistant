/**
 * ============================================================================
 * AI search summary prompt for search results.
 * 搜索结果 AI 摘要生成提示词
 * ============================================================================
 * 
 * 【模板作用】
 * 将多条搜索结果整合成一个简洁、高质量的 AI 摘要回答。
 * 就像一个智能秘书，从大量资料中提取关键信息，给你一个精练的答案。
 * 
 * 【输入变量】
 * - query: 用户的搜索查询（必需）
 * - sources: 搜索结果数组，每项包含 title、path、snippet（必需）
 * - webEnabled: 是否启用了网络搜索（可选）
 * - userPreferences: 用户偏好（可选）
 * - graphContext: 知识图谱上下文（可选）
 * 
 * 【使用场景】
 * 用户在 AI Search 模式下搜索时，系统会：
 * 1. 执行混合搜索（全文 + 向量 + 元数据）
 * 2. 将搜索结果传给这个模板
 * 3. AI 生成一个综合性的回答
 * 
 * 【样例输入】
 * ```typescript
 * {
 *   query: "React Hooks 怎么用？",
 *   sources: [
 *     { title: "React 学习笔记", path: "notes/react.md", snippet: "useState 用于状态管理..." },
 *     { title: "Hooks 最佳实践", path: "docs/hooks.md", snippet: "useEffect 用于副作用..." }
 *   ],
 *   webEnabled: true,
 *   graphContext: "React, useState, useEffect, 组件"
 * }
 * ```
 * 
 * 【样例输出】
 * ```
 * React Hooks 是 React 16.8 引入的特性。根据你的笔记：
 * 
 * 1. **useState**：用于状态管理（来源：notes/react.md）
 * 2. **useEffect**：用于处理副作用（来源：docs/hooks.md）
 * 
 * 关联概念：React 组件化、状态管理、生命周期
 * ```
 * ============================================================================
 */
export const template = `User question: {{query}}

{{#if webEnabled}}
Web search is enabled (if you have web results, incorporate them).
{{/if}}

{{#if userPreferences}}
User preferences: {{userPreferences}}
{{/if}}

Sources (snippets):
{{#each sources}}
- {{title}} ({{path}}){{#if snippet}}
  {{snippet}}{{/if}}
{{/each}}

{{#if graphContext}}
Knowledge Graph (related concepts):
{{graphContext}}
{{/if}}

Task: Provide a concise, high-signal answer. Cite sources by file path when appropriate.`;

export const expectsJson = false;
