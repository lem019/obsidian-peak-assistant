/**
 * @file AppContext.ts
 * @description 应用上下文容器。这是插件的“单一真理来源”（Single Source of Truth），
 * 包含了所有全局单例服务（AI管理器、搜索客户端、视图管理器等）。
 * 它被传递给几乎所有的 UI 组件，以便它们能够访问底层服务。
 */

import { App } from 'obsidian';
import { AIServiceManager } from '@/service/chat/service-manager';
import { SearchClient } from '@/service/search/SearchClient';
import { ViewManager } from '@/app/view/ViewManager';
import type MyPlugin from 'main';
import { MyPluginSettings } from '../settings/types';
import { BusinessError, ErrorCode } from '@/core/errors';
import { EventBus, ViewEventType } from '@/core/eventBus';

/**
 * 应用程序上下文，包含所有全局依赖项。
 * 
 * 职责：
 * 1. 作为单例容器，提供对底层核心服务的集中访问。
 * 2. 协调不同层级（Service, View, Store）之间的通信和数据共享。
 * 3. 维护插件运行时的动态状态（如当前设置）。
 */
export class AppContext {
	// 视图管理器：负责管理 Obsidian 侧边栏和主编辑区的自定义 View。
	// 注意：该属性采用后期注入模式，在 ViewManager 构造时会回填此属性。
	public viewManager: ViewManager;

	/** 全局单例引用 */
	private static instance: AppContext | null = null;

	/**
	 * 获取当前的上下文实例（单例访问点）。
	 * 
	 * 如果在初始化前调用将抛出错误，确保依赖在系统各处都已就绪。
	 * 通常用于异步非组件代码中需要访问 AI 代理或搜索数据库的情况。
	 */
	public static getInstance(): AppContext {
		if (!AppContext.instance) {
			throw new BusinessError(
				ErrorCode.CONFIGURATION_MISSING,
				'AppContext is not initialized'
			);
		}
		return AppContext.instance;
	}

	constructor(
		// Obsidian 原生 App 实例，用于访问 Vault、Workspace 等基础能力
		public readonly app: App,
		// AI 服务管理器：负责处理聊天会话、模型调用、项目项目管理等核心业务逻辑。
		// 它是所有 LLM 交互的聚合入口。
		public readonly manager: AIServiceManager,
		// 搜索客户端：负责处理本地知识库的向量搜索或全文搜索请求。
		// 封装了与 SQLite 存储库的交互。
		public readonly searchClient: SearchClient,
		// 插件主实例（main.ts 中的类），用于访问插件自身的生命周期和全局状态。
		public readonly plugin: MyPlugin,
		// 插件设置：当前用户的配置信息（API Key、模型选择等）。
		public settings: MyPluginSettings,
	) {
		// 注册当前实例为全局单例
		AppContext.instance = this;
		
		// 初始时 viewManager 为空，需等待 ViewManager 初始化完成后通过外部赋值完成闭环
		this.viewManager = null as any;

		// 响应式更新设置：通过事件总线监听设置变更通知。
		// 当用户在设置面板修改配置并点击保存后会触发此订阅，确保上下文中的配置保持最新。
		EventBus.getInstance(app).on(ViewEventType.SETTINGS_UPDATED, (event) => {
			this.settings = this.plugin!.settings!;
		});
	}
}


