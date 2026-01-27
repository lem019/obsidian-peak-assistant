/**
 * 【这个文件是干什么的】
 * ChatViewComponent 是整个插件 UI 层的“总调度室”或“路由器根节点”。
 * 
 * 【起了什么作用】
 * 1. 视图切换：它根据 `useChatViewStore` 中的 `viewMode` 状态，决定到底渲染哪个具体的页面（如首页、项目列表、聊天对话等）。
 * 2. 全局通知：它集成了 `sonner` 库，作为 UI 层的全局通知接收器，通过 `eventBus` 监听来自插件各处的 `SHOW_TOAST` 事件并弹出气泡。
 * 3. 状态同步：监听 `eventBus` 的全局事件（如选中项变更），从而驱动 UI 状态的同步更新。
 * 
 * 【举例介绍】
 * 当用户在 Obsidian 的其他地方（或者通过命令）跳转到了一个新的对话，这个组件会通过 `ViewEventType.SELECTION_CHANGED` 捕获到，
 * 并自动加载对话内容，从而触发内部组件的重绘。
 * 
 * 【技术实现】
 * - 使用 Zustand (`useChatViewStore`) 来跟踪全局 UI 模式。
 * - 使用 `sonner` 库提供漂亮的吐司（Toast）提示。
 * - 纯函数式组件，通过 `switch-case` 模式实现轻量级路由。
 */
import React, { useEffect } from 'react';
import { ViewMode } from './store/chatViewStore';
import { AllProjectsViewComponent } from './view-AllProjects';
import { ProjectOverviewViewComponent } from './view-ProjectOverview';
import { ProjectConversationsListViewComponent } from './view-ProjectConversationsList';
import { MessagesViewComponent } from './view-Messages';
import { HomeViewComponent } from './view-Home';
import { SelectionChangedEvent, ShowToastEvent, ViewEventType } from '@/core/eventBus';
import { useServiceContext } from '@/ui/context/ServiceContext';
import { Toaster, toast as sonnerToast } from 'sonner';
import { ConversationList } from './components/conversation-list';
import { useChatViewStore } from './store/chatViewStore';

interface ChatViewComponentProps {
}

/**
 * Unified ChatView component that renders different views based on viewMode
 * 统一的聊天视图容器，根据不同的 viewMode 渲染对应的子视图
 */
export const ChatViewComponent: React.FC<ChatViewComponentProps> = () => {
	// 获取插件的全局服务上下文
	const { eventBus, manager } = useServiceContext();
	// 从 Zustand store 中取出当前的视图模式
	const { viewMode } = useChatViewStore();

	// ============================================================================
	// 监听全局吐司消息事件 (Toast Messages)
	// ============================================================================
	// Listen for toast events from other React instances
	useEffect(() => {
		// 监听展示通知的事件，这样非 React 逻辑的代码也能触发 UI 上的通知
		const unsubscribe = eventBus.on<ShowToastEvent>(
			ViewEventType.SHOW_TOAST,
			(event) => {
				const toastOptions = {
					description: event.description,
					duration: event.duration,
					action: event.action,
				};

				// 根据类型弹出不同颜色的提示框
				switch (event.toastType) {
					case 'success':
						sonnerToast.success(event.message, toastOptions);
						break;
					case 'error':
						sonnerToast.error(event.message, toastOptions);
						break;
					case 'warning':
						sonnerToast.warning(event.message, toastOptions);
						break;
					case 'info':
						sonnerToast.info(event.message, toastOptions);
						break;
					default:
						sonnerToast(event.message, toastOptions);
						break;
				}
			}
		);

		// 组件销毁时取消订阅，防止内存泄漏
		return () => {
			unsubscribe();
		};
	}, [eventBus]);

	// ============================================================================
	// 监听选定内容变更 (Selection Changed)
	// ============================================================================
	useEffect(() => {
		// 比如当由于某些操作切换了对话 ID 时
		const unsubscribe = eventBus.on<SelectionChangedEvent>(
			ViewEventType.SELECTION_CHANGED,
			async (event) => {
				if (!event.conversationId) {
					return;
				}
				console.log('[ChatView] Selection changed to conversation:', event.conversationId);
				// 通过 manager 加载这个对话的完整数据
				// Just load the conversation by id using aiServiceManager
				const conversation = await manager.readConversation(event.conversationId);
				if (conversation) {
					// 更新 store，内部的子视图（如 MessagesViewComponent）会自动感应并渲染新对话
					useChatViewStore.getState().setConversation(conversation);
				}
			}
		);

		return () => {
			unsubscribe();
		};
	}, [eventBus, manager]);

	// 如果没有任何视图模式（理论上不该发生），就不渲染
	// Render body content based on viewMode
	if (!viewMode) {
		console.error('No view mode selected');
		return null;
	}

	/**
	 * 核心路由逻辑：根据当前的 viewMode 决定展示哪个“二级页面”
	 */
	const renderContent = () => {
		switch (viewMode) {
			case ViewMode.HOME:
				// 展示欢迎首页
				return (
					<HomeViewComponent />
				);
			case ViewMode.ALL_PROJECTS:
				// 展示项目列表页
				return (
					<AllProjectsViewComponent />
				);
			case ViewMode.ALL_CONVERSATIONS:
				// 展示全部历史对话列表
				return (
					<ConversationList
						containerClass="pktw-w-4/6 pktw-mx-auto"
						maxPreviewLength={100}
						emptyText="No conversations yet."
					/>
				);
			case ViewMode.PROJECT_OVERVIEW:
				// 展示单个项目的概览
				return (
					<ProjectOverviewViewComponent />
				);
			case ViewMode.PROJECT_CONVERSATIONS_LIST:
				// 展示属于某个项目的对话列表
				return (
					<ProjectConversationsListViewComponent />
				);
			case ViewMode.CONVERSATION_IN_PROJECT:
			case ViewMode.STANDALONE_CONVERSATION:
				// 展示具体的聊天会话视图（最核心的聊天界面）
				return (
					<MessagesViewComponent />
				);
			default:
				return null;
		}
	};

	return (
		<>
			{/* 渲染动态内容 */}
			{renderContent()}
			{/* 全局通知容器，Sonner 需要挂载在这里才能生效 */}
			<Toaster position="top-center" richColors />
		</>
	);
};

