/**
 * @file HtmlView.ts
 * @description 动态 HTML 视图注册器。
 * 允许用户通过配置文件在 Obsidian 中注册自定义的 HTML 视图，并可以将这些视图添加到侧边栏或通过命令打开。
 * 常用于在不开发完整 React 插件的情况下集成现有的 Web 工具或静态页面。
 */

import { PaneType, Plugin } from 'obsidian';
import { ItemView, WorkspaceLeaf } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';

const VIEW_TYPE_HTML = "html-view";

/**
 * Configuration for a custom HTML view
 * 
 * 自定义 HTML 视图配置接口。
 */
export interface HTMLViewConfig {
    /** 视图的内部索引名称 */
    viewName: string;
    /** HTML 文件在库中的相对路径 */
    filePath: string;
    /** 使用的 Lucide 图标名称 */
    iconName: string;
    /** 悬停显示的标题 */
    iconTitle: string;
    /** 是否在左侧侧边栏添加入口按钮 */
    sideBar: boolean;
    /** 可选：关联的触发命令名称 */
    command?: string;
    /** 可选：打开时的叶子节点类型（如 'tab', 'split' 等） */
    leafType?: string | boolean;
}

type LeafType = PaneType | boolean;

/**
 * Generic view for rendering local HTML files
 * 
 * 通用 HTML 视图类。
 * 继承自 Obsidian 的 ItemView，负责读取文件并注入到容器容器中。
 */
class HtmlView extends ItemView {
    constructor(leaf: WorkspaceLeaf, private viewConfig: HTMLViewConfig) {
        super(leaf);
    }

    getViewType(): string {
        return VIEW_TYPE_HTML;
    }

    getDisplayText(): string {
        return "HTML View";
    }

    /**
     * Initial view rendering logic
     * 
     * 视图打开时的生命周期钩子。读取本地 HTML 文件内容并渲染。
     */
    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        // const exampleHtmlContent = `<div>
        //     <h1>Hello, this is rendered HTML!</h1>
        //     <p>This content is dynamically rendered in a custom view.</p>
        // </div>`;
        const basePath = (this.app.vault.adapter as any).basePath
        const htmlContent = fs.readFileSync(
            path.join(basePath, this.viewConfig.filePath), 'utf-8'
        );
        container.innerHTML = htmlContent;
    }

    async onClose() {
        // Nothing to clean up
    }
}

/**
 * Main registration entry point
 * @param congfigFilePath Path to the JSON config file
 * @param plugin Plugin instance
 * 
 * 批量注册 HTML 视图的入口函数。
 * 读取 JSON 配置文件并为每一个配置项调用 registerHTMLView。
 */
export function registerHTMLViews(congfigFilePath: string, plugin: Plugin) {
    // Read content
    const basePath = (plugin.app.vault.adapter as any).basePath
    const configFilePath = path.join(basePath, congfigFilePath);
    
    // Check if config file exists
    if (!fs.existsSync(configFilePath)) {
        console.warn(`HTML view config file not found: ${congfigFilePath}. Skipping HTML view registration.`);
        return;
    }
    
    let configFileContent: string;
    try {
        configFileContent = fs.readFileSync(configFilePath, 'utf-8');
    } catch (error) {
        console.error(`Failed to read HTML view config file: ${congfigFilePath}`, error);
        return;
    }
    
    // Parse as JSON object
    let configArray: HTMLViewConfig[] = [];
    try {
        configArray = JSON.parse(configFileContent);
        if (!Array.isArray(configArray)) {
            throw new Error("Config file content is not an array");
        }

        // Validate each config item matches HTMLViewConfig interface
        configArray.forEach(item => {
            if (typeof item.viewName !== 'string' ||
                typeof item.filePath !== 'string' ||
                typeof item.iconName !== 'string' ||
                typeof item.iconTitle !== 'string' ||
                typeof item.sideBar !== 'boolean' ||
                (item.command && typeof item.command !== 'string')) {
                throw new Error("Some items in config file do not match HTMLViewConfig interface");
            }
        });
    } catch (error) {
        console.error("Error parsing config file content:", error.message);
        return;
    }

    // Register view
    configArray.forEach(item => registerHTMLView(item, plugin))
}

/**
 * Register a single HTML view
 * @param viewConfig View configuration data
 * @param plugin Plugin instance
 * 
 * 注册单个 HTML 视图。
 * 根据配置决定是添加侧边栏图标（Ribbon Icon）还是注册全局命令。
 */
export function registerHTMLView(viewConfig: HTMLViewConfig, plugin: Plugin) {
    // Register home view
    plugin.registerView(
        VIEW_TYPE_HTML,
        (leaf: WorkspaceLeaf) => new HtmlView(leaf, viewConfig)
    );
    const newLeafType = (viewConfig.leafType ?? true) as LeafType
    // If sidebar button is specified, add button in sidebar, otherwise register command
    if (viewConfig.sideBar) {
        plugin.addRibbonIcon(viewConfig.iconName, viewConfig.iconTitle, async () => {
            activateView(plugin, newLeafType);
        });
    } else {
        const viewCommandName = 'PeakAssistant-OpenHtml-' + viewConfig.viewName
        plugin.addCommand({
            id: viewCommandName,
            name: viewCommandName,
            callback: () => {
                activateView(plugin, newLeafType)
            }
        });
    }
}

/**
 * Activate and show the HTML view
 * 
 * 激活视图。
 * 如果视图已存在则先卸载旧叶子节点，然后创建新叶子节点并显示。
 */
async function activateView(plugin: Plugin, newLeaf?: LeafType) {
    plugin.app.workspace.detachLeavesOfType(VIEW_TYPE_HTML);
    await plugin.app.workspace.getLeaf(newLeaf).setViewState({
        type: VIEW_TYPE_HTML,
        active: true,
    });
    plugin.app.workspace.revealLeaf(
        plugin.app.workspace.getLeavesOfType(VIEW_TYPE_HTML)[0]
    );
}
