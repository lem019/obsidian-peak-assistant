import React from 'react';
import { ConversationList } from '@/ui/view/chat-view/components/conversation-list';
import { useChatViewStore } from './store/chatViewStore';

interface ProjectConversationsListViewProps {
}

/**
 * view-ProjectConversationsList.tsx
 * 
 * 【这个文件是干什么的】
 * 该文件定义了 `ProjectConversationsListViewComponent` 组件，专门用于展示**属于某个特定项目**的所有对话列表。
 * 
 * 【起了什么作用】
 * 1. **垂直内容锚定**：当用户进入项目详情页并选择查看“所有对话”时，该组件作为对应的子视图。
 * 2. **数据过滤展示**：它从 `chatViewStore` 中获取当前正在查看的项目对象 (`projectForOverview`)，并将该项目的 ID 传递给通用的 `ConversationList` 组件。
 * 3. **统一布局**：提供了一个简洁的头部（显示项目名称）和下方占满剩余空间的滚动列表区域。
 * 
 * 【举例介绍】
 * 用户点击了项目“Obsidian 插件开发”，然后在项目概览页面点击了“查看所有对话”。
 * 此时界面会切换到这个组件，它会在顶部显著地标出“Obsidian 插件开发”，然后列出这个项目下最近的所有交流记录。
 * 
 * 【技术实现】
 * - 依赖 `useChatViewStore`：通过 Store 获取 UI 层的上下文状态（当前处于哪个项目的概览中）。
 * - 复用 `ConversationList`：通过传入 `projectId` 属性，让通用的列表组件能够自动过滤并加载特定项目的对话。
 * - 错误处理：如果 Store 中没有合法的项目信息（比如非法跳转），则显示“Project not found”提示。
 */
export const ProjectConversationsListViewComponent: React.FC<ProjectConversationsListViewProps> = ({
}) => {
	// 获取 UI 视图状态管理 Store
	const store = useChatViewStore();
	// 获取当前正在概览的项目信息
	const project = store.projectForOverview;

	// 如果没有项目信息，返回异常占位内容
	if (!project) {
		return (
			<div className="pktw-flex pktw-items-center pktw-justify-center pktw-h-full pktw-text-muted-foreground">
				Project not found
			</div>
		);
	}

	return (
		<div className="pktw-flex pktw-flex-col pktw-h-full">
			{/* 项目头部：仅显示项目名称和简单的分割线 */}
			{/* Project Header */}
			<div className="pktw-flex pktw-items-center pktw-gap-2 pktw-p-4 pktw-border-b pktw-border-border">
				<h2 className="pktw-text-lg pktw-font-semibold pktw-text-foreground pktw-m-0">
					{project.meta.name}
				</h2>
			</div>

			{/* 对话列表区域：直接复用支持无限滚动的 ConversationList */}
			{/* Conversations List */}
			<div className="pktw-flex-1 pktw-overflow-hidden">
				<ConversationList
					projectId={project.meta.id}
					maxPreviewLength={150}
					emptyText="No conversations in this project yet."
				/>
			</div>
		</div>
	);
};