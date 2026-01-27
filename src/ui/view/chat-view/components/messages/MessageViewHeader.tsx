import React, { useState, useEffect } from 'react';
import { useProjectStore } from '@/ui/store/projectStore';
import { IconButton } from '@/ui/component/shared-ui/icon-button';
import { Folder, RefreshCw } from 'lucide-react';
import { useServiceContext } from '@/ui/context/ServiceContext';
import { cn } from '@/ui/react/lib/utils';
import { ConversationUpdatedEvent, ViewEventType } from '@/core/eventBus';
import { useTypewriterEffect } from '@/ui/view/shared/useTypewriterEffect';
import { TYPEWRITER_EFFECT_SPEED_MS } from '@/core/constant';
import { ResourcesPopover } from './ResourcesPopover';
import { SummaryPopover } from './SummaryPopover';
import { OpenMenuButton } from './OpenMenuButton';

/**
 * MessageViewHeader.tsx
 * 
 * 【这个文件是干什么的】
 * 本文件是对话视图的顶部标题栏组件 `MessageHeader`。它负责展示当前对话的上下文信息（如所属项目、对话标题）、
 * 提供对话标题的自动生成/重新生成功能，并集成了资源管理、会话总结和快捷菜单等操作入口。
 * 
 * 【起了什么作用】
 * 1. **状态展示**：清晰地显示当前用户正在哪个项目（Project）下，进行哪场对话（Conversation）。
 * 2. **动态更新**：监听对话更新事件，当 AI 自动生成或更新对话标题时，提供平滑的打字机文字效果或动态扫描动画。
 * 3. **交互入口**：
 *    - **标题重生成**：允许用户触发 AI 重新理解会话并生成更精准的标题。
 *    - **资源中心 (ResourcesPopover)**：查看和管理当前对话关联的所有背景资料、文档和多媒体资源。
 *    - **总结中心 (SummaryPopover)**：一键查看会话的摘要总结，快速回顾核心内容。
 *    - **更多操作 (OpenMenuButton)**：包括在独立窗口打开、跳转源代码、删除会话等扩展功能。
 * 
 * 【举例介绍】
 * - 用户新建了一场对话，初始标题可能是“新对话”。
 * - 当 AI 回复后，后台自动触发标题生成。`MessageHeader` 接收到 `CONVERSATION_UPDATED` 事件，
 *   标题文字会通过打字机效果逐渐变为 AI 生成的“关于 React Hooks 的深度讨论”。
 * - 如果用户觉得标题不够好，点击标题旁边的刷新图标，标题会进入彩色流光动画（扫描效果），表示正在重新生成。
 * 
 * 【技术实现】
 * 1. **状态管理**：通过 `useProjectStore` 获取当前激活的项目和会话元数据（meta）。
 * 2. **事件驱动**：利用 `eventBus` 订阅 `ViewEventType.CONVERSATION_UPDATED`，确保标题栏能够实时响应由于异步 AI 任务导致的对话变更。
 * 3. **打字机特效**：自定义 Hook `useTypewriterEffect` 封装了文字逐字出现的逻辑，配合 `enableTypewriter` 状态控制何时使用特效（通常仅在 AI 更新时使用，切换会话时不使用）。
 * 4. **动画效果**：
 *    - 背景扫描动画：使用 CSS `@keyframes scanEffect` 和 `linear-gradient` 实现文字色彩循环流动的效果，指示标题正在生成中。
 *    - 图标动画：使用 Tailwind 的 `pktw-animate-spin` 实现刷新按钮的持续旋转。
 * 5. **组合模式**：将复杂的浮窗功能外包给 `ResourcesPopover` 和 `SummaryPopover`，保持主标题栏组件简洁清晰。
 */

interface MessageHeaderProps {
}

/**
 * Component for rendering message header with title, model selector, and stats
 * 对话头部组件，渲染标题、关联项目、模型选择及统计信息
 */
export const MessageHeader: React.FC<MessageHeaderProps> = ({
}) => {
	// 获取全局服务上下文（包含事件总线和业务管理器）
	const { app, eventBus, manager } = useServiceContext();
	// 从状态仓库订阅激活的对话和项目数据
	const activeConversation = useProjectStore((state) => state.activeConversation);
	const activeProject = useProjectStore((state) => state.activeProject);
	
	// 维护本地标题状态，以便进行打字机特效处理
	const [displayTitle, setDisplayTitle] = useState(activeConversation?.meta.title || '');
	// 是否开启打字机效果
	const [enableTypewriter, setEnableTypewriter] = useState(false);
	// 是否正在重生成标题（显示流光特效）
	const [isRegeneratingTitle, setIsRegeneratingTitle] = useState(false);

	// 监听对话标题更新事件
	useEffect(() => {
		const unsubscribe = eventBus.on<ConversationUpdatedEvent>(
			ViewEventType.CONVERSATION_UPDATED,
			(event) => {
				// 仅在更新的是当前活跃对话时触发
				if (event.conversation.meta.id === activeConversation?.meta.id) {
					setDisplayTitle(event.conversation.meta.title);
					// 更新时触发打字机效果
					setEnableTypewriter(true);
					setIsRegeneratingTitle(false);
				}
			}
		);

		return () => {
			unsubscribe();
		};
	}, [eventBus, activeConversation?.meta.id]);

	// 当切换到不同对话时，同步显示的标题（此时不使用打字机效果，避免视觉干扰）
	useEffect(() => {
		if (activeConversation?.meta.title) {
			setDisplayTitle(activeConversation.meta.title);
			// 关闭打字机动画
			setEnableTypewriter(false);
			// 重置状态
			setIsRegeneratingTitle(false);
		}
	}, [activeConversation?.meta.id]); // 仅在 ID 变更时触发

	// 打字机特效的计算结果
	const typewriterTitle = useTypewriterEffect({
		text: displayTitle,
		speed: TYPEWRITER_EFFECT_SPEED_MS,
		enabled: enableTypewriter,
	});

	// 打字机效果播放完毕后，自动关闭标记
	useEffect(() => {
		if (enableTypewriter && typewriterTitle === displayTitle && displayTitle.length > 0) {
			setEnableTypewriter(false);
		}
	}, [enableTypewriter, typewriterTitle, displayTitle]);

	// 标题渲染元素：根据是否正在重生成渲染不同的视觉表现
	const titleElement = isRegeneratingTitle ? (
		<>
			{/* 定义重生成时的流光扫描动画 */}
			<style dangerouslySetInnerHTML={{
				__html: `
					@keyframes scanEffect {
						25% { background-position: calc(1*100%/3) 0; }
						50% { background-position: calc(2*100%/3) 0; }
						75% { background-position: calc(3*100%/3) 0; }
						100% { background-position: calc(4*100%/3) 0; }
					}
				`
			}} />
			<span
				className="pktw-leading-[1.5] pktw-text-xl pktw-inline-block"
				style={{
					fontSize: 'var(--font-ui-large)',
					width: 'fit-content',
					color: '#0000',
					// 三色渐变流光背景
					background: 'linear-gradient(90deg, #3b82f6 33%, #10b981 0 66%, #8b5cf6 0) 0 0/400% 100%',
					backgroundClip: 'text',
					WebkitBackgroundClip: 'text',
					animation: 'scanEffect 5s infinite cubic-bezier(0.3, 1, 0, 1)',
				}}
			>
				{displayTitle}
			</span>
		</>
	) : (
		<span
			className="pktw-font-medium pktw-text-foreground pktw-leading-[1.5] pktw-text-xl"
			style={{ fontSize: 'var(--font-ui-large)' }}
		>
			{/* 优先显示打字机输出的内容 */}
			{enableTypewriter ? typewriterTitle : displayTitle}
		</span>
	);


	/**
	 * 手动触发标题重生成
	 */
	const handleRegenerateTitle = async () => {
		if (isRegeneratingTitle) {
			return;
		}

		const conversation = useProjectStore.getState().activeConversation;
		if (!conversation) {
			return;
		}

		try {
			// 立即进入 Loading 状态
			setIsRegeneratingTitle(true);
			// 调用核心业务管理器重新生成标题
			await manager.regenerateConversationTitle(conversation.meta.id);
		} catch (error) {
			console.error('Failed to regenerate conversation title:', error);
			setIsRegeneratingTitle(false);
		}
	};

	return (
		<div className="pktw-flex pktw-items-center pktw-justify-between pktw-gap-4 pktw-w-full">
			{/* 左侧：会话路径与名称 (包含项目名/对话名) */}
			<div className="pktw-m-0 pktw-flex pktw-items-center pktw-gap-2 pktw-flex-nowrap pktw-flex-1 pktw-min-w-0">
				{activeConversation && (
					<>
						{/* 路径引导：项目图标 / 项目名称 */}
						{activeProject && (
							<>
								<Folder className="pktw-inline-flex pktw-items-center pktw-flex-shrink-0" size={18} />
								<span className="pktw-font-medium pktw-text-foreground pktw-leading-[1.5]" style={{ fontSize: 'var(--font-ui-medium)' }}>{activeProject.meta.name}</span>
								<span className="pktw-text-muted-foreground pktw-mx-1" style={{ fontSize: 'var(--font-ui-medium)' }}> / </span>
							</>
						)}
						
						{/* 对话标题文本 */}
						{titleElement}

						{/* 自动标题操作按钮：如果标题不是用户手动编辑的，则允许 AI 刷新 */}
						{!activeConversation.meta.titleManuallyEdited && (
							<IconButton
								size="md"
								onClick={isRegeneratingTitle ? undefined : handleRegenerateTitle}
								title={isRegeneratingTitle ? "Regenerating..." : "Regenerate conversation title"}
								className={cn(
									"hover:pktw-bg-gray-200",
									isRegeneratingTitle && [
										"pktw-opacity-40",
										"pktw-cursor-not-allowed",
										"!pktw-pointer-events-none",
										"pktw-select-none",
										"hover:!pktw-bg-transparent",
										"hover:!pktw-opacity-40"
									]
								)}
							>
								{/* 动画旋转效果图标 */}
								<RefreshCw className={cn("pktw-text-muted-foreground group-hover:pktw-text-black", isRegeneratingTitle && "pktw-animate-spin")} />
							</IconButton>
						)}
					</>
				)}
			</div>

			{/* 右侧：功能按钮组 (资源、总结、更多操作) */}
			<div className="pktw-flex pktw-items-center pktw-gap-4 pktw-flex-shrink-0">
				{activeConversation && (
					<>
						<div className="pktw-flex pktw-items-center pktw-gap-1">
							{/* 资源管理入口 */}
							<ResourcesPopover />

							{/* 会话总结入口 */}
							<SummaryPopover />

							{/* 综合操作按钮 (包含打开源码、并在独立聊天窗口打开等功能) */}
							<OpenMenuButton />
						</div>
					</>
				)}
			</div>
		</div>
	);
};

