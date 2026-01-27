/**
 * ============================================================================
 * 文件说明: ServiceContext.tsx - 全局服务上下文
 * ============================================================================
 * 
 * 【这个文件是干什么的】
 * 这个文件是 React UI 层与插件后台服务之间的“传送门”。它利用 React 的 Context API，
 * 把各种强大的后台功能（比如 AI 对话服务、搜索服务、事件总线等）打包在一起，
 * 让界面里的任何一个小组件都能直接拿到这些服务。
 * 
 * 【起了什么作用】
 * 1. 依赖注入：避免了“属性钻取”（Prop Drilling）。不需要把服务从最顶层组件一层层传下去，
 *    代码更清爽，维护更方便。
 * 2. 统一管理：所有全局服务都在这里汇总，方便组件一站式调用。
 * 3. 跨层级共享：无论是深埋在菜单里的一个小按钮，还是主聊天界面，都能共享同一个 AI 服务的实例。
 * 
 * 【举例介绍】
 * 想象你在开发一个“发送消息”的按钮组件：
 * 
 * 如果没有这个文件：
 * 你得从 Main -> ChatView -> MessageInput -> SendButton 每一层都手动把 aiManager 传下去。
 * 
 * 有了这个文件：
 * 你只需要在 SendButton.tsx 里写一行：
 * const { manager } = useServiceContext();
 * 然后直接调用 manager.sendMessage(...) 即可。
 * 
 * 【技术实现】
 * - createContext: 创建一个存放服务的“容器”。
 * - ServiceProvider: 放在 UI 的最外层，负责“装载”这些服务。
 * - useServiceContext: 一个自定义钩子，让组件可以“抽取”服务。
 * ============================================================================
 */
import React, { createContext, useContext } from 'react';
import { App } from 'obsidian';
import { AIServiceManager } from '@/service/chat/service-manager';
import { EventBus } from '@/core/eventBus';
import { SearchClient } from '@/service/search/SearchClient';
import { ViewManager } from '@/app/view/ViewManager';
import type MyPlugin from 'main';

// ============================================================================
// 接口定义：规定了“传送门”里到底有哪些服务可用
// ============================================================================
/**
 * Service context value containing all global services
 */
interface ServiceContextValue {
	// Obsidian 官方的 App 对象，用于操作文件、Vault 等
	app: App;
	// AI 服务管理器：负责管理所有的 AI 对话、项目和设置（核心“大脑”）
	manager: AIServiceManager;
	// 全局事件总线：用于组件间收发消息（比如：搜索完成、消息发送成功等）
	eventBus: EventBus;
	// 搜索客户端：负责与索引底座通信，进行全文搜索或向量搜索（可能为空，因为搜索是可选功能）
	searchClient: SearchClient | null;
	// 视图管理器：负责管理插件的各种面板、弹窗的显示与隐藏
	viewManager: ViewManager;
	// 插件实例：指向 main.ts 里的主类，方便访问插件级别的 API
	plugin: MyPlugin;
}

// ============================================================================
// 创建容器：ServiceContext。默认值设为 null
// ============================================================================
const ServiceContext = createContext<ServiceContextValue | null>(null);

// ============================================================================
// 提供者组件：就像是一个“充电桩”，包裹在 UI 树的外层，给内部所有组件“供电”
// ============================================================================
/**
 * Provider component that wraps React components with service context
 */
export const ServiceProvider: React.FC<{
	children: React.ReactNode;
	app: App;
	manager: AIServiceManager;
	searchClient?: SearchClient | null;
	viewManager: ViewManager;
	eventBus?: EventBus;
	plugin: MyPlugin;
}> = ({ children, app, manager, searchClient = null, viewManager, eventBus, plugin }) => {
	// 如果传入了 eventBus 就用传入的，否则通过单例模式获取一个默认的
	const defaultEventBus = eventBus || EventBus.getInstance(app);

	return (
		// 利用 Provider 把收集到的各种服务向下分发
		// 凡是被 <ServiceProvider> 包裹的组件，都能通过 useServiceContext 获取这些值
		<ServiceContext.Provider value={{ app, manager, eventBus: defaultEventBus, searchClient, viewManager, plugin }}>
			{children}
		</ServiceContext.Provider>
	);
};

// ============================================================================
// 自定义钩子：组件只需要调用它，就能拿到所需的服务，非常丝滑
// ============================================================================
/**
 * Hook to access service context
 * @throws Error if used outside ServiceProvider
 */
export const useServiceContext = () => {
	// 从上下文中提取数据
	const context = useContext(ServiceContext);
	
	// 防错检查：如果开发者忘记在最外层加 Provider，直接报错提示，方便调试
	if (!context) {
		throw new Error('useServiceContext must be used within ServiceProvider');
	}
	
	// 返回所有服务
	return context;
};

