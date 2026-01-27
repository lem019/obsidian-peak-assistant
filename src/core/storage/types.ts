/**
 * @file types.ts
 * @description 存储系统的基础接口与类型定义。
 * 
 * ## 核心职能
 * 本文件定义了整个插件持久化数据的“合同规范”。不管数据是存进数据库、记在文件里，还是暂存在内存里，
 * 都要遵守这里定义的接口。这为系统提供了高度的抽象和解耦。
 * 
 * ## 为什么需要这个抽象层？
 * 1. **后端无关**：让上层业务逻辑（如 AI 聊天、文档存储）不需要关心底层是在用 SQLite 还是在写 Markdown 文件。
 * 2. **多端适配**：例如桌面端我们可以用高性能的原生存储（Better-SQLite3），而移动端或网页测试时我们可以切换到 WASM 存储（sql.js），
 *    只要它们都实现了这里定义的接口，上层调用代码完全不需要修改。
 * 
 * ## 生活化类比
 * 就像插座的标准（国标、美标）。只要你的电器（业务逻辑）符合插头规范，无论供电局（存储层）是通过
 * 火力发电还是风力发电，你的电器都能正常工作。
 */

/**
 * Interface for loading and saving raw binary data.
 * 用于加载和保存原始二进制数据的接口（例如：向量块数据、图片或其他非文本文件）。
 */
export interface BytesStore {
	/**
	 * Load raw bytes. Returns null if not found.
	 * 加载原始字节数据。如果找不到对应的存储项，则返回 null。
	 */
	load(): Promise<ArrayBuffer | null>;
	/**
	 * Persist raw bytes.
	 * 将原始字节数据写入持久存储。
	 * @param bytes 要保存的二进制数据
	 */
	save(bytes: ArrayBuffer): Promise<void>;
}

/**
 * Interface for persisting structured JSON data.
 * 用于持久化结构化 JSON 数据的接口（例如：配置文件、简单的状态导出等）。
 */
export interface JsonStore {
	/**
	 * Load JSON string. Returns null if not found.
	 * 加载 JSON 格式的文本字符串。如果未找到，则返回 null。
	 */
	loadJson(): Promise<string | null>;
	/**
	 * Persist JSON string (usually in compact format).
	 * 将 JSON 字符串保存。通常保存为压缩后的格式以节省空间。
	 * @param jsonString 要保存的 JSON 字符串
	 */
	saveJson(jsonString: string): Promise<void>;
}

/**
 * Generic Key-Value store interface for simple string mappings.
 * 通用的键值对存储接口（类似于 LocalStorage，但通常是持久化的）。
 */
export interface KeyValueStore {
	/**
	 * Retrieve a value by its key.
	 * 根据指定的 Key 找回保存的 Value。
	 * @param key 键名
	 */
	get(key: string): Promise<string | null>;
	/**
	 * Set a value for a specific key.
	 * 存储或更新一个键值对。
	 * @param key 键名
	 * @param value 键值
	 */
	set(key: string, value: string): Promise<void>;
	/**
	 * Remove a key and its associated value.
	 * 删除指定的键及其对应的值。
	 * @param key 要删除的键
	 */
	delete(key: string): Promise<void>;
}


