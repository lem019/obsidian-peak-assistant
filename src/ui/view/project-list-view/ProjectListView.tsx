import React, { useEffect, useCallback } from 'react';
import { ProjectsSection } from './ProjectsSection';
import { ConversationsSection } from './ConversationsSection';
import { useProjectStore } from '@/ui/store/projectStore';
import { useChatViewStore } from '@/ui/view/chat-view/store/chatViewStore';
import { ViewEventType, SelectionChangedEvent, ConversationUpdatedEvent } from '@/core/eventBus';
import { notifySelectionChange, hydrateProjects } from './utils';
import { RefreshCw, Minus, Home } from 'lucide-react';
import { IconButton } from '@/ui/component/shared-ui/icon-button';
import { useServiceContext } from '@/ui/context/ServiceContext';
import { showToast } from '@/ui/utils/toast';

/**
 * ProjectListView.tsx
 * 
 * 【这个文件是干什么的】
 * 该文件定义了 `ProjectListViewComponent` 组件，它是 Obsidian 左侧边栏（或是对话列表面板）的核心容器。
 * 它负责展示导航树，包括所有的“项目”以及属于这些项目的“对话”。
 * 
 * 【起了什么作用】
 * 1. **数据中枢**：负责初次打开插件时从后端 API (manager) 加载全量的项目和对话数据，并同步到全局的 `projectStore`。
 * 2. **三级导航容器**：内嵌了 `ProjectsSection`（项目列表）和 `ConversationsSection`（对话列表），形成了“项目 -> 对话”的层级结构。
 * 3. **实时同步**：监听 `eventBus` 的各种事件（如 `SELECTION_CHANGED`, `CONVERSATION_UPDATED`），确保左侧边栏的选中状态、未读状态和展开/折叠状态能够响应全局变化。
 * 4. **快捷操作栏**：提供了“回首页”、“刷新”以及“全部收起”三个全局按钮，方便用户管理繁杂的列表。
 * 
 * 【举例介绍】
 * 当用户在右侧的消息历史里点开了一个属于“学术论文”项目的对话时：
 * 1. `eventBus` 会抛出一个 `SELECTION_CHANGED` 事件。
 * 2. 本组件捕获此事件，自动高亮该对话。
 * 3. 如果“学术论文”项目原本是折叠的，本组件还会自动将其展开，确保用户能看清当前位置。
 * 
 * 【技术实现】
 * - **数据刷新逻辑 (`hydrateData`)**：封装了重新从后端拉取数据并保持当前“激活项”逻辑不丢失的复杂流程。
 * - **多层高亮策略**：通过 `activeProject` 和 `activeConversation` 的 ID 匹配来驱动子项的高亮演示。
 * - **事件总线监听**：深度集成 `eventBus`，不仅处理自身的更新，还通过 `notifySelectionChange` 通知其他视图（如中间聊天区）进行切换。
 */

/**
 * Main React component for ProjectListView
 * 项目列表视图主组件
 */
export const ProjectListViewComponent: React.FC = () => {
	const { app, manager, eventBus } = useServiceContext();
	const chatViewStore = useChatViewStore();
	// 从全局项目 Store 获取状态和操作方法
	const {
		setProjects,
		setConversations,

		activeProject,
		activeConversation,

		setActiveProject,
		setActiveConversation,
		clearExpandedProjects,
	} = useProjectStore();

	/**
	 * 从后端重新同步数据 (Hydrate)
	 * 确保 UI 展示的数据与数据库保持一致
	 */
	// Hydrate data
	const hydrateData = useCallback(async () => {
		// 1. 加载项目列表
		// Load projects
		await hydrateProjects(manager);
		const projectsMap = useProjectStore.getState().projects;
		const projectsList = Array.from(projectsMap.values());

		// 2. 校验并重新锁定当前激活的项目对象（因为重新加载后对象引用变了）
		// Validate and update activeProject
		if (activeProject) {
			const latestProject = projectsMap.get(activeProject.meta.id);
			if (latestProject) {
				setActiveProject(latestProject);
			} else {
				setActiveProject(null);
			}
		}

		// 3. 加载全量对话列表，并按时间倒序排列
		// Load conversations
		const conversationsList = await manager.listConversations(null);
		conversationsList.sort((a, b) => {
			const timeA = a.meta.createdAtTimestamp || 0;
			const timeB = b.meta.createdAtTimestamp || 0;
			return timeB - timeA;
		});
		setConversations(conversationsList);
		const conversationsMap = useProjectStore.getState().conversations;

		// 4. 同理，校验并更新激活的对话对象
		// Validate and update activeConversation
		if (activeConversation) {
			const latestConversation = conversationsMap.get(activeConversation.meta.id);
			if (latestConversation) {
				setActiveConversation(latestConversation);
			} else {
				setActiveConversation(null);
			}
		}

		// 5. 补丁逻辑：如果当前没有选中的对话，默认选中列表中的第一个（最新的）
		// Set default activeConversation if none is selected
		if (!activeConversation && conversationsMap.size > 0) {
			const sortedConversations = Array.from(conversationsMap.values()).sort((a, b) => {
				const timeA = a.meta.createdAtTimestamp || 0;
				const timeB = b.meta.createdAtTimestamp || 0;
				return timeB - timeA;
			});
			setActiveConversation(sortedConversations[0]);
		}
	}, [
		manager,
		activeProject,
		activeConversation,
		setProjects,
		setConversations,
		setActiveProject,
		setActiveConversation,
	]);

	// 组件挂载时，自动触发一次数据加载
	// Initial load
	useEffect(() => {
		hydrateData();
	}, []);

	/**
	 * 返回首页视图
	 */
	// Navigate to home view
	const handleGoHome = () => {
		chatViewStore.setHome();
	};

	/**
	 * 手动刷新按钮逻辑
	 */
	// Refresh projects and conversations
	const handleRefresh = async () => {
		try {
			// 先清除掉所有展开状态，让列表回归整洁
			clearExpandedProjects();
			await hydrateData();
			// 发起全局通知，确保其他面板同步更新
			// Dispatch selection changed event
			await notifySelectionChange(app);
			// 弹出成功提示
			// Show success toast (will be displayed in ChatView)
			showToast.success('Projects and conversations refreshed', { app });
		} catch (error) {
			// Show error toast
			showToast.error('Failed to refresh data', {
				app,
				description: error instanceof Error ? error.message : 'Unknown error'
			});
		}
	};

	/**
	 * 全局事件订阅
	 * 处理来自插件各处的选中通知，实现 UI 的联动收起/展开和高亮
	 */
	// Subscribe to conversation and project update events
	useEffect(() => {
		// 监听“选中项变更”事件
		// Subscribe to selection changed events to handle expand/collapse and highlight the active conversation
		// this event may come from message send, markdown view mode, or just expanding a project or conversation
		const unsubscribeSelection = eventBus.on<SelectionChangedEvent>(
			ViewEventType.SELECTION_CHANGED,
			async (event) => {
				const { setActiveProject, setActiveConversation, toggleProjectExpanded, expandedProjects, projects, conversations } = useProjectStore.getState();

				// 根据传入的 ID 更新 store 中的当前激活项
				// Set active selection by ID
				// Only update if IDs are different to avoid unnecessary updates
				if (event.projectId) {
					const project = projects.get(event.projectId);
					if (project) {
						setActiveProject(project);
					}
				} else {
					setActiveProject(null);
				}

				if (event.conversationId) {
					const conversation = conversations.get(event.conversationId);
					if (conversation) {
						setActiveConversation(conversation);
					} else {
						// Conversation not found in store, this shouldn't happen but log for debugging
						console.warn('Conversation not found in store:', event.conversationId);
					}
				} else {
					setActiveConversation(null);
				}

				// 联动逻辑：如果选中了一个项目里的内容，但项目目前是折叠的，则强制展开它
				// Only expand if project is not already expanded (to avoid collapsing when clicking conversation)
				if (event.projectId && !expandedProjects.has(event.projectId)) {
					toggleProjectExpanded(event.projectId);
				}
			}
		);

		// Subscribe to conversation updated events to refresh the UI when a conversation is created or updated
		const unsubscribeConversationUpdated = eventBus.on<ConversationUpdatedEvent>(
			ViewEventType.CONVERSATION_UPDATED,
			async (event) => {
				const { updateConversation, expandedProjects, projects } = useProjectStore.getState();
				const conversation = event.conversation;

				// Update conversation in store
				updateConversation(conversation);

				// If conversation belongs to a project and that project is expanded,
				// trigger a reload of project conversations to show the new/updated conversation
				if (conversation.meta.projectId) {
					const project = projects.get(conversation.meta.projectId);
					if (project && expandedProjects.has(conversation.meta.projectId)) {
						// Trigger reload by dispatching a custom event that ProjectsSection can listen to
						// Or we can directly call the reload function if we have access to it
						// For now, we'll rely on ProjectsSection to handle this via a separate mechanism
						// The conversation is already in the store, so ProjectsSection should pick it up
					}
				}
			}
		);

		return () => {
			unsubscribeSelection();
			unsubscribeConversationUpdated();
		};
	}, [eventBus, manager]);

	return (
		<div className="pktw-flex pktw-flex-col pktw-h-full pktw-p-0 pktw-box-border pktw-overflow-y-auto pktw-bg-background">
			
			{/* 顶部工具栏：提供全局控制按钮 */}
			{/* Toolbar */}
			<div className="pktw-flex pktw-flex-row pktw-items-center pktw-gap-1 pktw-border-b pktw-border-border pktw-px-2 pktw-pt-1">
				{/* 回到首页按钮 */}
				<IconButton
					size="lg"
					className="pktw-shrink-0"
					onClick={handleGoHome}
					title="Go to home"
				>
					<Home className="pktw-text-foreground group-hover:pktw-text-gray-900 pktw-transition-colors" />
				</IconButton>
				
				{/* 刷新数据按钮 */}
				<IconButton
					size="lg"
					className="pktw-shrink-0"
					onClick={handleRefresh}
					title="Refresh projects and conversations"
				>
					<RefreshCw className="pktw-text-foreground group-hover:pktw-text-gray-900 pktw-transition-colors" />
				</IconButton>

				{/* 全部折叠按钮：一键让侧边栏回归清爽 */}
				<IconButton
					size="lg"
					className="pktw-shrink-0"
					onClick={() => clearExpandedProjects()}
					title="Collapse all projects"
				>
					<Minus className="pktw-text-foreground group-hover:pktw-text-gray-900 pktw-transition-colors" />
				</IconButton>
			</div>

			{/* 中间自适应区域：分别渲染“项目”和“对话”两个区块 */}
			<div className="pktw-px-3 pktw-pb-6">
				{/* 1. 项目区块：展示树状结构的工程历史 */}
				{/* Projects Section */}
				<ProjectsSection />

				{/* 2. 对话区块：展示不属于任何项目的独立对话 */}
				{/* Conversations Section */}
				<ConversationsSection />
			</div>
		</div>
	);
};

