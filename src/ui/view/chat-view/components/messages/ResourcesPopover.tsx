import React, { useMemo } from 'react';
import { useProjectStore } from '@/ui/store/projectStore';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/ui/component/shared-ui/hover-card';
import { IconButton } from '@/ui/component/shared-ui/icon-button';
import { Button } from '@/ui/component/shared-ui/button';
import { LibraryBig, ExternalLink } from 'lucide-react';
import { cn } from '@/ui/react/lib/utils';
import { EventBus, OpenLinkEvent } from '@/core/eventBus';
import { App } from 'obsidian';
import { FileType, getFileIcon } from '@/ui/view/shared/file-utils';
import { FilePreviewHover } from '@/ui/component/mine/resource-preview-hover';
import { detectPreviewFileType, getFileTypeFromResourceKind } from '@/core/document/helper/FileTypeUtils';

/**
 * ResourcesPopover.tsx
 * 
 * 【这个文件是干什么的】
 * 该文件定义了 `ResourcesPopover` 组件，它是一个弹出式悬浮窗，用于列出当前对话（Conversation）中涉及的所有资源文件。
 * 资源可以包括 PDF 文档、图片、Markdown 笔记以及 AI 生成的总结摘要。
 * 
 * 【起了什么作用】
 * 1. **资源汇总**：遍历当前对话的所有历史消息，提取出其中通过 RAG（检索增强生成）或附件形式引用的所有原始文件。
 * 2. **快速跳转**：点击列表中的任何资源，可以在 Obsidian 中立即打开对应的文件。
 * 3. **实时预览**：集成了高性能的悬浮预览功能，鼠标停留在资源项上即可通过 `FilePreviewHover` 直接查看文件内容（支持 PDF、图片和 MD）。
 * 4. **总结导航**：如果某个大型文档已有 AI 生成的总结笔记，提供快捷按钮（ExternalLink）直达该笔记。
 * 
 * 【举例介绍】
 * - 当用户询问关于“年度报告.pdf”的内容时，AI 引用了该 PDF 的某些段落。
 * - 用户点击标题栏的“资源（LibraryBig 图标）”，弹窗会显示“年度报告.pdf”。
 * - 用户将鼠标停在文件名上，右侧会自动弹出一个小窗显示 PDF 的第一页内容或元数据，无需离开聊天界面。
 * 
 * 【技术实现】
 * 1. **数据聚合 (useMemo)**：
 *    - 基于 `activeConversation` 的消息流，使用 `Map` 结构进行去重聚合，确保同一资源即使被多次引用也只出现一次。
 *    - 依赖 `messageCount` 以在消息增加（AI 回复中加入新资源）时自动更新列表。
 * 2. **UI 范式**：使用 Radix UI 风格的 `HoverCard` 组件，实现优雅的浮层效果。
 * 3. **解耦设计**：
 *    - 使用 `eventBus.dispatch(new OpenLinkEvent(...))` 发送跳转指令，而不是直接操作 Workspace，保持 UI 与编辑器逻辑解耦。
 *    - `getFileTypeFromResourceKind` 和 `getFileIcon` 确保不同类型资源有正确的语义化图标。
 * 4. **增强预览 (FilePreviewHover)**：通过高阶组件包装列表项，动态检测文件后缀，分发给 PDF 预览器或 Image 预览器。
 */

/**
 * Popover component for displaying conversation resources as a list
 * 对话资源浮窗组件
 */
export const ResourcesPopover: React.FC = () => {
	const conversation = useProjectStore((state) => state.activeConversation);
	const app = (window as any).app as App;
	const eventBus = EventBus.getInstance(app);

	// 缓存逻辑：从对话历史中提取去重后的资源列表
	const conversationId = conversation?.meta.id;
	const messageCount = conversation?.messages?.length ?? 0;

	const resources = useMemo(() => {
		// 从状态仓库直接获取最新值以防止闭包陷阱
		const latestConversation = useProjectStore.getState().activeConversation;
		if (!latestConversation) return [];

		const resourceMap = new Map<string, { type: FileType; kind?: string; summaryNotePath?: string }>();

		// 扫描所有消息携带的 resource 属性
		for (const message of latestConversation.messages) {
			if (message.resources && message.resources.length > 0) {
				for (const resource of message.resources) {
					if (!resourceMap.has(resource.source)) {
						const type = getFileTypeFromResourceKind(resource.kind, resource.source);
						resourceMap.set(resource.source, {
							type,
							kind: resource.kind,
							summaryNotePath: resource.summaryNotePath
						});
					}
				}
			}
		}

		return Array.from(resourceMap.entries()).map(([path, data]) => ({
			path,
			type: data.type,
			kind: data.kind,
			summaryNotePath: data.summaryNotePath,
		}));
	}, [conversationId, messageCount]);

	/**
	 * 处理资源点击：在编辑器中打开文件
	 */
	const handleResourceClick = (path: string) => {
		if (!path) return;
		// 清理 Obsidian 内部路径格式 (如 [[path]] -> path)
		const cleaned = path.replace(/^\[\[|\]\]$/g, '');
		const normalized = cleaned.startsWith('/') ? cleaned.slice(1) : cleaned;
		eventBus.dispatch(new OpenLinkEvent({ path: normalized }));
	};

	if (!conversation) {
		return null;
	}

	return (
		<HoverCard openDelay={200} closeDelay={300}>
			<HoverCardTrigger asChild>
				<IconButton
					size="lg"
					title="View conversation resources"
					className="hover:pktw-bg-gray-200"
				>
					<LibraryBig className="pktw-w-4 pktw-h-4 pktw-text-muted-foreground group-hover:pktw-text-black" />
				</IconButton>
			</HoverCardTrigger>
			<HoverCardContent
				className="pktw-w-[320px] pktw-p-0 pktw-bg-white pktw-shadow-lg"
				align="end"
				side="bottom"
				sideOffset={8}
				collisionPadding={16}
			>
				<div className="pktw-flex pktw-flex-col pktw-max-h-[400px] pktw-overflow-y-auto">
					{/* 头部标题 */}
					<div className="pktw-px-3 pktw-py-2 pktw-border-b pktw-border-border">
						<span className="pktw-text-lg pktw-font-semibold">
							Resources
						</span>
					</div>

					{/* 资源列表内容 */}
					{resources.length === 0 ? (
						<div className="pktw-p-4 pktw-text-center pktw-text-sm">
							No resources available
						</div>
					) : (
						<div className="pktw-flex pktw-flex-col">
							{resources.map((resource) => (
								<ResourceItem
									key={resource.path}
									path={resource.path}
									type={resource.type}
									kind={resource.kind}
									summaryNotePath={resource.summaryNotePath}
									onClick={() => handleResourceClick(resource.path)}
								/>
							))}
						</div>
					)}
				</div>
			</HoverCardContent>
		</HoverCard>
	);
};

interface ResourceItemProps {
	path: string;
	type: FileType;
	kind?: string;
	/** 该资源对应的 AI 总结笔记路径 */
	summaryNotePath?: string;
	onClick: () => void;
}

/**
 * 单个资源项组件，负责渲染文件图标、名称及预览触发
 */
const ResourceItem: React.FC<ResourceItemProps> = ({ path, type, kind, summaryNotePath, onClick }) => {
	const app = (window as any).app as App;
	const eventBus = EventBus.getInstance(app);
	const fileName = path.split('/').pop() || path;

	// 路径规范化处理
	const normalizedPath = useMemo(() => {
		const cleaned = path.replace(/^\[\[|\]\]$/g, '');
		return cleaned.startsWith('/') ? cleaned.slice(1) : cleaned;
	}, [path]);

	// 映射资源类型到预览引擎支持的格式
	const previewFileType = useMemo(() => {
		if (kind === 'image') return 'image' as const;
		if (kind === 'pdf') return 'pdf' as const;
		
		const detected = detectPreviewFileType(normalizedPath);
		// 仅对明确支持预览的类型（图片、PDF、Markdown）启用 FilePreviewHover
		if (detected === 'file') {
			return undefined;
		}
		return detected;
	}, [kind, normalizedPath]);


	/**
	 * 打开该资源的 AI 总结笔记
	 */
	const handleOpenSummary = (e: React.MouseEvent) => {
		e.stopPropagation(); // 防止触发文件本身的点击
		if (summaryNotePath) {
			const normalized = summaryNotePath.startsWith('/') ? summaryNotePath.slice(1) : summaryNotePath;
			eventBus.dispatch(new OpenLinkEvent({ path: normalized }));
		}
	};

	// 资源项的视觉布局
	const itemContent = (
		<div
			className={cn(
				'pktw-flex pktw-items-center pktw-gap-3 pktw-p-3 pktw-border-b pktw-border-border last:pktw-border-b-0',
				'pktw-transition-colors hover:pktw-bg-muted pktw-cursor-pointer'
			)}
			onClick={onClick}
		>
			{/* 文件图标 */}
			<div className="pktw-flex-shrink-0">{getFileIcon(type)}</div>
			
			{/* 文件名称 */}
			<div className="pktw-flex-1 pktw-min-w-0">
				<div className="pktw-text-sm pktw-font-medium pktw-truncate">
					{fileName}
				</div>
			</div>

			{/* 总结按钮（如果存在） */}
			{summaryNotePath && (
				<Button
					variant="ghost"
					size="sm"
					onClick={handleOpenSummary}
					className="pktw-shrink-0 pktw-h-6 pktw-w-6 pktw-p-0"
					title="Open Resource Summary"
				>
					<ExternalLink className="pktw-w-3.5 pktw-h-3.5" />
				</Button>
			)}
		</div>
	);

	// 如果支持预览，则用预览浮窗组件进行包裹
	if (previewFileType) {
		return (
			<FilePreviewHover
				filePath={normalizedPath}
				fileType={previewFileType}
				app={app}
			>
				{itemContent}
			</FilePreviewHover>
		);
	}

	return itemContent;
};

