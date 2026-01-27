/**
 * @file ChatDocName.ts
 * @description 聊天文档命名工具类，负责生成带时间戳的文件和文件夹名称。
 * 
 * ## 核心职能
 * 1. **规范命名**：生成统一格式的名称（如 `Project-MMDDHHMMSS-名称` 或 `Conv-MMDDHHMMSS-标题`）。
 * 2. **冲突处理**：当同一个时间点生成多个同名文件时，自动通过添加序号来解决命名冲突。
 * 3. **路径解析**：结合 Obsidian 的 `Vault` API，确保生成的文件夹或文件在磁盘上是唯一的。
 * 
 * ## 生活化类比
 * 就像是一个档案室的“打码机”。每份新档案进来，它都会打印一个带有时间戳的唯一标签。如果两份档案标签重了，它就会在第二个标签后面加个 -1、-2，保证每个柜子里的档案都有自己唯一的名字。
 */

import { Vault, normalizePath, TFile, TFolder } from 'obsidian';

/**
 * Utility for building chat document names with timestamp and conflict resolution.
 * 
 * 用于构建带有时间戳和冲突解决的聊天文档名称的工具。
 */
export class ChatDocName {

	/**
	 * Build project folder name with conflict resolution: Project-mmddhhmmss-<name>
	 * If vault and folder are not provided, returns base name without conflict resolution.
	 */
	static async buildProjectFolderName(
		timestamp: number,
		name: string,
		vault?: Vault,
		folder?: string
	): Promise<string> {
		const baseName = this.buildName('Project', timestamp, name);
		if (vault && folder) {
			return this.resolveNonConflictingPath(vault, folder, baseName);
		}
		return baseName;
	}

	/**
	 * Build conversation file name with conflict resolution: Conv-mmddhhmmss-<title>
	 * If vault and folder are not provided, returns base name without conflict resolution.
	 */
	static async buildConvFileName(
		timestamp: number,
		title: string,
		vault?: Vault,
		folder?: string
	): Promise<string> {
		const baseName = this.buildName('Conv', timestamp, title);
		if (vault && folder) {
			return this.resolveNonConflictingPath(vault, folder, baseName);
		}
		return baseName;
	}

	/**
	 * Build base name: <prefix>-mmddhhmmss-<summarytitle>
	 */
	private static buildName(prefix: string, timestamp: number, summaryTitle: string): string {
		const date = new Date(timestamp);
		const mm = this.pad(date.getMonth() + 1);
		const dd = this.pad(date.getDate());
		const hh = this.pad(date.getHours());
		const mm2 = this.pad(date.getMinutes());
		const ss = this.pad(date.getSeconds());
		const timeStr = `${mm}${dd}${hh}${mm2}${ss}`;
		const sanitized = this.sanitizeSummaryTitle(summaryTitle);
		return `${prefix}-${timeStr}-${sanitized}`;
	}

	/**
	 * Sanitize summary title for use in filename.
	 */
	private static sanitizeSummaryTitle(title: string, maxLength: number = 60): string {
		const sanitized = this.slugify(title);
		if (sanitized.length > maxLength) {
			return sanitized.substring(0, maxLength);
		}
		return sanitized || 'untitled';
	}

	/**
	 * Convert a string into a "slug" — a simplified, URL- and filename-safe version of the text,
	 * containing only lowercase letters, numbers, and hyphens. Slugs are often used in URLs or as filenames
	 * to avoid spaces and special characters.
	 * 
	 * Example: "Hello World!" => "hello-world"
	 */
	private static slugify(text: string): string {
		return text
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9\-]+/g, '-')
			.replace(/-{2,}/g, '-')
			.replace(/^-+|-+$/g, '');
	}

	/**
	 * Resolve non-conflicting path by checking for same-second collisions.
	 * Only adds index suffix if collision detected.
	 */
	private static async resolveNonConflictingPath(
		vault: Vault,
		folder: string,
		baseName: string
	): Promise<string> {
		const normalizedFolder = normalizePath(folder);
		const folderObj = vault.getAbstractFileByPath(normalizedFolder);
		if (!(folderObj instanceof TFolder)) {
			return baseName;
		}

		// Check if base name exists
		const basePath = normalizePath(`${normalizedFolder}/${baseName}`);
		const existing = vault.getAbstractFileByPath(basePath);
		if (!existing) {
			return baseName;
		}

		// Collision detected - add index suffix
		let index = 1;
		let candidateName: string;
		do {
			candidateName = `${baseName}-${index}`;
			const candidatePath = normalizePath(`${normalizedFolder}/${candidateName}`);
			const candidate = vault.getAbstractFileByPath(candidatePath);
			if (!candidate) {
				return candidateName;
			}
			index++;
		} while (index < 1000); // Safety limit

		// Fallback: append timestamp if still colliding
		return `${baseName}-${Date.now()}`;
	}

	private static pad(value: number): string {
		return value < 10 ? `0${value}` : `${value}`;
	}
}
