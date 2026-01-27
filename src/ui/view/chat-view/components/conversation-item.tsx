import React from 'react';
import { ChatConversation } from '@/service/chat/types';
import { formatRelativeDate } from '@/ui/view/shared/date-utils';
import { cn } from '@/ui/react/lib/utils';
import { MessageSquare, Calendar } from 'lucide-react';

/**
 * conversation-item.tsx
 * 
 * 【这个文件是干什么的】
 * 该文件定义了 `ConversationItem` 组件，它是对话列表中的单个列表项（卡片）。
 * 用于在项目主页或历史记录中展示单个对话的摘要信息。
 * 
 * 【起了什么作用】
 * 1. **信息概览**：展示对话标题、第一条消息的文本预览以及创建时间。
 * 2. **视觉一致性**：为所有对话项提供统一的阴影、圆角、边框以及 Hover 高亮效果。
 * 3. **交互触发**：作为进入对话的入口，用户点击此项将触发跳转到对应会话详情的操作。
 * 
 * 【举例介绍】
 * - 在一个项目的“概览”页面，会展示最近的 5 场对话。
 * - 每场对话都会渲染为一个 `ConversationItem` 卡片，左侧是气泡图标，中间显示“如何使用 SQL 进行复杂查询...”，右侧显示“2小时前”。
 * 
 * 【技术实现】
 * 1. **文本切割**：通过 `maxPreviewLength` 参数（默认 150 字符）截断首条消息内容，并自动添加省略号，防止长文本撑破 UI。
 * 2. **样式控制**：使用 Tailwind 的 `pktw-line-clamp-2` 确保预览区域最多占据两行，保持列表整齐。
 * 3. **工具函数集成**：调用 `formatRelativeDate` 将原始时间戳转换为易读的相对时间（如“刚刚”、“3天前”）。
 */

export interface ConversationItemProps {
	/** 对话数据对象 */
	conversation: ChatConversation;
	/** 点击回调，通常用于导航到该对话 */
	onClick: (conversation: ChatConversation) => void;
	/** 是否显示对话图标 (默认为 true) */
	showIcon?: boolean;
	/** 是否显示创建时间 (默认为 true) */
	showDate?: boolean;
	/** 预览文本的最大字数限制 */
	maxPreviewLength?: number;
	/** 自定义样式类 */
	className?: string;
}

/**
 * Unified conversation item component
 * 统一的对话项组件，提供一致的样式和悬停效果
 */
export const ConversationItem: React.FC<ConversationItemProps> = ({
	conversation,
	onClick,
	showIcon = true,
	showDate = true,
	maxPreviewLength = 150,
	className,
}) => {
	// 提取首条消息内容作为预览文本
	const previewText = conversation.messages.length > 0
		? conversation.messages[0].content.substring(0, maxPreviewLength)
		: '';

	return (
		<div
			className={cn(
				'pktw-p-4 pktw-transition-all pktw-cursor-pointer pktw-border pktw-border-solid pktw-border-border-default pktw-rounded-lg pktw-shadow-sm pktw-bg-card',
				'hover:pktw-shadow-lg hover:pktw-border-border-hover',
				className
			)}
			onClick={() => onClick(conversation)}
		>
			<div className="pktw-flex pktw-items-center pktw-justify-between">
				{/* 左侧及中间内容区 */}
				<div className="pktw-flex pktw-items-center pktw-gap-3 pktw-flex-1">
					{/* 对话图标 */}
					{showIcon && (
						<div className="pktw-p-2 pktw-rounded-lg pktw-bg-muted">
							<MessageSquare className="pktw-h-5 pktw-w-5 pktw-text-muted-foreground" />
						</div>
					)}
					{/* 标题与预览 */}
					<div className="pktw-flex-1">
						<div className="pktw-text-sm pktw-font-medium pktw-text-foreground">
							{conversation.meta.title}
						</div>
						{previewText && (
							<div className="pktw-text-xs pktw-text-muted-foreground pktw-mt-0.5 pktw-line-clamp-2">
								{previewText}
								{conversation.messages[0].content.length > maxPreviewLength ? '...' : ''}
							</div>
						)}
					</div>
				</div>
				
				{/* 右侧：时间统计 */}
				{showDate && conversation.meta.createdAtTimestamp && (
					<div className="pktw-flex pktw-items-center pktw-gap-1 pktw-text-xs pktw-text-muted-foreground">
						<Calendar className="pktw-h-3 pktw-w-3" />
						{formatRelativeDate(conversation.meta.createdAtTimestamp)}
					</div>
				)}
			</div>
		</div>
	);
};

