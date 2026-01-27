/**
 * @file ResourceKindDetector.ts
 * @description 资源类型探测器，用于确定给定源字符串的资源类型
 */

import type { App } from 'obsidian';
import { TFolder } from 'obsidian';
import type { ResourceKind } from '@/core/document/types';

/**
 * Resource Kind Detector
 * 
 * A utility class used to determine the type (ResourceKind) of a given source string.
 * It uses heuristics such as regex, prefix checks (#, http), and file extension 
 * mapping to distinguish between folders, tags, URLs, and various document types.
 * 
 * 资源类型探测器
 * 
 * 一个工具类，用于确定给定源字符串的类型 (ResourceKind)。
 * 它使用正则表达式、前缀检查（#、http）和文件扩展名映射等启发式方法来区分
 * 文件夹、标签、URL 以及各种文档类型。
 */
export class ResourceKindDetector {
	constructor(private readonly app: App) {}

	/**
	 * Detects the resource kind based on the provided source string.
	 * 根据提供的源字符串探测资源类型。
	 * 
	 * @param source - The source string (path, URL, or tag). | 源字符串（路径、URL 或标签）。
	 * @returns The detected ResourceKind. | 探测到的 ResourceKind。
	 */
	detectResourceKind(source: string): ResourceKind {
		// 1. Check for remote URLs
		// 1. 检查远程 URL
		if (/^https?:\/\//i.test(source)) {
			return 'url';
		}

		// 2. Check for tags (starts with #)
		// 2. 检查标签（以 # 开头）
		if (source.startsWith('#')) {
			return 'tag';
		}
		
		// 3. Check for Obsidian internal links (Wikilinks)
		// 3. 检查 Obsidian 内部链接 (Wikilinks)
		if (source.includes('[[')) {
			const normalizedPath = source.replace(/^\[\[|\]\]$/g, '');
			const file = this.app.vault.getAbstractFileByPath(normalizedPath);
			// If it matches a folder in the vault
			if (file instanceof TFolder) {
				return 'folder';
			}
			// Otherwise assume it's a standard markdown note
			return 'markdown';
		}
		
		// 4. Check if the path looks like a folder (no extension, contains /)
		// 4. 检查路径是否看起来像文件夹（无扩展名，包含 /）
		if (source.includes('/')) {
			const folder = this.app.vault.getAbstractFileByPath(source);
			if (folder instanceof TFolder) {
				return 'folder';
			}
		}
		
		// 5. Detect by file extension for various document types
		// 5. 通过文件扩展名探测各种文档类型
		const ext = source.split('.').pop()?.toLowerCase();
		if (ext === 'pdf') return 'pdf';
		if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'heic', 'heif'].includes(ext || '')) {
			return 'image';
		}
		if (ext === 'md' || ext === 'markdown') return 'markdown';
		if (ext === 'txt') return 'txt';
		if (ext === 'csv') return 'csv';
		if (ext === 'json') return 'json';
		if (ext === 'html' || ext === 'htm') return 'html';
		if (ext === 'xml') return 'xml';
		if (ext === 'docx') return 'docx';
		if (ext === 'xlsx') return 'xlsx';
		if (ext === 'pptx') return 'pptx';
		if (ext === 'excalidraw') return 'excalidraw';
		if (ext === 'canvas') return 'canvas';
		if (ext === 'loom') return 'dataloom';
		
		// Default to unknown if no pattern matches
		// 如果没有匹配的模式，默认为 unknown
		return 'unknown';
	}
}

