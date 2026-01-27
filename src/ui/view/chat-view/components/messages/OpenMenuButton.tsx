import React from 'react';
import { useProjectStore } from '@/ui/store/projectStore';
import { useHoverMenu } from '@/ui/component/mine';
import { OpenIn } from '@/ui/component/ai-elements';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/component/shared-ui/popover';
import { cn } from '@/ui/react/lib/utils';
import { ExternalLink } from 'lucide-react';
import { openSourceFile } from '@/ui/view/shared/view-utils';
import { useServiceContext } from '@/ui/context/ServiceContext';
import { Button } from '@/ui/component/shared-ui/button';

/**
 * OpenMenuButton.tsx
 * 
 * 【这个文件是干什么的】
 * 该文件定义了 `OpenMenuButton` 组件及其子组件 `OpenMenuItem`。它是一个功能强大的“快捷菜单”按钮，
 * 旨在方便用户将当前的对话上下文导出到其他 AI 平台，或者快速跳转回生成当前对话的原始文档。
 * 
 * 【起了什么作用】
 * 1. **外部跳转**：用户可以一键将当前对话的所有提问内容带入 ChatGPT、Claude、v0 或 Cursor。
 * 2. **反向追溯**：对于基于特定笔记生成的对话，提供“Open source document”选项，直接在侧边或当前窗口打开该源文件。
 * 3. **上下文携带**：自动提取并聚合对话中的所有用户输入，作为查询参数（Query）传递给外部 URL。
 * 4. **交互增强**：集成了统一的 `useHoverMenu` 逻辑，支持鼠标悬停自动开启/延时关闭，提升操作流畅度。
 * 
 * 【举例介绍】
 * - 用户在插件中与 AI 讨论一段代码逻辑，突然想去 ChatGPT 试试看 GPT-4o 的回复。
 * - 点击右上角的 OpenMenuButton（ExternalLink 图标），选择 “ChatGPT”。
 * - 浏览器会自动打开 OpenAI 官网，输入框里已经填好了用户之前在插件里写的所有问题。
 * 
 * 【技术实现】
 * 1. **数据聚合 (useMemo)**：`conversationQuery` 逻辑遍历当前对话，过滤出所有 `role === 'user'` 的消息内容，进行换行拼接。
 * 2. **菜单控制 (useHoverMenu)**：封装了复杂的 Hover 逻辑，包括防抖关闭（closeDelay）和坐标协调，确保用户在点击菜单项时不会因为意外移出而导致菜单消失。
 * 3. **HOC 增强 (OpenIn)**：外层包裹了 `<OpenIn query={conversationQuery}>` 可能是为了向下透传上下文或处理特定的全选/导出逻辑。
 * 4. **自适应展示**：如果没有可跳转的源文件，且对话中也没有任何用户输入，该按钮会自动隐藏（return null）。
 */

/**
 * Individual menu item for opening in external platforms
 * 单个菜单项组件，支持 URL 跳转或自定义点击回调
 */
const OpenMenuItem: React.FC<{
	platformName: string;
	url?: string;
	onClick?: () => void;
	className?: string;
}> = ({
	platformName,
	url,
	onClick,
	className
}) => {
	const handleClick = () => {
		if (url) {
			// 如果有 URL，则在新标签页打开
			window.open(url, '_blank', 'noopener,noreferrer');
		}
		onClick?.();
	};

	return (
		<Button
			type="button"
			variant="ghost"
			onClick={handleClick}
			className={cn(
				"pktw-flex pktw-items-center pktw-justify-between pktw-w-full pktw-px-3 pktw-py-2 pktw-text-sm pktw-text-left pktw-rounded-md hover:pktw-bg-accent hover:pktw-text-accent-foreground pktw-transition-colors",
				className
			)}
		>
			<span className="pktw-flex pktw-items-center pktw-gap-2">
				{platformName}
			</span>
			{/* 如果有 URL，显示外部链接图标 */}
			{url && <ExternalLink className="pktw-size-3 pktw-flex-shrink-0" />}
		</Button>
	);
};

/**
 * Open menu component with multiple platform options and open source document
 * 综合跳转菜单按钮组件
 */
export const OpenMenuButton: React.FC = () => {
	const { app } = useServiceContext();
	const activeConversation = useProjectStore((state) => state.activeConversation);

	// 使用统一的悬浮菜单管理器
	const hoverMenu = useHoverMenu({
		id: 'open-menu',
		closeDelay: 300,
		enableCoordination: true
	});

	/**
	 * 处理跳转到源文件
	 */
	const handleOpenSource = async () => {
		if (activeConversation?.file) {
			await openSourceFile(app, activeConversation.file);
		}
	};

	/**
	 * 计算所有用户消息的聚合文本，用于作为搜索词
	 */
	const conversationQuery = React.useMemo(() => {
		if (!activeConversation || !activeConversation.messages || activeConversation.messages.length === 0) {
			return '';
		}
		// 提取所有用户角色的内容并用双换行拼接
		const userMessages = activeConversation.messages
			.filter(msg => msg.role === 'user')
			.map(msg => msg.content)
			.join('\n\n');
		return userMessages;
	}, [activeConversation]);

	// 外部平台配置
	const platforms = [
		{ name: 'ChatGPT', url: 'https://chat.openai.com/?q={query}' },
		{ name: 'Claude', url: 'https://claude.ai/new?q={query}' },
		{ name: 'v0', url: 'https://v0.dev/chat?q={query}' },
		{ name: 'Cursor', url: 'https://cursor.sh/?q={query}' }
	];

	// 只有在存在源文件引用或有实际对话内容时才显示按钮
	const shouldShowButton = activeConversation?.file || conversationQuery.trim();

	if (!shouldShowButton) return null;

	return (
		<OpenIn query={conversationQuery}>
			<div
				ref={hoverMenu.containerRef}
				className="pktw-relative pktw-inline-block"
				onMouseEnter={hoverMenu.handleMouseEnter}
				onMouseLeave={hoverMenu.handleMouseLeave}
			>
				<Popover open={hoverMenu.isOpen} >
					<PopoverTrigger asChild>
						<div className={cn(
							"pktw-flex pktw-items-center pktw-justify-center pktw-cursor-pointer pktw-bg-transparent pktw-border-none pktw-outline-none pktw-select-none pktw-rounded-md pktw-group active:pktw-opacity-80 focus-visible:pktw-outline-2 focus-visible:pktw-outline-primary focus-visible:pktw-outline-offset-2 pktw-transition-colors",
							"pktw-h-8 pktw-w-8 hover:pktw-bg-gray-200"
						)}>
							<ExternalLink className="pktw-w-4 pktw-h-4 pktw-text-muted-foreground group-hover:pktw-text-black" />
						</div>
					</PopoverTrigger>
					<PopoverContent
						className="pktw-w-[200px] pktw-p-1 pktw-bg-white pktw-shadow-lg pktw-border pktw-z-50"
						align="start"
						side="bottom"
						sideOffset={8}
					>
						<div className="pktw-flex pktw-flex-col pktw-gap-1">
							{/* 第一部分：跳转回本地源文档 */}
							{activeConversation?.file && (
								<OpenMenuItem
									key="open-source"
									platformName="Open source document"
									onClick={() => {
										handleOpenSource();
										hoverMenu.closeMenu();
									}}
								/>
							)}
							
							{/* 分割线：只有当下面还有外部平台选项时显示 */}
							{activeConversation?.file && conversationQuery.trim() && <div className="pktw-h-px pktw-bg-border pktw-my-1" />}
							
							{/* 第二部分：外部平台快捷搜索 */}
							{conversationQuery.trim() && platforms.map((platform) => (
								<OpenMenuItem
									key={platform.name}
									platformName={platform.name}
									url={platform.url.replace('{query}', encodeURIComponent(conversationQuery))}
									onClick={hoverMenu.closeMenu}
								/>
							))}
						</div>
					</PopoverContent>
				</Popover>
			</div>
		</OpenIn>
	);
};
