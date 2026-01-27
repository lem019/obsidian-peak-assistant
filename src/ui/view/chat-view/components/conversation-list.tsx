import React, { useState, useEffect, useCallback } from 'react';
import { ChatConversation } from '@/service/chat/types';
import { ConversationItem } from './conversation-item';
import { useServiceContext } from '@/ui/context/ServiceContext';
import { useConversationLoad } from '../hooks';
import { cn } from '@/ui/react/lib/utils';

/**
 * conversation-list.tsx
 * 
 * 【这个文件是干什么的】
 * 该文件定义了 `ConversationList` 组件，它是对话项的列表容器。
 * 它封装了从服务端加载、分页展示、无限滚动（Loading More）以及内容过滤（根据项目 ID）的逻辑。
 * 
 * 【起了什么作用】
 * 1. **数据拉取与展示**：自动从 `manager` 获取历史对话数据，并将每条数据渲染为 `ConversationItem`。
 * 2. **无限滚动加载**：通过检测页面底部的哨兵元素，实现用户下拉时自动加载下一页，提供流畅的瀑布流体验。
 * 3. **空状态处理**：内置 Loading 指示和无数据时的 Empty 提示。
 * 4. **组件化封装**：可以轻松嵌入到项目详情页（展示该项目的对话）或主侧边栏（展示独立对话）。
 * 
 * 【举例介绍】
 * - 在“我的项目 A”页面，`ConversationList` 传入 `projectId="proj_A"`，它会显示该项目下的所有对话。
 * - 用户向下滚动到列表末尾，触发无限滚动逻辑，额外加载 20 条旧对话。
 * 
 * 【技术实现】
 * 1. **状态机控制**：管理 `conversations` (列表数据), `conversationsPage` (当前页码), `loading` (加载中状态), 以及 `hasMore` (是否还有更多内容)。
 * 2. **IntersectionObserver**：利用原生浏览器的交叉观察器监听 `sentinelRef`（哨兵 Div），实现零 JS 库依赖的高性能无限滚动。
 * 3. **自适应查询 (useCallback)**：`loadConversations` 封装了 API 调用，每次请求 `PAGE_SIZE + 1` 条数据来判断后续是否还有更多内容。
 * 4. **业务钩子集成**：使用 `useConversationLoad` 钩子处理点击对话后的各种中间逻辑（如状态清理、视图切换等）。
 */

export interface ConversationListProps {
	/** 列表容器的 CSS 类 */
	containerClass?: string;
	/**
	 * 可选的项目 ID，用于过滤对话。
	 * 如果未提供，则仅加载不属于任何项目的“独立对话”。
	 */
	projectId?: string;
	/**
	 * 对话预览文本的最大长度
	 */
	maxPreviewLength?: number;
	/**
	 * 加载中提示语
	 */
	loadingText?: string;
	/**
	 * 无数据时的占位语
	 */
	emptyText?: string;
}

// 每页加载的对话数量
const CONVERSATIONS_PAGE_SIZE = 20;

/**
 * Generic conversation list component with pagination and infinite scroll
 * 通用的对话列表组件，支持分页和无限滚动
 */
export const ConversationList: React.FC<ConversationListProps> = ({
	containerClass,
	projectId,
	maxPreviewLength = 100,
	loadingText = "Loading conversations...",
	emptyText = "No conversations yet.",
}) => {
	const { manager } = useServiceContext();
	const { loadConversation } = useConversationLoad();

	// 核心列表状态
	const [conversations, setConversations] = useState<ChatConversation[]>([]);
	const [conversationsPage, setConversationsPage] = useState(0);
	const [loading, setLoading] = useState(true);
	const [hasMore, setHasMore] = useState(true);

	/**
	 * 执行加载逻辑，请求指定页码的数据
	 */
	const loadConversations = useCallback(async (page: number) => {
		// 加载当前页 + 1 条 extra，用于检测 hasMore
		const conversationsWithExtra = await manager.listConversations(
			projectId || null,
			CONVERSATIONS_PAGE_SIZE + 1,
			page * CONVERSATIONS_PAGE_SIZE
		);

		// 如果没有 projectId，则只显示独立会话
		let filteredConversations = conversationsWithExtra;
		if (!projectId) {
			filteredConversations = conversationsWithExtra.filter(
				(c) => !c.meta.projectId
			);
		}

		const conversations = filteredConversations.slice(0, CONVERSATIONS_PAGE_SIZE);
		const hasMore = filteredConversations.length > CONVERSATIONS_PAGE_SIZE;

		return {
			conversations,
			hasMore,
		};
	}, [manager, projectId]);

	// 初次加载第一页数据
	useEffect(() => {
		const loadFirstPage = async () => {
			setLoading(true);
			try {
				const result = await loadConversations(0);
				setConversations(result.conversations);
				setHasMore(result.hasMore);
				setConversationsPage(1);
			} catch (error) {
				console.error('Failed to load conversations:', error);
			} finally {
				setLoading(false);
			}
		};
		loadFirstPage();
	}, [loadConversations]);

	// --- 无限滚动逻辑设置 ---
	const sentinelRef = React.useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!sentinelRef.current || !hasMore) return;

		const observer = new IntersectionObserver(
			async (entries) => {
				entries.forEach(async (entry) => {
					// 当哨兵可见且还有记录时，加载下一页
					if (entry.isIntersecting && hasMore) {
						try {
							const result = await loadConversations(conversationsPage);
							if (result.conversations.length > 0) {
								setConversations((prev) => [...prev, ...result.conversations]);
								setHasMore(result.hasMore);
								setConversationsPage((prev) => prev + 1);
							} else {
								setHasMore(false);
							}
						} catch (error) {
							console.error('Failed to load more conversations:', error);
							setHasMore(false);
						}
					}
				});
			},
			{ threshold: 0.1 }
		);

		observer.observe(sentinelRef.current);

		return () => {
			observer.disconnect();
		};
	}, [conversationsPage, loadConversations, hasMore]);

	// 处理初始加载状态
	if (loading && conversations.length === 0) {
		return (
			<div className="pktw-flex pktw-items-center pktw-justify-center pktw-h-full pktw-text-muted-foreground">
				{loadingText}
			</div>
		);
	}

	// 处理空列表状态
	if (conversations.length === 0) {
		return (
			<div className="pktw-flex pktw-items-center pktw-justify-center pktw-h-full pktw-text-muted-foreground">
				{emptyText}
			</div>
		);
	}

	return (
		<div className={cn("pktw-flex pktw-flex-col pktw-h-full pktw-overflow-y-auto", containerClass)}>
			<div className="pktw-flex pktw-flex-col pktw-gap-1 pktw-p-4">
				{conversations.map((conversation) => (
					<ConversationItem
						key={conversation.meta.id}
						conversation={conversation}
						onClick={() => loadConversation(conversation.meta.id)}
						maxPreviewLength={maxPreviewLength}
					/>
				))}
			</div>

			{/* 无限滚动哨兵：一旦滚动到这里，就会触发 handleMore 加载更多数据 */}
			{hasMore && (
				<div
					ref={sentinelRef}
					className="pktw-h-4 pktw-w-full"
					aria-hidden="true"
				/>
			)}
		</div>
	);
};