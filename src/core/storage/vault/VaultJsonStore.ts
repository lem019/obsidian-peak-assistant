/**
 * @file VaultJsonStore.ts
 * @description 基于 Obsidian vault 适配器的 JSON 存储，将 JSON 数据存储为文本文件
 */

import type { App } from 'obsidian';
import type { JsonStore } from '@/core/storage/types';
import { VaultFileStore } from './VaultFileStore';

/**
 * JSON file store backed by Obsidian's vault adapter.
 * Stores JSON data as compact formatted text files.
 * 
 * 基于 Obsidian vault 适配器的 JSON 文件存储
 * 将 JSON 数据存储为紧凑格式的文本文件
 */
export class VaultJsonStore extends VaultFileStore implements JsonStore {
	constructor(
		app: App,
		params: {
			pluginId?: string;
			filename: string;
			storageFolder?: string;
		},
	) {
		super(app, params);
	}

	async loadJson(): Promise<string | null> {
		try {
			const text = await this.app.vault.adapter.read(this.fullPath);
			return text;
		} catch {
			return null;
		}
	}

	async saveJson(jsonString: string): Promise<void> {
		await this.ensureDirectory();
		await this.app.vault.adapter.write(this.fullPath, jsonString);
	}
}

