import React from 'react';
import { useProjectStore } from '@/ui/store/projectStore';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/ui/component/shared-ui/hover-card';
import { IconButton } from '@/ui/component/shared-ui/icon-button';
import { Brain } from 'lucide-react';

/**
 * SummaryPopover.tsx
 * 
 * 【这个文件是干什么的】
 * 该文件定义了 `SummaryPopover` 组件，它是一个悬浮卡片，用于展示当前对话的 AI 生成总结。
 * 这个总结可以帮助用户快速回顾长对话的核心要点。
 * 
 * 【起了什么作用】
 * 1. **上下文快照**：当对话变得非常长时，用户可能忘记了开头的细节。通过点击“大脑”图标，用户可以立即看到 AI 对整个会话的摘要（短摘要或详尽总结）。
 * 2. **信息检索效率**：无需向上滚动翻阅数百条消息，即可获取会话的结论。
 * 3. **状态感性展示**：如果 AI 尚未生成总结，会友好地提示“No summary available”。
 * 
 * 【举例介绍】
 * - 用户在进行复杂的代码重构方案讨论。
 * - 讨论了 20 轮之后，用户点击标题栏右侧的 Brain 图标。
 * - 弹窗内清晰显示：“本会话主要讨论了 Redux 切换到 Zustand 的方案，确立了使用 persist 插件处理持久化的原则，并解决了初始化竞态问题。”
 * 
 * 【技术实现】
 * 1. **状态驱动**：从 `useProjectStore` 中响应式地获取 `activeConversation` 对象。
 * 2. **多级回退策略**：渲染逻辑优先查找 `shortSummary`（更适合快速阅读），如果不存在则显示 `fullSummary`。
 * 3. **UI 实现**：利用 `HoverCard`（基于 Radix UI）实现非阻塞式的悬浮显示，`pktw-whitespace-pre-wrap` 确保 AI 生成的换行符能正确显示。
 */

/**
 * Popover component for displaying conversation summary
 * 对话总结悬浮组件
 */
export const SummaryPopover: React.FC = () => {
	// 从状态仓库获取当前活跃对话
	const conversation = useProjectStore((state) => state.activeConversation);

	// 获取总结内容（优先使用短摘要）
	const summary = conversation?.context?.shortSummary || conversation?.context?.fullSummary;

	// 如果没有激活的对话，不渲染组件
	if (!conversation) {
		return null;
	}

	return (
		<HoverCard openDelay={200} closeDelay={300}>
			{/* 触发图标：使用 Brain 图标形象地表示“总结/记忆” */}
			<HoverCardTrigger asChild>
				<IconButton
					size="lg"
					title="View conversation summary"
					className="hover:pktw-bg-gray-200"
				>
					<Brain className="pktw-w-4 pktw-h-4 pktw-text-muted-foreground group-hover:pktw-text-black" />
				</IconButton>
			</HoverCardTrigger>

			{/* 悬浮内容区 */}
			<HoverCardContent
				className="pktw-w-[400px] pktw-max-w-[90vw] pktw-p-4 pktw-bg-white pktw-shadow-lg"
				align="end"
				side="bottom"
				sideOffset={8}
				collisionPadding={16}
			>
				<div className="pktw-flex pktw-flex-col pktw-gap-2">
					{/* 标题 */}
					<div className="pktw-text-lg pktw-font-semibold pktw-border-b pktw-border-border pktw-pb-2">
						Conversation Summary
					</div>

					{/* 总结正文 */}
					{summary ? (
						<div className="pktw-whitespace-pre-wrap pktw-text-sm pktw-text-foreground pktw-select-text pktw-max-h-[400px] pktw-overflow-y-auto">
							{summary}
						</div>
					) : (
						<div className="pktw-text-sm pktw-text-muted-foreground pktw-text-center pktw-py-4">
							No summary available
						</div>
					)}
				</div>
			</HoverCardContent>
		</HoverCard>
	);
};

