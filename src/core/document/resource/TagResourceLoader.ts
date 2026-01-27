/**
 * @file TagResourceLoader.ts
 * @description 标签资源加载器，将 Obsidian 标签作为特定的搜索/上下文资源进行管理
 */

import type { ResourceLoader, ResourceSummary, ResourceKind } from '@/core/document/types';

/**
 * Tag Resource Loader
 * 
 * Manages Obsidian tags as specific search/context resources. 
 * Allows the system to treat a tag (e.g., #todo) as a source for summaries or 
 * organizational data.
 * 
 * 标签资源加载器
 * 
 * 将 Obsidian 标签作为特定的搜索/上下文资源进行管理。
 * 允许系统将标签（例如 #todo）视为摘要或组织数据的来源。
 */
export class TagResourceLoader implements ResourceLoader {
	/**
	 * Returns the type of resource: 'tag'.
	 * 返回资源类型：'tag'。
	 */
	getResourceType(): ResourceKind {
		return 'tag';
	}

	/**
	 * Generates a basic summary for the tag resource.
	 * (TODO: Future implementation could list documents associated with this tag).
	 * 
	 * 为标签资源生成基础摘要。
	 * （TODO：未来的实现可能会列出与此标签关联的文档）。
	 */
	async getSummary(
		source: string | any,
		provider: string,
		modelId: string
	): Promise<ResourceSummary> {
		// Normalize tag name by removing the '#' prefix
		const sourceStr = typeof source === 'string' ? source : '';
		const tagName = sourceStr.replace(/^#/, '');
		
		return {
			shortSummary: `Tag: ${tagName}`,
			fullSummary: `This is a tag resource for "${tagName}". Tags are used to categorize and organize content in the vault.`,
		};
	}
}

