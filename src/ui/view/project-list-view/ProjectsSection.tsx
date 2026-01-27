import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ChatConversation, ChatProject } from '@/service/chat/types';
import { openSourceFile } from '@/ui/view/shared/view-utils';
import { useProjectStore } from '@/ui/store/projectStore';
import { useChatViewStore } from '../chat-view/store/chatViewStore';
import { notifySelectionChange, hydrateProjects as hydrateProjectsFromManager, showContextMenu } from './utils';
import { InputModal } from '@/ui/component/shared-ui/InputModal';
import { Button } from '@/ui/component/shared-ui/button';
import { IconButton } from '@/ui/component/shared-ui/icon-button';
import { ChevronDown, ChevronRight, Folder, FolderOpen, Plus, MoreHorizontal, Calendar } from 'lucide-react';
import { cn } from '@/ui/react/lib/utils';
import { useServiceContext } from '@/ui/context/ServiceContext';
import { ViewEventType, ConversationUpdatedEvent, ConversationCreatedEvent } from '@/core/eventBus';
import { DEFAULT_NEW_CONVERSATION_TITLE, MAX_CONVERSATIONS_DISPLAY, MAX_PROJECTS_DISPLAY, MAX_CONVERSATIONS_PER_PROJECT } from '@/core/constant';
import { formatRelativeDate } from '@/ui/view/shared/date-utils';
import { ConversationList } from './ConversationsSection';

/**
 * ProjectsSection.tsx
 * 
 * 【这个文件是干什么的】
 * 该文件定义了项目列表的核心展示逻辑，包括目录树形式的 `ProjectItem`（单个项目项）以及聚合所有项目的 `ProjectsSection`（项目区块）。
 * 
 * 【起了什么作用】
 * 1. **树形结构渲染**：实现了类似文件管理器的折叠/展开效果。顶层是“项目”，展开后是该项目下的“对话”。
 * 2. **交互管理**：处理项目改名、对话重命名、新建对话以及查看“更多对话”页面的路由跳转。
 * 3. **上下文菜单**：集成了右键菜单功能，允许用户快速编辑属性或打开关联的源文件。
 * 4. **视觉反馈**：通过图标切换（Folder/FolderOpen）和动画（max-h 转换）提供即时的操作反馈。
 * 
 * 【举例介绍】
 * 用户在左侧边栏看到“AI 写作助手”项目，点击它：
 * - 项目下方会滑出最近的 5 条对话。
 * - 用户可以点击“+ New conversation”在此项目下直接开启新聊天。
 * - 如果对话太多，下方会出现“See more”，点击后主视图会切换到该项目的完整对话索引页。
 * 
 * 【技术实现】
 * - **递归与分层渲染**：`ProjectsSection` 遍历所有项目，并为每个项目渲染一个 `ProjectItem`。
 * - **状态联动**：项目项的展开状态存储在 `useProjectStore` 中，确保即使切换了视图再回来，用户的折叠习惯依然保留。
 * - **右键菜单抽象**：使用 `showContextMenu` 统一处理复杂的 DOM 点击坐标与菜单渲染。
 * - **受限展示**：通过 `MAX_CONVERSATIONS_PER_PROJECT` 常量控制侧边栏的整洁度，避免过长的列表撑爆侧边栏。
 */

interface ProjectsSectionProps {
}

interface ProjectItemProps {
	project: ChatProject;
	isExpanded: boolean;
	conversations: ChatConversation[];
	typewriterEnabled: Map<string, boolean>;
	onTypewriterComplete: (conversationId: string) => void;
}

/**
 * 单个项目项组件：负责渲染项目标题行及展开后的下属对话
 */
const ProjectItem: React.FC<ProjectItemProps> = ({
	project,
	isExpanded,
	conversations,
	typewriterEnabled,
	onTypewriterComplete,
}) => {
	const { app, manager } = useServiceContext();
	// 直接从 Store 获取状态，避免 Props 层层传递
	const {
		projects,
		activeConversation,
		activeProject,
		setActiveProject,
		setActiveConversation,
		toggleProjectExpanded,
		updateProject,
		updateConversation,
	} = useProjectStore();
	const { setProjectOverview, setProjectConversationsList, setPendingConversation } = useChatViewStore();

	// 限制展示数量，保持 UI 简洁
	const conversationsToShow = conversations.slice(0, MAX_CONVERSATIONS_PER_PROJECT);
	const hasMoreConversations = conversations.length > MAX_CONVERSATIONS_PER_PROJECT;

	// 输入模态框管理
	const [inputModalOpen, setInputModalOpen] = useState(false);
	const [inputModalConfig, setInputModalConfig] = useState<{
		message: string;
		onSubmit: (value: string | null) => Promise<void>;
		initialValue?: string;
		placeholderText?: string;
		hintText?: string;
		submitButtonText?: string;
	} | null>(null);

	/**
	 * 判断当前对话是否正在被激活查看
	 */
	const isConversationActive = useCallback((conversation: ChatConversation): boolean => {
		return activeConversation?.meta.id === conversation.meta.id;
	}, [activeConversation]);

	/**
	 * 点击项目头部：展开/收起，并进入项目概览页
	 */
	const handleProjectHeaderClick = async () => {
		toggleProjectExpanded(project.meta.id);
		setActiveProject(project);
		setProjectOverview(project);
	};

	/**
	 * 点击具体的对话项
	 */
	const handleConversationClick = async (conversation: ChatConversation) => {
		// 发起全局通知，让 ViewManager 处理视图切换和高亮
		await notifySelectionChange(app, conversation);
	};

	/**
	 * 在此项目下新建对话
	 */
	const handleNewConversation = async () => {
		setActiveProject(project);
		setPendingConversation({
			title: DEFAULT_NEW_CONVERSATION_TITLE,
			project: project,
		});
		await notifySelectionChange(app, null);
	};

	/**
	 * 修改项目名称逻辑
	 */
	const handleEditProjectName = useCallback((projectItem: ChatProject) => {
		setInputModalConfig({
			message: 'Rename Project',
			placeholderText: 'Project name',
			initialValue: projectItem.meta.name,
			onSubmit: async (newName: string | null) => {
				if (!newName || !newName.trim()) return;

				try {
					const updatedProject = await manager.renameProject(projectItem.meta.id, newName.trim());
					updateProject(updatedProject);
					// 如果重命名的是当前激活的项目，同步更新激活状态
					if (activeProject?.meta.id === projectItem.meta.id) {
						setActiveProject(updatedProject);
					}
				} catch (error) {
					console.error('Failed to rename project', error);
				}
			},
		});
		setInputModalOpen(true);
	}, [manager, updateProject, activeProject, setActiveProject]);

	/**
	 * 修改对话标题逻辑
	 */
	const handleEditConversationTitle = useCallback((
		projectItem: ChatProject | null,
		conversation: ChatConversation
	) => {
		setInputModalConfig({
			message: 'Update Title',
			placeholderText: 'Conversation title',
			initialValue: conversation.meta.title,
			onSubmit: async (newTitle: string | null) => {
				if (!newTitle || !newTitle.trim()) return;

				try {
					await manager.updateConversationTitle({
						conversationId: conversation.meta.id,
						title: newTitle.trim(),
					});
					const updatedConversation = await manager.readConversation(conversation.meta.id, false);
					if (!updatedConversation) {
						throw new Error('Failed to update conversation title');
					}
					// 更新 Store，UI 会自动反应
					updateConversation(updatedConversation);

					if (isConversationActive(conversation)) {
						setActiveConversation(updatedConversation);
					}
				} catch (error) {
					console.error('Failed to update conversation title', error);
				}
			},
		});
		setInputModalOpen(true);
	}, [manager, updateConversation, isConversationActive, setActiveConversation]);

	/**
	 * 构建项目右键菜单配置
	 */
	// Menu item configurations
	const projectMenuItems = useCallback((projectItem: ChatProject) => [
		{
			title: 'Rename project',
			icon: 'pencil',
			onClick: () => handleEditProjectName(projectItem),
		},
		// Note: Projects don't have files, so this menu item is removed
	], [app, handleEditProjectName]);

	/**
	 * 构建对话右键菜单配置
	 */
	const conversationMenuItems = useCallback((conversation: ChatConversation) => {
		const projectItem = conversation.meta.projectId ? projects.get(conversation.meta.projectId) || null : null;
		return [
			{
				title: 'Edit title',
				icon: 'pencil',
				onClick: () => handleEditConversationTitle(projectItem, conversation),
			},
			{
				title: 'Open source file',
				icon: 'file-text',
				onClick: async () => {
					// 直接跳转到 Obsidian 对应的存储文件
					await openSourceFile(app, conversation.file);
				},
			},
		];
	}, [app, projects, handleEditConversationTitle]);

	/**
	 * 统一右键上下文菜单处理器
	 */
	const handleContextMenu = (
		e: React.MouseEvent,
		type: 'project' | 'conversation',
		item: ChatProject | ChatConversation
	) => {
		const menuItems = type === 'project'
			? projectMenuItems(item as ChatProject)
			: conversationMenuItems(item as ChatConversation);
		showContextMenu(e, menuItems);
	};

	return (
		<div
			className="pktw-flex pktw-flex-col pktw-mb-0.5"
			data-project-id={project.meta.id}
		>
			{/* 项目标题行：具有高亮交互效果 */}
			{/* Project Header */}
			<div
				className="pktw-flex pktw-items-center pktw-gap-2 pktw-px-2 pktw-py-1.5 pktw-rounded pktw-cursor-pointer pktw-bg-transparent pktw-transition-colors pktw-min-h-8 pktw-select-none hover:pktw-bg-muted pktw-group"
				onClick={handleProjectHeaderClick}
				onContextMenu={(e) => handleContextMenu(e, 'project', project)}
			>
				{/* 根据展开状态切换箭头和文件夹图标 */}
				{isExpanded ? (
					<>
						<ChevronDown className="pktw-w-3.5 pktw-h-3.5 pktw-shrink-0 pktw-text-foreground group-hover:pktw-text-gray-900 pktw-transition-colors" />
						<FolderOpen className="pktw-w-4 pktw-h-4 pktw-shrink-0 pktw-text-foreground group-hover:pktw-text-gray-900 pktw-transition-colors" />
					</>
				) : (
					<>
						<ChevronRight className="pktw-w-3.5 pktw-h-3.5 pktw-shrink-0 pktw-text-foreground group-hover:pktw-text-gray-900 pktw-transition-colors" />
						<Folder className="pktw-w-4 pktw-h-4 pktw-shrink-0 pktw-text-foreground group-hover:pktw-text-gray-900 pktw-transition-colors" />
					</>
				)}
				<span className="pktw-flex-1 pktw-text-sm pktw-text-foreground pktw-break-words pktw-leading-snug">
					{project.meta.name}
				</span>
			</div>

			{/* 下属内容容器：处理展开动画和交互可用性 */}
			{/* Conversations */}
			<div className={cn(
				'pktw-flex pktw-flex-col pktw-gap-px pktw-ml-7 pktw-overflow-hidden pktw-transition-all pktw-duration-150 pktw-ease-in-out',
				isExpanded
					? 'pktw-max-h-[5000px] pktw-opacity-100 pktw-mt-0.5 pointer-events-auto'
					: 'pktw-max-h-0 pktw-opacity-0 pktw-mt-0 pointer-events-none'
			)}>
				{/* 快捷新建对话按钮 */}
				{/* New conversation button */}
				<div
					className="pktw-w-full pktw-px-2 pktw-py-1.5 pktw-rounded pktw-text-[13px] pktw-min-h-7 pktw-mb-0.5 pktw-bg-transparent pktw-text-muted-foreground hover:pktw-bg-muted hover:pktw-text-foreground pktw-transition-colors pktw-cursor-pointer pktw-flex pktw-items-center pktw-justify-center"
					onClick={(e) => {
						e.stopPropagation();
						handleNewConversation();
					}}
					role="button"
					tabIndex={0}
					onKeyDown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							e.stopPropagation();
							handleNewConversation();
						}
					}}
				>
					+ New conversation
				</div>

				{/* 具体的对话列表渲染 */}
				{/* Render conversations */}
				<div className="pktw-ml-7">
					<ConversationList
						conversations={conversationsToShow}
						activeConversation={activeConversation}
						typewriterEnabled={typewriterEnabled}
						onConversationClick={(conv) => {
							handleConversationClick(conv);
						}}
						onContextMenu={(e, conv) => {
							e.stopPropagation();
							handleContextMenu(e, 'conversation', conv);
						}}
						onTypewriterComplete={(conversationId) => onTypewriterComplete(conversationId)}
						showIndicator={true}
					/>
				</div>

				{/* “查看更多”提示行：当对话数量超过限制时出现 */}
				{hasMoreConversations && (
					<div
						className="pktw-flex pktw-items-center pktw-gap-1.5 pktw-px-3 pktw-py-1.5 pktw-mx-6 pktw-my-1 pktw-rounded-md pktw-text-muted-foreground pktw-text-xs pktw-transition-all pktw-cursor-pointer hover:pktw-bg-muted hover:pktw-text-foreground"
						onClick={(e) => {
							e.stopPropagation();
							// Show all conversations for this project in list view
							setProjectConversationsList(project);
						}}
					>
						<MoreHorizontal className="pktw-w-3.5 pktw-h-3.5" />
						<span className="pktw-flex-1">See more</span>
					</div>
				)}
			</div>

			{/* 用于修改名称的浮层模态框 */}
			{/* Input Modal */}
			{inputModalConfig && (
				<InputModal
					open={inputModalOpen}
					onOpenChange={setInputModalOpen}
					message={inputModalConfig.message}
					onSubmit={inputModalConfig.onSubmit}
					initialValue={inputModalConfig.initialValue}
					placeholderText={inputModalConfig.placeholderText}
					hintText={inputModalConfig.hintText}
					submitButtonText={inputModalConfig.submitButtonText}
				/>
			)}
		</div>
	);
};

/**
 * Projects section component
 * 项目区块主组件：负责聚合、排序所有项目并响应全局事件
 */
export const ProjectsSection: React.FC<ProjectsSectionProps> = () => {
	const { manager, eventBus } = useServiceContext();
	const {
		projects,
		expandedProjects,
		isProjectsCollapsed,
		toggleProjectsCollapsed,
	} = useProjectStore();
	const { setAllProjects } = useChatViewStore();

	const [projectConversations, setProjectConversations] = useState<
		Map<string, ChatConversation[]>
	>(new Map());
	const [typewriterEnabled, setTypewriterEnabled] = useState<Map<string, boolean>>(new Map());
	const [inputModalOpen, setInputModalOpen] = useState(false);
	const [inputModalConfig, setInputModalConfig] = useState<{
		message: string;
		onSubmit: (value: string | null) => Promise<void>;
		initialValue?: string;
		placeholderText?: string;
		hintText?: string;
		submitButtonText?: string;
	} | null>(null);

	// Load conversations for a project
	const loadProjectConversations = useCallback(
		async (project: ChatProject) => {
			const conversations = await manager.listConversations(project.meta.id);
			conversations.sort((a, b) => {
				const timeA = a.meta.createdAtTimestamp || 0;
				const timeB = b.meta.createdAtTimestamp || 0;
				return timeB - timeA;
			});
			setProjectConversations((prev) => {
				const next = new Map(prev);
				next.set(project.meta.id, conversations);
				return next;
			});
			// Sync conversations to store so they can be found by ID
			// Use getState() to get latest conversations without causing dependency loop
			const { conversations: currentConversations, setConversations: updateConversations } = useProjectStore.getState();
			const allConversations = new Map(currentConversations);
			conversations.forEach(conv => {
				allConversations.set(conv.meta.id, conv);
			});
			updateConversations(Array.from(allConversations.values()));
			return conversations;
		},
		[manager]
	);

	// Load conversations when project is expanded
	useEffect(() => {
		expandedProjects.forEach((projectId) => {
			const project = projects.get(projectId);
			if (project) {
				// Always reload to get latest data (handles external updates)
				loadProjectConversations(project);
			}
		});
	}, [expandedProjects, projects, loadProjectConversations]);

	// Listen for conversation updates and reload project conversations if needed
	useEffect(() => {
		const unsubscribeUpdated = eventBus.on<ConversationUpdatedEvent>(
			ViewEventType.CONVERSATION_UPDATED,
			async (event) => {
				const conversation = event.conversation;
				console.log('[ProjectsSection] CONVERSATION_UPDATED event:', {
					conversationId: conversation.meta.id,
					projectId: conversation.meta.projectId,
					title: conversation.meta.title,
					timestamp: Date.now()
				});
				// Enable typewriter effect for this conversation
				setTypewriterEnabled(prev => {
					const next = new Map(prev);
					next.set(conversation.meta.id, true);
					return next;
				});
				// If conversation belongs to a project and that project is expanded, reload its conversations
				if (conversation.meta.projectId) {
					const project = projects.get(conversation.meta.projectId);
					if (project && expandedProjects.has(conversation.meta.projectId)) {
						await loadProjectConversations(project);
					}
				}
			}
		);

		const unsubscribeCreated = eventBus.on<ConversationCreatedEvent>(
			ViewEventType.CONVERSATION_CREATED,
			(event) => {
				console.log('[ProjectsSection] CONVERSATION_CREATED event:', {
					conversationId: event.conversationId,
					timestamp: Date.now()
				});
				// Enable typewriter effect for new conversation
				setTypewriterEnabled(prev => {
					const next = new Map(prev);
					next.set(event.conversationId, true);
					return next;
				});
			}
		);

		return () => {
			unsubscribeUpdated();
			unsubscribeCreated();
		};
	}, [eventBus, projects, expandedProjects, loadProjectConversations]);

	const handleTypewriterComplete = useCallback((conversationId: string) => {
		setTypewriterEnabled(prev => {
			const next = new Map(prev);
			next.delete(conversationId);
			return next;
		});
	}, []);

	const handleCreateProject = () => {
		setInputModalConfig({
			message: 'Create Project',
			placeholderText: 'Project name',
			hintText: 'Projects keep chats, files, and custom instructions in one place. Use them for ongoing work, or just to keep things tidy.',
			submitButtonText: 'Create project',
			onSubmit: async (name: string | null) => {
				if (!name || !name.trim()) return;
				await manager.createProject({ name: name.trim() });
				await hydrateProjectsFromManager(manager);
			},
		});
		setInputModalOpen(true);
	};

	const { projectsToShow, hasMoreProjects } = useMemo(() => {
		const list = Array.from(projects.values()).sort((a, b) => {
			const timeA = a.meta.createdAtTimestamp || 0;
			const timeB = b.meta.createdAtTimestamp || 0;
			return timeB - timeA;
		});
		return {
			projectsToShow: list.slice(0, MAX_PROJECTS_DISPLAY),
			hasMoreProjects: projects.size > MAX_PROJECTS_DISPLAY,
		};
	}, [projects]);

	return (
		<div className="pktw-flex pktw-flex-col">
			{/* Header */}
			<div
				className="pktw-flex pktw-items-center pktw-justify-between pktw-gap-2 pktw-cursor-pointer pktw-rounded pktw-transition-all hover:pktw-bg-muted hover:pktw-shadow-sm pktw-group"
				onClick={() => toggleProjectsCollapsed()}
			>
				<div className="pktw-flex pktw-items-center pktw-gap-2">
					{isProjectsCollapsed ? (
						<ChevronRight className="pktw-w-3 pktw-h-3 pktw-shrink-0 pktw-text-foreground group-hover:pktw-text-gray-900 pktw-transition-colors" />
					) : (
						<ChevronDown className="pktw-w-3 pktw-h-3 pktw-shrink-0 pktw-text-foreground group-hover:pktw-text-gray-900 pktw-transition-colors" />
					)}
					<h3 className="pktw-flex-1 pktw-m-0 pktw-text-[13px] pktw-font-semibold pktw-text-foreground pktw-uppercase pktw-tracking-wide">Projects</h3>
				</div>
				<IconButton
					size="lg"
					className="pktw-shrink-0 group-hover:pktw-bg-gray-200 group-hover:pktw-shadow-sm hover:pktw-shadow-sm"
					onClick={(e) => {
						e.stopPropagation();
						handleCreateProject();
					}}
					title="New Project"
				>
					<Plus className="pktw-text-foreground group-hover:pktw-text-gray-900 pktw-transition-colors" />
				</IconButton>
			</div>

			{/* Projects List */}
			<div className={cn(
				'pktw-flex pktw-flex-col pktw-gap-px pktw-overflow-hidden pktw-transition-all pktw-duration-150 pktw-ease-in-out',
				isProjectsCollapsed
					? 'pktw-max-h-0 pktw-opacity-0'
					: 'pktw-max-h-[5000px] pktw-opacity-100'
			)}>
				{projectsToShow.map((project) => (
					<ProjectItem
						key={project.meta.id}
						project={project}
						isExpanded={expandedProjects.has(project.meta.id)}
						conversations={projectConversations.get(project.meta.id) || []}
						typewriterEnabled={typewriterEnabled}
						onTypewriterComplete={handleTypewriterComplete}
					/>
				))}

				{hasMoreProjects && (
					<div
						className="pktw-flex pktw-items-center pktw-gap-2 pktw-px-3 pktw-py-2 pktw-my-1 pktw-rounded-md pktw-text-muted-foreground pktw-text-[13px] pktw-transition-all pktw-cursor-pointer hover:pktw-bg-muted hover:pktw-text-foreground"
						onClick={() => setAllProjects()}
					>
						<MoreHorizontal className="pktw-w-4 pktw-h-4" />
						<span className="pktw-flex-1">See more</span>
					</div>
				)}
			</div>

			{/* Modal */}
			{inputModalConfig && (
				<InputModal
					open={inputModalOpen}
					onOpenChange={setInputModalOpen}
					message={inputModalConfig.message}
					onSubmit={inputModalConfig.onSubmit}
					initialValue={inputModalConfig.initialValue}
					placeholderText={inputModalConfig.placeholderText}
					hintText={inputModalConfig.hintText}
					submitButtonText={inputModalConfig.submitButtonText}
				/>
			)}
		</div>
	);
};

