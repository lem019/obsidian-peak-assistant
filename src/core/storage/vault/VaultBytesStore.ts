/**
 * @file VaultBytesStore.ts
 * @description 基于 Obsidian 库的二进制文件存储适配器。
 * 
 * ## 核心职能
 * 本文件实现了 `BytesStore` 接口，专门用于读写原始的二进制数据（ArrayBuffer）。主要的存储对象是 SQLite 数据库文件（.sqlite）。
 * 
 * ## 在项目中的角色
 * 它是数据库文件的“搬运工”。当插件启动时，它负责从 Obsidian 笔记库（Vault）中读取数据库文件到内存中；当数据库有更新时，它将内存中的数据写回磁盘。
 * 
 * ## 生活化类比
 * 就像是一个搬运工，专门负责搬运沉重的“保险箱”（数据库文件）。他不关心保险箱里装了什么，只确保保险箱能完好无损地从仓库（磁盘）搬到办公室（内存），或者反过来。
 */

import type { App } from 'obsidian';
import type { BytesStore } from '@/core/storage/types';
import { VaultFileStore } from './VaultFileStore';

/**
 * Binary file store backed by Obsidian's vault adapter.
 * Stores raw bytes (e.g., SQLite databases) as binary files.
 * Can store files in user-configured directory or fallback to plugin directory.
 * 
 * 基于 Obsidian 库适配器的二进制文件存储。
 * 将原始字节（例如 SQLite 数据库）存储为二进制文件。
 * 可以将文件存储在用户配置的目录中，或回退到插件目录。
 */
export class VaultBytesStore extends VaultFileStore implements BytesStore {
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

	async load(): Promise<ArrayBuffer | null> {
		try {
			const buf = await (this.app.vault.adapter as any).readBinary(this.fullPath);
			if (!buf) return null;
			// Some adapters return ArrayBuffer, some return Uint8Array.
			if (buf instanceof ArrayBuffer) return buf;
			if (buf instanceof SharedArrayBuffer) {
				// Convert SharedArrayBuffer to ArrayBuffer by copying
				const arrayBuffer = new ArrayBuffer(buf.byteLength);
				new Uint8Array(arrayBuffer).set(new Uint8Array(buf));
				return arrayBuffer;
			}
			if (buf instanceof Uint8Array) {
				const underlyingBuffer = buf.buffer;
				if (underlyingBuffer instanceof SharedArrayBuffer) {
					// Convert SharedArrayBuffer to ArrayBuffer by copying
					const arrayBuffer = new ArrayBuffer(buf.byteLength);
					new Uint8Array(arrayBuffer).set(buf);
					return arrayBuffer;
				}
				return underlyingBuffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
			}
			return null;
		} catch {
			return null;
		}
	}

	async save(bytes: ArrayBuffer): Promise<void> {
		await this.ensureDirectory();
		const data = new Uint8Array(bytes);
		await (this.app.vault.adapter as any).writeBinary(this.fullPath, data);
	}
}


