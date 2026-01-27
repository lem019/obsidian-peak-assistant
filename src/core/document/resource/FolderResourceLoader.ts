/**
 * @file FolderResourceLoader.ts
 * @description 文件夹资源加载器，将 Obsidian 文件夹作为资源进行结构分析
 */

import type { App } from 'obsidian';
import { TFile, TFolder } from 'obsidian';
import type { ResourceLoader, ResourceSummary, ResourceKind } from '@/core/document/types';

/**
 * Folder Resource Loader
 * 
 * Handles Obsidian folders as a type of resource. Unlike file loaders, this 
 * performs structural analysis of the content within a folder to provide 
 * context for the AI or user.
 * 
 * 文件夹资源加载器
 * 
 * 将 Obsidian 文件夹作为一种资源进行处理。与文件加载器不同，
 * 它对文件夹内的内容进行结构分析，为 AI 或用户提供上下文。
 */
export class FolderResourceLoader implements ResourceLoader {
	constructor(private readonly app: App) {}

	/**
	 * Returns the type of resource: 'folder'.
	 * 返回资源类型：'folder'。
	 */
	getResourceType(): ResourceKind {
		return 'folder';
	}

	/**
	 * Currently generates a basic summary of the folder's file and subfolder counts.
	 * (TODO: Future implementation might perform semantic analysis of folder contents).
	 * 
	 * 目前生成文件夹的文件和子文件夹数量的基础摘要。
	 * （TODO：未来的实现可能会对文件夹内容进行语义分析）。
	 * 
	 * @param source - Folder path (can be a wikilink [[path]] or raw path). | 文件夹路径。
	 */
	async getSummary(
		source: string | any,
		provider: string,
		modelId: string
	): Promise<ResourceSummary> {
		// Normalize folder path string
		const sourceStr = typeof source === 'string' ? source : '';
		const folderPath = sourceStr.replace(/^\[\[|\]\]$/g, '');
		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		
		if (folder instanceof TFolder && folder.children) {
			const fileCount = folder.children.filter((f): f is TFile => f instanceof TFile).length;
			const folderCount = folder.children.filter((f): f is TFolder => f instanceof TFolder).length;
			
			return {
				shortSummary: `Folder: ${folderPath} (${fileCount} files, ${folderCount} subfolders)`,
				fullSummary: `This is a folder resource for "${folderPath}". The folder contains ${fileCount} files and ${folderCount} subfolders.`,
			};
		}
		
		// Fallback for missing or non-folder files
		return {
			shortSummary: `Folder: ${folderPath}`,
			fullSummary: `This is a folder resource for "${folderPath}".`,
		};
	}
}

