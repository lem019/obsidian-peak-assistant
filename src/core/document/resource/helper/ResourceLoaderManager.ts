/**
 * @file ResourceLoaderManager.ts
 * @description 资源加载器管理器，协调特殊资源加载器和文档加载器，提供统一的摘要接口
 */

import type { App } from 'obsidian';
import type { ResourceLoader, ResourceKind, SpecialResourceType, DocumentType, Summarizable } from '@/core/document/types';
import type { AIServiceManager } from '@/service/chat/service-manager';
import { DocumentLoaderManager } from '@/core/document/loader/helper/DocumentLoaderManager';
import { TagResourceLoader } from '../TagResourceLoader';
import { FolderResourceLoader } from '../FolderResourceLoader';

/**
 * Resource Loader Manager
 * 
 * Acting as a Facade or Orchestrator, this manager coordinates between 
 * Special Resource Loaders (Tags, Folders, Categories) and Document Loaders (PDF, MD, etc.).
 * It provides a unified interface (`getSummary`) to obtain summaries for any type 
 * of source, whether it's a file path in the vault or a special resource.
 * 
 * 资源加载器管理器
 * 
 * 作为一个外观（Facade）或协调器，该管理器协调特殊资源加载器（标签、文件夹、类别）
 * 和文档加载器（PDF、MD 等）。它提供了一个统一的接口 (`getSummary`)，
 * 以获取任何类型来源的摘要，无论它是库中的文件路径还是特殊资源。
 */
export class ResourceLoaderManager {
    // Map to store loaders for special resource types (tag, folder, etc.)
    private readonly loaderMap = new Map<SpecialResourceType, ResourceLoader>();
    private readonly documentLoaderManager: DocumentLoaderManager;
    private readonly aiServiceManager: AIServiceManager;
    // Set of types handled directly by this manager as "special"
    private readonly specialTypes: Set<SpecialResourceType> = new Set(['tag', 'folder', 'category']);

    constructor(app: App, aiServiceManager: AIServiceManager, documentLoaderManager?: DocumentLoaderManager) {
        // Initialize or use the singleton for standard document handling
        this.documentLoaderManager = documentLoaderManager || DocumentLoaderManager.getInstance();
        this.aiServiceManager = aiServiceManager;

        // Register the built-in special resource loaders
        this.registerLoader(new TagResourceLoader());
        this.registerLoader(new FolderResourceLoader(app));
    }

    /**
     * Registers a new resource loader for special/custom resource types.
     * 为特殊/自定义资源类型注册新的资源加载器。
     */
    registerLoader(loader: ResourceLoader): void {
        const resourceType = loader.getResourceType();
        // Ensure we only register types defined as special
        if (this.specialTypes.has(resourceType as SpecialResourceType)) {
            this.loaderMap.set(resourceType as SpecialResourceType, loader);
        }
    }

    /**
     * Helper to check if a kind belongs to the "special" category.
     * 辅助方法，用于检查某种类型是否属于“特殊”类别。
     */
    isSpecialResourceType(resourceKind: ResourceKind): resourceKind is SpecialResourceType {
        return this.specialTypes.has(resourceKind as SpecialResourceType);
    }

    /**
     * Retrieves the appropriate loader for a given resource kind.
     * Supports both document types (delegates to DocumentLoaderManager) and special types.
     * 
     * 为给定的资源类型检索合适的加载器。
     * 支持文档类型（委托给 DocumentLoaderManager）和特殊类型。
     * 
     * @returns A Summarizable object (loader) or null if not found.
     */
    getLoader(resourceKind: ResourceKind): Summarizable | null {
        // Direct look-up for special types
        if (this.isSpecialResourceType(resourceKind)) {
            return this.loaderMap.get(resourceKind) || null;
        }

        // Delegate to document loader manager for files
        return this.documentLoaderManager.getLoaderForDocumentType(resourceKind as DocumentType);
    }

    /**
     * High-level method to fetch a summary for any source.
     * Automatically differentiates between files (reading them first) and special resources.
     * 
     * 获取任何来源摘要的高级方法。
     * 自动区分文件（先读取文件）和特殊资源。
     * 
     * @param source - The source identifier (path, tag, etc.). | 来源标识符（路径、标签等）。
     * @param resourceKind - The type of resource. | 资源类型。
     */
    async getSummary(
        source: string,
        resourceKind: ResourceKind,
        provider?: string,
        modelId?: string
    ): Promise<{ shortSummary: string; fullSummary?: string } | null> {
        console.debug('[ResourceLoaderManager] getting summary for source:', source, 'resourceKind:', resourceKind);
        
        const loader = this.getLoader(resourceKind);
        if (!loader) {
            return null;
        }

        const startTime = Date.now();

        let summary: { shortSummary: string; fullSummary?: string } | null;
        
        if (this.isSpecialResourceType(resourceKind)) {
            // Special resources (tags, folders) usually summarize the "source" identifier directly
            console.debug('[ResourceLoaderManager] getting summary for special resource type:', source, 'resourceKind:', resourceKind);
            summary = await (loader as ResourceLoader).getSummary(source, provider, modelId);
        } else {
            // Document types (PDF, MD) need to be read from disk first to get their content
            const doc = await this.documentLoaderManager.readByPath(source, true);
            console.debug('[ResourceLoaderManager] getting summary for document type:', source, 'resourceKind:', resourceKind);
            summary = doc ? await (loader as DocumentLoader).getSummary(doc, provider, modelId) : null;
        }

        const genTime = Date.now() - startTime;
        console.debug(`[ResourceLoaderManager] summary generation time for source: ${source} (${resourceKind}): ${genTime}ms`);

        return summary;
    }
}

