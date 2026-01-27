/**
 * @file ViewManager.ts
 * @description 视图生命周期管理器。
 * 负责在插件启动时向 Obsidian 注册所有自定义视图（React 渲染的 View），
 * 并在卸载时负责销毁和清理（detach）这些视图。
 */

import type MyPlugin from 'main';
import type { AIServiceManager } from '@/service/chat/service-manager';
import { CHAT_VIEW_TYPE, ChatView } from '@/ui/view/ChatView';
import { PROJECT_LIST_VIEW_TYPE, ProjectListView } from '@/ui/view/ProjectListView';
import { MESSAGE_HISTORY_VIEW_TYPE, MessageHistoryView } from '@/ui/view/MessageHistoryView';
import { ViewSwitchConsistentHandler } from '@/app/view/ViewSwitchConsistentHandler';
import { InputModal } from '@/ui/component/InputModal';
import { App, ViewCreator } from 'obsidian';
import { AppContext } from '@/app/context/AppContext';

/**
 * 管理视图注册、相关命令和卸载清理。
 */
export class ViewManager {
	/**
	 * 布局一致性处理器：这是 UI 体验的核心。
	 * 它监听视图切换事件，确保左边栏（项目列表）、中间主区（聊天窗口）和右边栏（消息历史）
	 * 始终作为一套完整的“聊天工作台”同步出现或隐藏。
	 */
	private readonly viewSwicthConsistenter: ViewSwitchConsistentHandler;

	// 存储视图创建函数的 Map。ViewCreator 是 Obsidian 用于按需实例化 View 的回调函数。
	private readonly viewCreators: Map<string, ViewCreator> = new Map();

	constructor(
		private readonly plugin: MyPlugin,
		public readonly appContext: AppContext,
	) {
		this.viewSwicthConsistenter = new ViewSwitchConsistentHandler(this.plugin.app);
		
		/**
		 * 注册三类核心自定义视图及其工厂函数：
		 * 
		 * 1. ChatView (中心面板):
		 *    - 核心交互区，包含 AI 会话、流式输出、附件上传。
		 * 
		 * 2. ProjectListView (左侧面板):
		 *    - 管理多个独立的聊天项目（Project）。
		 *    - 支持搜索、删除、置顶项目。
		 * 
		 * 3. MessageHistoryView (右侧面板):
		 *    - 用于展示当前 Active Conversation 的消息路径。
		 *    - 支持快速跳转到之前的消息上下文。
		 */
		this.viewCreators.set(CHAT_VIEW_TYPE, (leaf) => {
			return new ChatView(leaf, appContext);
		});
		this.viewCreators.set(PROJECT_LIST_VIEW_TYPE, (leaf) => {
			return new ProjectListView(leaf, appContext);
		});
		this.viewCreators.set(MESSAGE_HISTORY_VIEW_TYPE, (leaf) => {
			return new MessageHistoryView(leaf, appContext);
		});
	}

	/**
	 * 初始化：在插件加载时被 AppContext 调用。
	 * 完成 UI 相关的物理注册工作。
	 */
	init(): void {
		this.registerViews();
		this.registerRibbon();
	}

	/**
	 * 将 ViewCreator 绑定到特定的字符串 ID (type)。
	 * 注册后，Obsidian 就知道如何通过 `setViewState({ type: ... })` 来打开这些视图。
	 */
	private registerViews(): void {
		this.viewCreators.forEach((creator, type) => {
			this.plugin.registerView(type, creator);
		});
	}

	/**
	 * 获取布局协调器。常用于在命令注册中触发视图激活。
	 */
	getViewSwitchConsistentHandler(): ViewSwitchConsistentHandler {
		return this.viewSwicthConsistenter;
	}

	/**
	 * 获取 Obsidian App 管理实例。
	 */
	getApp(): App {
		return this.plugin.app;
	}

	/**
	 * 清理工作：在插件卸载时强制回收资源。
	 * 逻辑：
	 * 1. 遍历所有注册的任务视图类型。
	 * 2. 找到工作区中所有对应类型的叶片（Leaf）。
	 * 3. 执行 detach()，强制关闭并卸载，防止插件更新后旧视图依然驻留在内存。
	 */
	unload(): void {
		this.viewCreators.forEach((creator, type) => {
			this.plugin.app.workspace.getLeavesOfType(type).forEach((leaf) => leaf.detach());
		});
	}

	/**
	 * 创建 Ribbon 图标（Obsidian 左侧细长工具栏）。
	 * 点击此图标是进入“聊天模式”的最快方式。
	 */
	private registerRibbon(): void {
		this.plugin.addRibbonIcon('message-circle', 'Open Peak Assistant', () => {
			// 点击时触发全套布局的一体化切换
			void this.viewSwicthConsistenter.activateChatView();
		});
	}

	/**
	 * 这是一个辅助 UI 方法，弹出一个单行文本输入框。
	 * 在 React 外部调用 Obsidian 原生 UI 的桥梁。
	 * 
	 * @param message 提示语
	 * @returns 用户输入的字符串，取消则返回 null
	 */
	promptForInput(message: string): Promise<string | null> {
		return new Promise((resolve) => {
			const modal = new InputModal(this.plugin.app, message, (value) => resolve(value));
			modal.open();
		});
	}
}


