
/**
 * @file collection-utils.ts
 * @description 集合工具函数，提供对 Map 和 Set 的辅助操作
 */

/**
 * Utility function for Map.
 * Returns all values for the given keys that exist in the map, in the same order as keys.
 * 
 * Map 工具函数，根据给定的键数组获取对应的值数组
 * 
 * @param map - Map to get from
 * @param keys - Array of keys to fetch
 */
export function mapGetAll<K, V>(map: Map<K, V>, keys: K[]): V[] {
    const result: V[] = [];
    for (const key of keys) {
        if (map.has(key)) {
            result.push(map.get(key)!);
        }
    }
    return result;
}

// 空集合常量，用于避免重复创建空集合对象
export const EMPTY_SET = new Set<string>();
export const EMPTY_MAP = new Map();

/**
 * 返回一个类型安全的空 Map
 * 避免在每次需要空 Map 时创建新对象
 */
export function emptyMap<K, V>(): Map<K, V> {
    return EMPTY_MAP as Map<K, V>;
}
