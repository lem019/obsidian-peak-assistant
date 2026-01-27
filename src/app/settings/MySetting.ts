/**
 * @file MySetting.ts
 * @description 插件设置面板的“包装器”。
 * 继承自 Obsidian 的 `PluginSettingTab`，但其内部实际上是使用 React 渲染的。
 * 它负责连接 Obsidian 的原生设置生命周期（display/hide）和 React 的渲染逻辑。
 */

import { App, PluginSettingTab } from 'obsidian';
import type MyPlugin from 'main';
import { ReactRenderer } from '@/ui/react/ReactRenderer';
import { SettingsRoot } from '@/ui/view/SettingsView';
import { AppContext } from '@/app/context/AppContext';
import { createReactElementWithServices } from '@/ui/react/ReactElementFactory';

/**
 * 负责渲染插件设置 UI。通过 React 渲染包含多个选项卡（General, AI, Search, etc.）的界面。
 */
export class MySettings extends PluginSettingTab {
	// React 渲染器实例，用于在该 Tab 挂载/卸载时管理 React 组件树
	private settingsRenderer: ReactRenderer | null = null;
	private appContext: AppContext;

	constructor(app: App, plugin: MyPlugin, appContext: AppContext) {
		super(app, plugin);
		this.appContext = appContext;
	}

	/**
	 * 当用户点击设置中的插件名称时触发。
	 * 这是进入 React 世界的入口点。
	 */
	display(): void {
		const { containerEl } = this;

		// 资源清理：在重新清空容器前，先安全卸载旧的 React 树。
		// 这一步对于单页应用和复杂组件至关重要，可以防止内存泄漏。
		if (this.settingsRenderer) {
			this.settingsRenderer.unmount();
			this.settingsRenderer = null;
		}

		// 清空 Obsidian 提供的设置面板原生 HTML 容器
		containerEl.empty();

		// 初始化 React 渲染环境：将 Obsidian 的 DIV 包装为 React Root
		this.settingsRenderer = new ReactRenderer(containerEl);
		
		/**
		 * 渲染设置页面的核心组件树。
		 * 
		 * 逻辑流程：
		 * 1. 使用 `createReactElementWithServices` 工具函数。
		 * 2. 自动将 `AppContext` 注入到 React 的 Provider 中。
		 * 3. 渲染 `SettingsRoot`，使所有子设置项都能直接访问 AI 配置和搜索配置。
		 */
		this.settingsRenderer.render(
			createReactElementWithServices(SettingsRoot, {}, this.appContext)
		);
	}

	/**
	 * 当设置面板被关闭或用户切换到其他插件设置时触发。
	 * 进行必要的清理工作。
	 */
	hide(): void {
		if (this.settingsRenderer) {
			this.settingsRenderer.unmount();
			this.settingsRenderer = null;
		}
	}

}

