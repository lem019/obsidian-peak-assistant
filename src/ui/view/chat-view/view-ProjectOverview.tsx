import React, { useState, useEffect, useCallback } from 'react';
import { ChatConversation, ChatProject } from '@/service/chat/types';
import { cn } from '@/ui/react/lib/utils';
import { Folder, MessageCircle, MessageSquare, Calendar, Star, FileText, Image, File } from 'lucide-react';
import { useServiceContext } from '@/ui/context/ServiceContext';
import { ConversationItem } from '@/ui/view/chat-view/components/conversation-item';
import { Button } from '@/ui/component/shared-ui/button';
import { getFileIconByName, getFileTypeByName } from '@/ui/view/shared/file-utils';
import { ResourceAttachmentEntry, useProjectLoad, useConversationLoad, StarredEntry } from './hooks';
import { openAttachment } from '@/core/utils/vault-utils';
import { useChatViewStore } from './store/chatViewStore';
import { ProjectSummary } from './components/project-summary';
import { ConversationList } from './components/conversation-list';

/**
 * view-ProjectOverview.tsx
 * 
 * 【这个文件是干什么的】
 * 该文件定义了 `ProjectOverviewViewComponent` 组件，它是特定项目（Project）的“仪表盘”或“详情页”。
 * 它不仅仅是一个列表，而是一个聚合了项目统计数据、智能摘要、对话历史、收藏消息和相关资源的综合性视图。
 * 
 * 【起了什么作用】
 * 1. **全景展示**：通过统计卡片（对话数、消息总数）让用户直观了解项目的活跃度。
 * 2. **标签页导航**：实现了“Conversations”（对话历史）、“Starred”（收藏精选）、“Resources”（附件资源）三个维度的内容切换。
 * 3. **智能摘要集成**：在对话页签顶部展示 AI 自动生成的项目总结，帮助用户快速找回项目背景。
 * 4. **跨维度链接**：支持从收藏列表直接跳转并滚动到原会话的特定消息，也支持直接打开关联的 PDF/图片等资源。
 * 
 * 【举例介绍】
 * 用户点击“Python 学习笔记”项目进入该页面：
 * - 顶部看到：“15 个对话，120 条消息”。
 * - “Conversations” 标签下显示由 AI 总结出来的“当前正在研究 FastAPI 的中间件实现”概要。
 * - “Starred” 标签下存着之前 AI 解释得特别好的一段闭包代码。
 * - “Resources” 标签下列出了本项目中引用过的所有参考 PDF 手册。
 * 
 * 【技术实现】
 * - **自定义 Hook 驱动**：使用 `useProjectLoad` 统一处理该项目下所有数据的聚合加载（对话、收藏标记、资源等）。
 * - **复合视图模式**：采用局部 `useState` (activeTab) 切换内嵌的 `ConversationsTab`, `StarredTab`, `ResourcesTab` 子组件。
 * - **响应式布局**：主体内容通过 `w-4/6 mx-auto` 保持在视觉中心，模仿现代化笔记应用的 Dashboard 布局。
 * - **联动跳转**：利用 `useConversationLoad` 提供的工具函数实现点击收藏消息时的复杂视图状态切换。
 */

interface ProjectOverviewViewProps {
}

type TabType = 'conversations' | 'starred' | 'resources';

interface ProjectStatsCardProps {
	icon: React.ReactNode;
	label: string;
	value: number;
	color: string;
}

/**
 * Component for displaying a single project statistics card
 * 项目统计卡片组件：以精美卡片形式展示数字指标
 */
const ProjectStatsCard: React.FC<ProjectStatsCardProps> = ({ icon, label, value, color }) => {
	return (
		<div className="pktw-flex pktw-items-center pktw-gap-4 pktw-p-6 pktw-rounded-xl pktw-border pktw-border-border pktw-bg-card pktw-shadow-md pktw-min-w-[200px]">
			{/* 图标背景容器，根据传入的颜色动态渲染（注意：Tailwind 类型需完整以防被 tree-shaking） */}
			<div className={`pktw-p-3 pktw-rounded-lg pktw-bg-${color}-500/10`}>
				<div className={`pktw-text-${color}-600 dark:pktw-text-${color}-400`}>
					{icon}
				</div>
			</div>
			<div className="pktw-flex pktw-flex-col">
				<span className="pktw-text-sm pktw-font-medium pktw-text-muted-foreground">{label}</span>
				<span className="pktw-text-3xl pktw-font-bold pktw-text-foreground">{value}</span>
			</div>
		</div>
	);
};

/**
 * Project overview view component
 * 项目概览主组件
 */
export const ProjectOverviewViewComponent: React.FC<ProjectOverviewViewProps> = () => {
	const store = useChatViewStore();

	// 从 Store 获取当前正在查看的项目 ID
	const projectId = store.projectForOverview?.meta.id;
	if (!projectId) {
		return (
			<div className="pktw-flex pktw-items-center pktw-justify-center pktw-h-full pktw-text-muted-foreground">
				No project selected.
			</div>
		);
	}

	// 页签切换状态
	const [activeTab, setActiveTab] = useState<TabType>('conversations');

	// 加载项目相关的全量数据
	// Use unified project load hook for state management
	const {
		project,
		conversations,
		starredEntries,
		resources,
		totalMessages,
		summaryText,
	} = useProjectLoad(projectId);

	// 未找到项目时的占位渲染
	if (!project) {
		return (
			<div className="pktw-flex pktw-items-center pktw-justify-center pktw-h-full pktw-text-muted-foreground">
				Project not found
			</div>
		);
	}

	return (
		<div className="pktw-flex pktw-flex-col pktw-h-full pktw-overflow-hidde">
			{/* 主内容滚动容器，限制宽度以提升阅读体验 */}
			<div className="pktw-flex-1 pktw-overflow-y-auto pktw-pt-10 pktw-w-4/6 pktw-mx-auto">
				
				{/* 第一部分：顶部统计卡片组 */}
				{/* Stats */}
				<div className="pktw-flex pktw-justify-center pktw-gap-6 pktw-mb-8">
					<ProjectStatsCard
						icon={<MessageCircle className="pktw-w-6 pktw-h-6" />}
						label="Conversations"
						value={conversations.length}
						color="blue"
					/>
					<ProjectStatsCard
						icon={<MessageSquare className="pktw-w-6 pktw-h-6" />}
						label="Messages"
						value={totalMessages}
						color="green"
					/>
				</div>

				{/* 第二部分：页签导航条 */}
				{/* Tab Navigation */}
				<div className="pktw-flex pktw-justify-center pktw-gap-1 pktw-border-b pktw-border-border pktw-mb-6">
					{(['conversations', 'starred', 'resources'] as TabType[]).map((tab) => (
						<Button
							key={tab}
							variant="ghost"
							className={cn(
								'pktw-px-4 pktw-py-2.5 pktw-text-xl pktw-font-medium pktw-transition-all pktw-relative',
								'pktw-border-b-2 pktw-border-transparent',
								activeTab === tab
									? 'pktw-text-primary pktw-border-primary'
									: 'pktw-text-muted-foreground'
							)}
							onClick={() => setActiveTab(tab)}
						>
							{tab === 'conversations' && 'Conversations'}
							{tab === 'starred' && 'Starred Messages'}
							{tab === 'resources' && 'Resources'}
						</Button>
					))}
				</div>

				{/* 第三部分：页签具体内容 */}
				{/* Tab Content */}
				<div>
					{activeTab === 'conversations' && (
						<ConversationsTab
							projectId={projectId}
							summaryText={summaryText}
						/>
					)}
					{activeTab === 'starred' && (
						<StarredTab
							entries={starredEntries}
							project={project}
						/>
					)}
					{activeTab === 'resources' && (
						<ResourcesTab
							resources={resources}
						/>
					)}
				</div>
			</div>
		</div>
	);
};

interface ConversationsTabProps {
	projectId: string;
	summaryText?: string;
}

/**
 * 对话历史页签组件
 */
const ConversationsTab: React.FC<ConversationsTabProps> = ({
	projectId,
	summaryText,
}) => {

	const { loadConversation } = useConversationLoad();

	const [summaryExpanded, setSummaryExpanded] = useState<boolean>(summaryText ? true : false);

	return (
		<div className="pktw-space-y-3">
			{/* 项目智能摘要：如果 AI 生成了总结，则在对话列表上方展示 */}
			{/* Project Summary */}
			{/* Place here to make Tabs seem more balanced. Make ui more balanced. Choose Conv Tabs because it has more content. */}
			<ProjectSummary
				summaryText={summaryText}
				summaryExpanded={summaryExpanded}
				onSummaryExpandedChange={setSummaryExpanded}
			/>

			{/* 业务核心：本项目的对话流列表 */}
			<ConversationList
				projectId={projectId}
				maxPreviewLength={150}
				emptyText="No conversations in this project yet."
			/>
		</div>
	);
};

interface StarredTabProps {
	entries: StarredEntry[];
	project: ChatProject;
}

/**
 * 收藏消息页签组件：展示用户在会话中手动 Star 的精选片段
 */
const StarredTab: React.FC<StarredTabProps> = ({ entries }) => {

	const { openConvAndScroll2Msg } = useConversationLoad();

	// 无收藏时的占位
	if (entries.length === 0) {
		return (
			<div className="pktw-text-center pktw-text-muted-foreground pktw-py-12">
				<Star className="pktw-w-12 pktw-h-12 pktw-mx-auto pktw-mb-3 pktw-opacity-50" />
				<p className="pktw-text-sm">No starred messages yet.</p>
			</div>
		);
	}

	return (
		<div className="pktw-space-y-3">
			{entries.map((entry, index) => {
				const messageContent = entry.message.content || '';
				const truncated = messageContent.length > 200
					? messageContent.substring(0, 200) + '...'
					: messageContent;
				return (
					<div
						key={`${entry.conversation.meta.id}-${entry.message.id}-${index}`}
						className={cn(
							'pktw-p-4 pktw-rounded-lg pktw-border pktw-border-muted-foreground/20 pktw-bg-card pktw-shadow-sm',
							'pktw-cursor-pointer pktw-transition-all',
							'hover:pktw-shadow-md hover:pktw-border-border-hover hover:pktw-bg-accent/50'
						)}
						// 点击收藏消息：跳转到对应对话，并自动定位到这条消息的位置
						onClick={() => openConvAndScroll2Msg(entry.conversation.meta.id, entry.message.id)}
					>
						<div className="pktw-flex pktw-items-center pktw-gap-2 pktw-mb-2">
							<Star className="pktw-w-4 pktw-h-4 pktw-fill-yellow-400 pktw-text-yellow-400 pktw-shrink-0" />
							<div className="pktw-text-xs pktw-font-medium pktw-text-muted-foreground pktw-truncate">
								{entry.conversation.meta.title}
							</div>
						</div>
						{messageContent && (
							<div className="pktw-text-sm pktw-text-foreground pktw-line-clamp-3 pktw-leading-relaxed pktw-mt-1">
								{truncated}
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
};

interface ResourcesTabProps {
	resources: ResourceAttachmentEntry[];
}

/**
 * 项目资源页签组件：集中展示该项目中引用过的文件附件
 */
const ResourcesTab: React.FC<ResourcesTabProps> = ({ resources }) => {

	const { app } = useServiceContext();

	// 无附件时的占位
	if (resources.length === 0) {
		return (
			<div className="pktw-text-center pktw-text-muted-foreground pktw-py-12">
				<FileText className="pktw-w-12 pktw-h-12 pktw-mx-auto pktw-mb-3 pktw-opacity-50" />
				<p className="pktw-text-sm">No resources attached yet.</p>
			</div>
		);
	}

	return (
		<div className="pktw-space-y-3">
			{resources.map((entry, index) => {
				const FileIcon = getFileIconByName(entry.resourceLabel);
				const fileType = getFileTypeByName(entry.resourceLabel);
				return (
					<div
						key={`${entry.conversation.meta.id}-${entry.resource}-${index}`}
						className={cn(
							'pktw-flex pktw-items-center pktw-gap-3 pktw-p-4 pktw-rounded-lg pktw-border pktw-border-muted-foreground/20 pktw-bg-card pktw-shadow-sm',
							'pktw-cursor-pointer pktw-transition-all',
							'hover:pktw-shadow-md hover:pktw-border-border-hover hover:pktw-bg-accent/50'
						)}
						// 点击资源：调用 Obsidian API 打开附件
						onClick={() => openAttachment(app, entry.resource)}
					>
						<div className="pktw-p-2 pktw-rounded-md pktw-bg-muted pktw-shrink-0">
							<FileIcon className="pktw-w-5 pktw-h-5 pktw-text-muted-foreground" />
						</div>
						<div className="pktw-flex-1 pktw-min-w-0">
							<div className="pktw-text-sm pktw-font-medium pktw-text-foreground pktw-truncate pktw-mb-1">
								{entry.conversation.meta.title} - {entry.resourceLabel}
							</div>
						</div>
						{/* 文件类型标签（PDF, IMAGE, MD 等） */}
						<div className="pktw-px-2.5 pktw-py-1 pktw-rounded-md pktw-bg-muted pktw-text-xs pktw-font-medium pktw-text-muted-foreground pktw-shrink-0 pktw-uppercase">
							{fileType}
						</div>
					</div>
				);
			})}
		</div>
	);
};

