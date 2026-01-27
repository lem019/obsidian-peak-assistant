/**
 * @file EventDispatcher.ts
 * @description 统一事件调度器。
 * 负责处理 Obsidian 原生事件（Vault, Metadata, Workspace, DOM）以及自定义脚本事件。
 * 引入了缓冲（Buffering）机制，将高频触发的事件（如内容修改）合并并在 1 秒后统一分发，从而显着提高大型库下的性能。
 */

import { EventRef, Plugin, App, TAbstractFile, TFile, CachedMetadata, WorkspaceLeaf, WorkspaceWindow, Menu, Editor, MarkdownView, MarkdownFileInfo, Tasks, Notice } from "obsidian";
import * as path from "path";
import { Callback, loadScriptsForEvent } from "./ScriptLoader";

type EventHandler<T = any> = (data: T) => void;

/**
 * Event dispatcher for handling Obsidian and custom events.
 *
 * Initially designed to avoid dependency on Obsidian's event system, but currently uses
 * Obsidian's event mechanism temporarily. This file is rarely used as a result.
 * 
 * 事件调度中心，用于处理 Obsidian 事件和自定义事件。
 * 
 * 设计流程：
 * 1. Obsidian 触发事件 => 查找所有处理器 => 派发给对应处理器
 * 2. 初始化 EventDispatcher => 监听所有 Obsidian 事件 => 注册默认分发处理器
 * 3. addNewHandler => 修改分发处理器
 * 4. 卸载所有事件监听器
 *
 * TODO: Should support pushing custom events that others can subscribe to, not just handling
 * Obsidian's internal events. Custom events could be created like Kafka, making plugin
 * development more convenient and extensible.
 */
export class EventDispatcher {
    /**
     * Event references for easy cleanup
     * 
     * 存储各类事件引用，以便在卸载时统一清理，防止内存泄漏。
     */
    private vaultEventRefs: EventRef[] = [];
    private metadataCacheEventRefs: EventRef[] = [];
    private workspaceEventRefs: EventRef[] = [];
    private windowEventRefs: Map<string, EventListener> = new Map();
    private alreadyRegisteredEvents: Set<string> = new Set()

    /**
     * Event handlers
     * Key format: e.g., "dom-click", "workspace-editor-change"
     * 
     * 注册的事件处理器容器。
     */
    private handlers: { [key: string]: EventHandler[] } = {};

    /**
     * Event buffering for performance optimization
     * Too many events occur, reduce processing load and improve performance.
     * 
     * 事件缓冲机制。
     * 针对 Obsidian 频繁触发的事件（如输入、自动保存），将数据暂存在 buffer 中。
     */
    private eventBuffer: { [key: string]: any[] } = {};
    private timeoutIds: { [key: string]: NodeJS.Timeout | null } = {};

    constructor(private app: App, private plugin: Plugin) {
    }

    private async init() {
        // // Batch registration consumes too much performance, changed to incremental registration
        // // Register Obsidian events
        // this.registerVaultEvents();
        // this.registerMetadataCacheEvents();
        // this.registerWorkspaceEvents();
    }

    /**
     * Entry point for script-based event automation
     * 
     * 为指定的脚本文件夹添加监听器。当文件夹内的脚本发生变化时，会自动重新加载。
     */
    public addScriptFolderListener(scriptFolderPath: string) {
        this.loadFromScriptFolder(scriptFolderPath)
        this.addNewHandler("vault-modify", (data) => {
            this.onScriptFolderChange(data, scriptFolderPath)
        })
        this.addNewHandler("vault-create", (data) => {
            this.onScriptFolderChange(data, scriptFolderPath)
        })
        this.addNewHandler("vault-delete", (data) => {
            this.onScriptFolderChange(data, scriptFolderPath)
        })
    }

    /**
     * Handle folder changes to reload script events
     * 
     * 监听脚本文件夹的变化。如果文件夹内的文件被修改，则清空当前所有监听并重新加载。
     */
    private async onScriptFolderChange(changedFileParam: any, scriptFolderPath: string) {
        // console.log(`File changed 1: `, changedFileParam, scriptFolderPath);

        let changedFileArray = changedFileParam as TAbstractFile[]
        changedFileArray = changedFileArray.filter(changedFile =>
            changedFile.path.startsWith(scriptFolderPath)
        );
        if (changedFileArray.length <= 0) {
            return
        }

        // console.log(`File changed 2:`, changedFileArray);
        // Add your logic here if needed
        this.unload()
        this.addScriptFolderListener(scriptFolderPath)
        // make a notice to let user know event listener had been registered
        new Notice('Peak Assistant. Event Scripts Reload!');
    }

    /**
     * Load custom scripts from the specified folder
     * 
     * 从脚本文件夹加载事件。利用 ScriptLoader 执行并提取回调函数。
     */
    private loadFromScriptFolder(scriptFolderPath: string) {
        const basePath = (this.app.vault.adapter as any).basePath
        // load events
        const eventScripts: Map<string, Callback[]> = loadScriptsForEvent(
            path.join(basePath, scriptFolderPath)
        )
        // console.log(eventScripts);
        eventScripts.forEach((callbacks, event) => {
            callbacks.forEach((callback, index) => {
                this.addNewHandler(event, callback)
            })
        })
    }

    public addNewHandlers(eventHandlers: Map<string, EventHandler>) {
        eventHandlers.forEach((eventHandlerIter, eventNameIter)=> {
            this.addNewHandler(eventNameIter, eventHandlerIter)
        })
    }

    /**
     * Register a new event handler
     * @param eventName eg:  "dom-click" "workspace-editor-change"
     * 
     * 注册新的事件处理器。
     * 根据 eventName 的前缀（如 vault-, dom-, workspace-）自动分流到对应的 Obsidian 原生 API 注册逻辑。
     */
    public addNewHandler<T>(eventName: string, handler: EventHandler<T>) {
        if (!this.handlers[eventName]) {
            this.handlers[eventName] = [];
        }
        this.handlers[eventName].push(handler);
        const [firstPart, secondPart] = this.extractEventName(eventName)
        if (secondPart.length <= 0) {
            return
        }

        // Only register once. Because same events will go to dispatcher and find handlers there
        if (this.alreadyRegisteredEvents.has(eventName)) {
            return
        }
        this.alreadyRegisteredEvents.add(eventName)
        console.log("addNewHandler: ", firstPart, " - ", secondPart);
        switch (firstPart) {
            case 'window':
                this.registerWindowEvents(secondPart)
                break;
            case 'dom':
                this.registerDomEvents(secondPart)
                break;
            case 'vault':
                this.registerVaultEvents(secondPart)
                break;
            case 'metadataCache':
                this.registerMetadataCacheEvents(secondPart)
                break;
            case 'workspace':
                this.registerWorkspaceEvents(secondPart)
                break;
            default:
                break;
        }
    }

    public removeHandler<T>(eventName: string, handler: EventHandler<T>) {
        // Writing remove is too complicated. Can just clear all and reload.
    }

    /**
     * Unload all events and clear memory refs
     * 
     * 彻底清理所有事件监听。
     */
    public unload() {
        // Clearing handlers will also cause DOM events to be removed.
        // Assumption: DOM event handlers will be garbage collected by VM if not held.
        this.handlers = {};
        // Cleanup Obsidian event handlers
        this.vaultEventRefs.forEach(ref => this.app.vault.offref(ref));
        this.metadataCacheEventRefs.forEach(ref => this.app.metadataCache.offref(ref));
        this.workspaceEventRefs.forEach(ref => this.app.workspace.offref(ref));
        this.windowEventRefs.forEach((eventListener, eventName) => window.removeEventListener(eventName, eventListener))
    }

    /**
     * JavaScript single-threaded mechanism. No need to handle concurrent update issues.
     * I.e., data loss when setting data while processing.
     * 
     * 核心缓冲逻辑。
     * 将事件数据推入队列，并开启 1 秒窗口。如果 1 秒内有多次触发，数据会堆积。
     */
    private bufferDispatch(event: string, data: any) {
        // Return directly if no corresponding event handler
        if (!this.handlers[event]) {
            return
        }

        // Initialize empty array if event doesn't exist
        if (!this.eventBuffer[event]) {
            this.eventBuffer[event] = [];
        }
        // Push data to event buffer
        this.eventBuffer[event].push(data);

        // Set timeout if not already set
        if (!this.timeoutIds[event]) {
            this.timeoutIds[event] = setTimeout(() => this.realDispatch(event), 1000);
        }
    }

    /**
     * JavaScript single-threaded mechanism. No need to handle concurrent update issues.
     * I.e., data loss when setting data while processing.
     * 
     * 核心派发逻辑。
     * 1 秒到期后，将队列中积累的所有数据作为数组一次性派发给处理器。
     */
    private realDispatch(event: string) {
        // Process specific event
        // TODO: eventData might be too much, shouldn't cache everything.
        // Should allow each different event to have its own merge logic.
        // But considering 1s won't cache too much, current situation handles many cases, leave it for now.
        const eventData = this.eventBuffer[event];
        // console.log(`Triggering ${event} with data:`, eventData);

        try {
            const eventHandlers = this.handlers[event];
            if (eventHandlers) {
                eventHandlers.forEach(handler => handler(eventData));
            }
        } finally {
            // Ensure cleanup always executes
            delete this.eventBuffer[event];
            clearTimeout(this.timeoutIds[event]!);
            delete this.timeoutIds[event];
        }
    }

    /**
     * Register Window level events
     * 
     * 注册 Window 级别事件（如窗口大小变化、各种 DOM 事件）。
     */
    private registerWindowEvents(eventName: string) {
        const windowEventListener = (evt: Event) => {
            this.domBufferDispatch(eventName, evt)
        };
        const eventKey = eventName as keyof WindowEventMap
        this.windowEventRefs.set(
            eventKey,
            windowEventListener
        )
        window.addEventListener(eventKey, windowEventListener);
    }

    /**
     * Register DOM events on the document
     * @param eventName eg: "click"
     * 
     * 注册常规 DOM 事件（如主文档点击）。
     */
    private registerDomEvents(eventName: string) {
        const validEventName = eventName as keyof DocumentEventMap;
        this.plugin.registerDomEvent(document, validEventName, (evt) => {
            this.domBufferDispatch(eventName, evt)
        })
    }

    private domBufferDispatch(eventName: string, evt: any) {
        this.bufferDispatch('dom-' + eventName, evt)
    }

    /**
     * Register Vault (File System) events
     * 
     * 注册库级事件（文件创建、修改、删除、重命名）。
     */
    private registerVaultEvents(eventName: string) {
        switch (eventName) {
            case 'create':
                // This is also called when the vault is first loaded for each existing file.
                // => which means there will trigger too many events after first load.
                // => so we do not process this event
                // "https://docs.obsidian.md/Reference/TypeScript+API/Vault/on('create')"
                this.app.workspace.onLayoutReady(() => {
                    this.vaultEventRefs.push(
                        this.app.vault.on('create', (file: TAbstractFile) => this.vaultBufferDispatch('create', file))
                    );
                })
                break;
            case 'modify':
                this.vaultEventRefs.push(
                    this.app.vault.on('modify', (file: TAbstractFile) => this.vaultBufferDispatch('modify', file))
                );
                break;
            case 'delete':
                this.vaultEventRefs.push(
                    this.app.vault.on('delete', (file: TAbstractFile) => this.vaultBufferDispatch('delete', file))
                );
                break;
            case 'rename':
                this.vaultEventRefs.push(
                    this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => this.vaultBufferDispatch('rename', { file, oldPath }))
                );
                break;
            default:
                break;
        }
    }

    private vaultBufferDispatch(eventName: string, evt: any) {
        this.bufferDispatch('vault-' + eventName, evt)
    }

    /**
     * Register Metadata Cache events
     * 
     * 注册元数据缓存事件。
     */
    private registerMetadataCacheEvents(eventName: string) {
        switch (eventName) {
            case 'changed':
                this.metadataCacheEventRefs.push(
                    this.app.metadataCache.on('changed', (file: TFile) => this.metadataCacheBufferDispatch('changed', file))
                );
                break;
            case 'deleted':
                this.metadataCacheEventRefs.push(
                    this.app.metadataCache.on('deleted', (file: TFile, prevCache: CachedMetadata | null) => this.metadataCacheBufferDispatch('deleted', { file, prevCache }))
                );
                break;
            case 'resolve':
                // // Don't know the use of these two events. resolve will be called heavily at startup.
                // // "https://docs.obsidian.md/Reference/TypeScript+API/MetadataCache/on('resolve')"
                // this.metadataCacheEventRefs.push(
                //     this.app.metadataCache.on('resolve', (file: TFile) => this.metadataCacheBufferDispatch('resolve', file))
                // );
                break;
            case 'resolved':
                // this.metadataCacheEventRefs.push(
                //     this.app.metadataCache.on('resolved', () => this.metadataCacheBufferDispatch('resolved', {}))
                // );
                break;
            default:
                break;
        }

    }

    private metadataCacheBufferDispatch(eventName: string, evt: any) {
        this.bufferDispatch('metadataCache-' + eventName, evt)
    }

    /**
     * Register Workspace (UI/Interface) events
     * 
     * 注册工作区 UI 事件（如文件打开、布局改变、右键菜单、编辑器内容改变等）。
     */
    private registerWorkspaceEvents(eventName: string) {
        switch (eventName) {
            case 'quick-preview':
                this.workspaceEventRefs.push(
                    this.app.workspace.on('quick-preview', (file: TFile, data: string) => {
                        this.workspaceBufferDispatch('quick-preview', { file, data });
                    })
                );
                break;

            case 'resize':
                this.workspaceEventRefs.push(
                    this.app.workspace.on('resize', () => {
                        this.workspaceBufferDispatch('resize', {});
                    })
                );
                break;

            case 'active-leaf-change':
                this.workspaceEventRefs.push(
                    this.app.workspace.on('active-leaf-change', (leaf: WorkspaceLeaf | null) => {
                        this.workspaceBufferDispatch('active-leaf-change', leaf);
                    })
                );
                break;

            case 'file-open':
                this.workspaceEventRefs.push(
                    this.app.workspace.on('file-open', (file: TFile | null) => {
                        this.workspaceBufferDispatch('file-open', file);
                    })
                );
                break;

            case 'layout-change':
                this.workspaceEventRefs.push(
                    this.app.workspace.on('layout-change', () => {
                        this.workspaceBufferDispatch('layout-change', {});
                    })
                );
                break;

            case 'window-open':
                this.workspaceEventRefs.push(
                    this.app.workspace.on('window-open', (win: WorkspaceWindow, window: Window) => {
                        this.workspaceBufferDispatch('window-open', { win, window });
                    })
                );
                break;

            case 'window-close':
                this.workspaceEventRefs.push(
                    this.app.workspace.on('window-close', (win: WorkspaceWindow, window: Window) => {
                        this.workspaceBufferDispatch('window-close', { win, window });
                    })
                );
                break;

            case 'css-change':
                this.workspaceEventRefs.push(
                    this.app.workspace.on('css-change', () => {
                        this.workspaceBufferDispatch('css-change', {});
                    })
                );
                break;

            case 'file-menu':
                this.workspaceEventRefs.push(
                    this.app.workspace.on('file-menu', (menu: Menu, file: TAbstractFile, source: string, leaf?: WorkspaceLeaf) => {
                        this.workspaceBufferDispatch('file-menu', { menu, file, source, leaf });
                    })
                );
                break;

            case 'files-menu':
                this.workspaceEventRefs.push(
                    this.app.workspace.on('files-menu', (menu: Menu, files: TAbstractFile[], source: string, leaf?: WorkspaceLeaf) => {
                        this.workspaceBufferDispatch('files-menu', { menu, files, source, leaf });
                    })
                );
                break;

            case 'url-menu':
                this.workspaceEventRefs.push(
                    this.app.workspace.on('url-menu', (menu: Menu, url: string) => {
                        this.workspaceBufferDispatch('url-menu', { menu, url });
                    })
                );
                break;

            case 'editor-menu':
                this.workspaceEventRefs.push(
                    this.app.workspace.on('editor-menu', (menu: Menu, editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
                        this.workspaceBufferDispatch('editor-menu', { menu, editor, info });
                    })
                );
                break;

            case 'editor-change':
                this.workspaceEventRefs.push(
                    this.app.workspace.on('editor-change', (editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
                        this.workspaceBufferDispatch('editor-change', { editor, info });
                    })
                );
                break;

            case 'editor-paste':
                this.workspaceEventRefs.push(
                    this.app.workspace.on('editor-paste', (evt: ClipboardEvent, editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
                        this.workspaceBufferDispatch('editor-paste', { evt, editor, info });
                    })
                );
                break;

            case 'editor-drop':
                this.workspaceEventRefs.push(
                    this.app.workspace.on('editor-drop', (evt: DragEvent, editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
                        this.workspaceBufferDispatch('editor-drop', { evt, editor, info });
                    })
                );
                break;

            case 'quit':
                this.workspaceEventRefs.push(
                    this.app.workspace.on('quit', (tasks: Tasks) => {
                        this.workspaceBufferDispatch('quit', tasks);
                    })
                );
                break;

            default:
                break;
        }
    }

    private workspaceBufferDispatch(eventName: string, evt: any) {
        this.bufferDispatch('workspace-' + eventName, evt)
    }

    /**
     * Parse event string to categorize source
     * @param str eg: "dom-click" "workspace-editor-change"
     * @returns eg: ["dom", click] ["workspace", "editor-change"]
     * 
     * 将 eventName 字符串解析为 [来源, 具体事件名] 的元组。
     */
    private extractEventName(str: string) {
        const hyphenIndex = str.indexOf('-');

        if (hyphenIndex === -1) {
            // If there is no hyphen, return the whole string as the first part and an empty string as the second part
            return [str, ''];
        }

        const beforeHyphen = str.slice(0, hyphenIndex);
        const afterHyphen = str.slice(hyphenIndex + 1); // +1 to exclude the hyphen itself

        return [beforeHyphen, afterHyphen];
    }
}