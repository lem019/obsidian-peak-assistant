/**
 * ============================================================================
 * 文件说明: ResourceSummaryService.ts - 资源摘要服务
 * ============================================================================
 * 
 * 【这个文件是干什么的】
 * 这个文件负责管理"资源摘要笔记"。当你在 AI 对话中引用了某个文件、网页或其他资源时，
 * 这个服务会自动创建一个独立的笔记来记录这个资源的摘要信息，并建立双向链接。
 * 
 * 【起了什么作用】
 * 1. 资源索引：为每个引用的资源（文件/URL/附件）创建唯一的摘要笔记
 * 2. 双向链接：记录"哪些对话/项目引用了这个资源"以及"这个资源被引用在哪里"
 * 3. 内容摘要：存储 AI 生成的资源摘要（短摘要和完整摘要）
 * 4. 统一管理：所有资源摘要都存放在一个专门的文件夹中，便于管理和检索
 * 
 * 【举例介绍】
 * 场景 1：你在对话中上传了一张图片 `diagram.png`
 * - 服务会创建一个笔记：`Resources/Resource-abc123.md`
 * - 笔记内容包含：图片的摘要、分类（image）、引用它的对话列表
 * - 你可以在资源笔记中看到"这张图片在哪些对话中被讨论过"
 * 
 * 场景 2：你在项目中引用了一个网页 URL
 * - 服务会为这个 URL 创建资源笔记
 * - AI 会生成网页内容的摘要存入笔记
 * - 你可以通过资源笔记快速了解这个网页讲了什么，以及哪些项目使用了它
 * 
 * 场景 3：资源被多个对话引用
 * - 同一个文件可能在多个对话中被讨论
 * - 资源笔记会自动维护一个"提及列表"，记录所有引用位置
 * - 这样你就能看到这个资源的"使用历史"
 * 
 * 【技术实现】
 * - 使用 Frontmatter（YAML）存储结构化元数据
 * - 资源 ID 基于 source（文件路径/URL）的哈希值生成，保证唯一性
 * - 支持多种资源类型：note（笔记）、image（图片）、attachment（附件）、url（网页）等
 * - 自动维护双向链接关系（资源 ↔ 对话/项目）
 * ============================================================================
 */

import { App, normalizePath, TFile, TFolder } from 'obsidian';
import { buildFrontmatter, codeBlock } from '@/core/utils/markdown-utils';
import { stringifyYaml } from 'obsidian';
import type { ChatResourceRef, ResourceSummaryMeta, ParsedResourceSummaryFile } from '../types';
import type { ResourceKind } from '@/core/document/types';
import { parseFrontmatter } from '@/core/utils/markdown-utils';
import { ensureFolder } from '@/core/utils/vault-utils';
import { ResourceKindDetector } from '@/core/document/resource/helper/ResourceKindDetector';
import { hashString } from '@/core/utils/hash-utils';

/**
 * Service for managing resource summary notes.
 * Creates and updates markdown files that summarize resources (files, URLs, etc.)
 * and maintain bidirectional links between resources and conversations/projects.
 * 
 * 资源摘要服务类
 * 负责为对话中引用的所有资源创建和管理专门的摘要笔记。
 */
export class ResourceSummaryService {
	private readonly resourcesFolder: string;
	private readonly kindDetector: ResourceKindDetector;

	constructor(
		private readonly app: App,
		rootFolder: string,
		resourcesSummaryFolderName: string
	) {
		this.resourcesFolder = normalizePath(`${resourcesSummaryFolderName}`);
		this.kindDetector = new ResourceKindDetector(app);
	}

	/**
	 * Initialize resources folder
	 */
	async init(): Promise<void> {
		await ensureFolder(this.app, this.resourcesFolder);
	}

	/**
	 * Create or get resource reference from source
	 */
	createResourceRef(source: string, summaryNotePath?: string): ChatResourceRef {
		const id = this.generateResourceId(source);
		const kind = this.kindDetector.detectResourceKind(source);
		return {
			source,
			id,
			kind,
			summaryNotePath,
		};
	}

	/**
	 * Get resource summary note file path
	 */
	getResourceSummaryPath(resourceId: string): string {
		return normalizePath(`${this.resourcesFolder}/Resource-${resourceId}.md`);
	}

	/**
	 * Create or update resource summary note
	 */
	async saveResourceSummary(params: {
		resourceId: string;
		source: string;
		kind: ResourceKind;
		title?: string;
		shortSummary?: string;
		fullSummary?: string;
		mentionedInConversations?: string[];
		mentionedInProjects?: string[];
		mentionedInFiles?: string[];
	}): Promise<TFile> {
		const path = this.getResourceSummaryPath(params.resourceId);
		const existingFile = this.app.vault.getAbstractFileByPath(path) as TFile | null;

		const meta: ResourceSummaryMeta = {
			id: params.resourceId,
			source: params.source,
			kind: params.kind,
			title: params.title,
			shortSummary: params.shortSummary,
			fullSummary: params.fullSummary,
			lastUpdatedTimestamp: Date.now(),
			mentionedInConversations: params.mentionedInConversations ?? [],
			mentionedInProjects: params.mentionedInProjects ?? [],
			mentionedInFiles: params.mentionedInFiles ?? [],
		};

		const markdown = this.buildResourceSummaryMarkdown(meta);
		return this.writeFile(existingFile, path, markdown);
	}

	/**
	 * Read resource summary note
	 */
	async readResourceSummary(resourceId: string): Promise<ParsedResourceSummaryFile | null> {
		const path = this.getResourceSummaryPath(resourceId);
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			return null;
		}

		const raw = await this.app.vault.read(file);
		const frontmatter = parseFrontmatter<Record<string, unknown>>(raw);
		if (!frontmatter) {
			return null;
		}

		const meta: ResourceSummaryMeta = {
			id: String(frontmatter.data.id ?? resourceId),
			source: String(frontmatter.data.source ?? ''),
			kind: (frontmatter.data.kind as ResourceKind) || 'other',
			title: frontmatter.data.title ? String(frontmatter.data.title) : undefined,
			shortSummary: frontmatter.data.shortSummary ? String(frontmatter.data.shortSummary) : undefined,
			fullSummary: frontmatter.data.fullSummary ? String(frontmatter.data.fullSummary) : undefined,
			lastUpdatedTimestamp: Number(frontmatter.data.lastUpdatedTimestamp ?? Date.now()),
			mentionedInConversations: Array.isArray(frontmatter.data.mentionedInConversations)
				? frontmatter.data.mentionedInConversations.map(String)
				: [],
			mentionedInProjects: Array.isArray(frontmatter.data.mentionedInProjects)
				? frontmatter.data.mentionedInProjects.map(String)
				: [],
			mentionedInFiles: Array.isArray(frontmatter.data.mentionedInFiles)
				? frontmatter.data.mentionedInFiles.map(String)
				: [],
		};

		return {
			meta,
			content: frontmatter.body,
			file,
		};
	}

	/**
	 * Get all resource summaries
	 */
	async listResourceSummaries(): Promise<ParsedResourceSummaryFile[]> {
		const folder = this.app.vault.getAbstractFileByPath(this.resourcesFolder);
		if (!(folder instanceof TFolder)) {
			return [];
		}

		const results: ParsedResourceSummaryFile[] = [];
		for (const child of folder.children) {
			if (child instanceof TFile && child.name.startsWith('Resource-') && child.extension === 'md') {
				const resourceId = child.basename.replace(/^Resource-/, '');
				const parsed = await this.readResourceSummary(resourceId);
				if (parsed) {
					results.push(parsed);
				}
			}
		}
		return results;
	}

	/**
	 * Generate a stable resource ID from source string
	 */
	private generateResourceId(source: string): string {
		// Use hash utility for stable ID generation
		return hashString(source, 8);
	}

	/**
	 * Build markdown content for resource summary note
	 */
	private buildResourceSummaryMarkdown(meta: ResourceSummaryMeta): string {
		const frontmatter = buildFrontmatter(meta);
		const sections: string[] = [];

		// Original resource reference section
		sections.push('# Original Resource');
		sections.push('## Resource Link');

		// Reference the original resource based on kind
		if (meta.kind === 'url') {
			sections.push(`[${meta.source}](${meta.source})`);
		} else if (meta.kind === 'tag') {
			sections.push(`Tag: ${meta.source}`);
		} else if (meta.kind === 'folder' || meta.kind === 'markdown') {
			// Use wikilink for vault files
			const normalizedPath = meta.source.replace(/^\[\[|\]\]$/g, '');
			sections.push(`[[${normalizedPath}]]`);
		} else {
			// For other types, try to use wikilink if it looks like a path
			if (meta.source.includes('/') && !meta.source.includes('://')) {
				sections.push(`[[${meta.source}]]`);
			} else {
				sections.push(meta.source);
			}
		}

		// Summary section
		sections.push('# Summary');
		sections.push('## meta');
		sections.push(
			codeBlock('resource-summary-meta', stringifyYaml({
				id: meta.id,
				kind: meta.kind,
				lastUpdatedTimestamp: meta.lastUpdatedTimestamp,
			}))
		);
		sections.push('## short');
		sections.push(meta.shortSummary || 'No summary available yet.');
		if (meta.fullSummary) {
			sections.push('## full');
			sections.push(meta.fullSummary);
		}

		// References section - links to conversations and projects that use this resource
		const convLinks = (meta.mentionedInConversations || []).map(id => {
			// We don't know the exact file path here, so we'll use a placeholder
			// In practice, this should be resolved by the caller or during migration
			return `- Conversation: ${id}`;
		});
		const projLinks = (meta.mentionedInProjects || []).map(id => {
			return `- Project: ${id}`;
		});

		// File references
		const fileLinks = (meta.mentionedInFiles || []).map(path => {
			return `- [[${path}]]`;
		});

		if (convLinks.length > 0 || projLinks.length > 0 || fileLinks.length > 0) {
			sections.push('# Referenced In');
			if (convLinks.length > 0) {
				sections.push('## Conversations');
				sections.push(convLinks.join('\n'));
			}
			if (projLinks.length > 0) {
				sections.push('## Projects');
				sections.push(projLinks.join('\n'));
			}
			if (fileLinks.length > 0) {
				sections.push('## Files');
				sections.push(fileLinks.join('\n'));
			}
		}

		return `${frontmatter}${sections.join('\n\n')}\n`;
	}

	/**
	 * Write file to vault
	 */
	private async writeFile(file: TFile | null, path: string, content: string): Promise<TFile> {
		if (file) {
			await this.app.vault.modify(file, content);
			return file;
		}
		return this.app.vault.create(path, content);
	}

}

