/**
 * 【这个文件是干什么的】
 * MessageViewItem.tsx 是聊天视图中渲染单条消息的核心组件。
 * 它负责将 ChatMessage 对象转换为可视化的消息气泡，支持用户和助手角色。
 * 
 * 【起了什么作用】
 * 1. 消息渲染：区分用户/助手样式，支持 Markdown 内容渲染（打字机动画）。
 * 2. 附件展示：解析并显示消息关联的资源（图片、PDF、本地文件、链接）。
 * 3. 实时交互：显示推理过程（Reasoning）、工具调用状态及结果。
 * 4. 动作管理：提供复制、重新生成、收藏（点赞）、查看 Token 和时间等功能。
 * 5. 视图控制：处理长文本消息的折叠与展开。
 * 
 * 【举例介绍】
 * - 助手回复时，如果包含搜索工具调用，组件会实时展示搜索状态。
 * - 用户发送包含图片的双链，组件会显示缩略图并支持点击打开。
 * 
 * 【技术实现】
 * - 组件化：拆分为多个子组件如 MessageAttachmentsList, ToolCallsDisplay 等。
 * - 动画库：使用 @react-spring 实现弹性交互，AnimatedSparkles 显示流式状态。
 * - 扩展性：通过 Message 抽象组件实现不同角色的气泡包装。
 * - Obsidian 集成：利用 Menu API 提供右键上下文操作。
 */

import React, { useCallback, useMemo, useState, useEffect } from 'react';
import { Menu, App } from 'obsidian';
import { ChatMessage, ChatConversation } from '@/service/chat/types';
import { useChatViewStore } from '../../store/chatViewStore';
import { useServiceContext } from '@/ui/context/ServiceContext';
import { useProjectStore } from '@/ui/store/projectStore';
import { useStreamChat } from '../../hooks/useStreamChat';
import { cn } from '@/ui/react/lib/utils';
import { COLLAPSED_USER_MESSAGE_CHAR_LIMIT } from '@/core/constant';
import { Copy, RefreshCw, Star, Loader2, Check, ChevronDown, ChevronUp, FileText } from 'lucide-react';
import { type ToolCallInfo } from '@/ui/view/chat-view/store/messageStore';
import {
	Message,
	MessageContent,
	MessageActions,
	MessageAction,
	MessageAttachment,
	Reasoning,
	ReasoningContent,
	ReasoningTrigger,
	Task,
	TaskItem,
	TaskTrigger,
	TaskContent,
} from '@/ui/component/ai-elements';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/component/shared-ui/tooltip';
import { Button } from '@/ui/component/shared-ui/button';
import { ResourcePreviewHover, AnimatedSparkles } from '@/ui/component/mine';
import { Streamdown } from 'streamdown';
import type { FileUIPart } from 'ai';
import { ConversationUpdatedEvent } from '@/core/eventBus';
import { formatTimestampLocale } from '@/ui/view/shared/date-utils';
import { isUrl, getExtensionFromSource, getImageMimeType } from '@/core/document/helper/FileTypeUtils';
import { ChatResourceRef } from '@/service/chat/types';
import { ResourceKind } from '@/core/document/types';
import { openFile } from '@/core/utils/obsidian-utils';
import { SafeModelIcon, SafeProviderIcon } from '@/ui/component/mine/SafeIconWrapper';
import { ProviderServiceFactory } from '@/core/providers/base/factory';

/**
 * 附件资源的 UI 表现层接口
 * 扩展了 FileUIPart 以包含资源引用和文件类型
 */
interface ResourceUIAttachment extends FileUIPart {
	resource: ChatResourceRef;
	fileType: ResourceKind;
}

/**
 * 组件：渲染消息中的附件列表
 * 包括图片、PDF 和普通文件的展示逻辑
 */
const MessageAttachmentsList: React.FC<{
	message: ChatMessage;
	app: App;
}> = ({ message, app }) => {
	// 解析消息中的资源
	const fileAttachments = useMemo(() => {
		if (!message.resources || message.resources.length === 0) {
			return [];
		}

		return message.resources.map((resource) => {
			const source = resource.source;
			const extension = getExtensionFromSource(source);

			let mediaType: string;
			if (resource.kind === 'image') {
				mediaType = getImageMimeType(extension);
			} else if (resource.kind === 'pdf') {
				mediaType = 'application/pdf';
			} else {
				mediaType = 'application/octet-stream';
			}

			return {
				type: 'file' as const,
				url: source,
				filename: source.split('/').pop() || source,
				mediaType: mediaType,
				resource: resource,
				fileType: resource.kind,
			};
		});
	}, [message.resources, app]);

	/**
	 * 处理附件打开逻辑
	 * 区分外部链接和本地 Obsidian 文件
	 */
	const handleOpenResource = useCallback(async (attachment: ResourceUIAttachment) => {
		const url = attachment.url;
		if (!url) return;

		// 外部 URL 在浏览器打开
		if (isUrl(url)) {
			window.open(url, '_blank', 'noopener,noreferrer');
			return;
		}

		// 本地文件通过 Obsidian 工具方法打开
		await openFile(app, url);
	}, [app]);

	if (fileAttachments.length === 0) {
		return null;
	}

	/**
	 * 渲染单个附件，并集成悬停预览功能
	 * @param attachment 附件对象
	 * @param index 索引
	 * @param isImage 是否为图片
	 */
	const renderAttachment = (attachment: ResourceUIAttachment, index: number, isImage: boolean) => {
		const isPdf = attachment.fileType === 'pdf';

		const handleClick = async (e: React.MouseEvent) => {
			e.stopPropagation();
			await handleOpenResource(attachment);
		};

		const wrappedContent = (
			<ResourcePreviewHover
				resource={attachment.resource}
				app={app}
				previewClassName="pktw-z-[100]"
			>
				<div
					className={cn(
						"pktw-cursor-pointer pktw-transition-opacity hover:pktw-opacity-90",
						isPdf || !isImage ? "pktw-w-full" : "pktw-flex-shrink-0"
					)}
					onClick={handleClick}
				>
					{isPdf ? (
						/* PDF 附件使用特定的行状布局 */
						<div className="pktw-flex pktw-flex-row pktw-w-full pktw-shrink-0 pktw-items-center pktw-rounded-lg pktw-border-1 pktw-border-solid pktw-border-gray-200 dark:pktw-border-gray-600 pktw-bg-white pktw-px-1.5 pktw-py-1.5 pktw-gap-3 pktw-min-h-[48px]">
							<div className="pktw-flex-shrink-0 pktw-w-8 pktw-h-8 pktw-bg-red-500 pktw-rounded pktw-flex pktw-items-center pktw-justify-center">
								<FileText className="pktw-size-4 pktw-text-white" />
							</div>
							<div className="pktw-flex-1 pktw-flex pktw-flex-col pktw-gap-1 pktw-min-w-0">
								<span className="pktw-text-sm pktw-font-medium pktw-text-gray-900 pktw-truncate">
									{attachment.filename}
								</span>
								<span className="pktw-text-xs pktw-text-gray-500 pktw-uppercase pktw-font-medium">
									PDF
								</span>
							</div>
						</div>
					) : (
						/* 图片类附件使用卡片式预览 */
						<MessageAttachment data={attachment} onClick={handleClick} />
					)}
				</div>
			</ResourcePreviewHover>
		);

		// Only wrap with TooltipProvider for non-PDF files
		if (isPdf) {
			return <React.Fragment key={`attachment-${index}`}>{wrappedContent}</React.Fragment>;
		}

		return (
			<TooltipProvider key={`attachment-${index}`}>
				{wrappedContent}
			</TooltipProvider>
		);
	};

	// Group attachments by type for layout
	const imageAttachments = fileAttachments.filter(att => att.fileType === 'image');
	const otherAttachments = fileAttachments.filter(att => att.fileType !== 'image');

	return (
		<div className="pktw-flex pktw-flex-col pktw-gap-2 pktw-w-full pktw-max-w-full pktw-min-w-0">
			{/* Images: horizontal layout with wrapping */}
			{imageAttachments.length > 0 && (
				<div className="pktw-flex pktw-flex-wrap pktw-gap-2 pktw-w-full pktw-max-w-full pktw-min-w-0">
					{imageAttachments.map((attachment, index) => renderAttachment(attachment, index, true))}
				</div>
			)}
			{/* Other attachments (PDFs, etc.): vertical layout, full width */}
			{otherAttachments.length > 0 && (
				<div className="pktw-flex pktw-flex-col pktw-gap-2 pktw-w-full pktw-max-w-full pktw-min-w-0">
					{otherAttachments.map((attachment, index) => renderAttachment(attachment, index, false))}
				</div>
			)}
		</div>
	);
};

/**
 * 组件：渲染工具调用详情
 * 显示 AI 使用的工具名称、输入参数和输出结果
 */
const ToolCallsDisplay: React.FC<{
	expanded: boolean; // 是否默认展开
	toolCalls: ToolCallInfo[]; // 工具调用信息列表
}> = ({ expanded, toolCalls }) => {
	return (
		<div className="pktw-w-full pktw-space-y-2">
			{toolCalls.map((toolCall, index) => (
				<Task key={index} defaultOpen={expanded}>
					<TaskTrigger title={toolCall.toolName} />
					<TaskContent>
						<TaskItem>
							{/* 显示输入参数 */}
							{toolCall.input && (
								<div className="pktw-text-xs pktw-text-muted-foreground pktw-mb-2">
									<strong>Input:</strong>
									<pre className="pktw-whitespace-pre-wrap pktw-mt-1">{JSON.stringify(toolCall.input, null, 2)}</pre>
								</div>
							)}
							{/* 显示输出结果 */}
							{toolCall.output && (
								<div className="pktw-text-xs pktw-text-muted-foreground pktw-mb-2">
									<strong>Output:</strong>
									<pre className="pktw-whitespace-pre-wrap pktw-mt-1">{JSON.stringify(toolCall.output, null, 2)}</pre>
								</div>
							)}
							{/* 正在运行状态 */}
							{toolCall.isActive && (
								<div className="pktw-flex pktw-items-center pktw-mt-2">
									<Loader2 className="pktw-size-3 pktw-animate-spin pktw-text-muted-foreground pktw-mr-2" />
									<span className="pktw-text-xs pktw-text-muted-foreground">Running...</span>
								</div>
							)}
						</TaskItem>
					</TaskContent>
				</Task>
			))}
		</div>
	);
};

/**
 * 组件：渲染消息底部动作按钮区域
 * 包括：收藏、复制、重新生成、模型信息等
 */
const MessageActionsList: React.FC<{
	message: ChatMessage;
	isLastMessage: boolean; // 是否是当前对话的最后一条消息（决定是否显示重发按钮）
	isStreaming: boolean; // 是否正在生成中（生成中不显示动作按钮）
	copied: boolean; // 复制成功状态
	onToggleStar: (messageId: string, starred: boolean) => void;
	onCopy: () => void;
	onRegenerate: (messageId: string) => void;
}> = ({ message, isLastMessage, isStreaming, copied, onToggleStar, onCopy, onRegenerate }) => {
	const [isHovered, setIsHovered] = useState(false);

	if (isStreaming) {
		return null;
	}

	// 仅在助手消息且悬停时显示时间
	const showTime = message.role === 'assistant' && isHovered;

	return (
		<div
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
			className="pktw-flex pktw-items-center pktw-gap-1"
		>
			<MessageActions>
				{/* 收藏按钮 */}
				<MessageAction
					tooltip={message.starred ? 'Unstar message' : 'Star message'}
					label={message.starred ? 'Unstar message' : 'Star message'}
					onClick={(e) => {
						e.stopPropagation();
						onToggleStar(message.id, !message.starred);
					}}
				>
					<Star
						size={12}
						strokeWidth={2}
						className={cn(
							message.starred && 'pktw-fill-red-500 pktw-text-red-500'
						)}
					/>
				</MessageAction>

				{/* 复制按钮 */}
				<MessageAction
					tooltip={copied ? 'Copied!' : 'Copy message'}
					label="Copy message"
					onClick={(e) => {
						e.stopPropagation();
						onCopy();
					}}
				>
					{copied ? (
						<Check size={12} strokeWidth={copied ? 3 : 2} />
					) : (
						<Copy size={12} strokeWidth={2} />
					)}
				</MessageAction>

				{/* 重新生成按钮：仅限助手的最后一条回复 */}
				{message.role === 'assistant' && isLastMessage && (
					<MessageAction
						tooltip="Regenerate response"
						label="Regenerate response"
						onClick={async (e) => {
							e.stopPropagation();
							onRegenerate(message.id);
						}}
					>
						<RefreshCw size={12} strokeWidth={2} />
					</MessageAction>
				)}

				{/* 助手消息特有的模型和 Token 信息 */}
				{message.role === 'assistant' && (
					<>
						<ModelIconButton message={message} />
						<TokenCountButton message={message} />
					</>
				)}

			</MessageActions>
			{/* 悬停显示具体创建时间 */}
			{showTime && <TimeDisplay message={message} />}
		</div>
	);
};

/**
 * 子组件：显示模型/提供商图标及其名称
 * 支持点击复制模型标识符
 */
const ModelIconButton: React.FC<{
	message: ChatMessage;
}> = ({ message }) => {
	const { manager } = useServiceContext();
	const [copied, setCopied] = useState(false);
	const [modelIcon, setModelIcon] = useState<string | null>(null);
	const [providerIcon, setProviderIcon] = useState<string | null>(null);

	// 格式化型号信息，例如 "OpenAI/gpt-4o"
	const modelInfo = useMemo(() => {
		if (!message.model) return null;
		return `${message.provider || ''}/${message.model}`.replace(/^\//, '');
	}, [message.model, message.provider]);

	// 异步加载提供商和模型图标
	useEffect(() => {
		if (!message.provider || !message.model || !manager) {
			setModelIcon(null);
			setProviderIcon(null);
			return;
		}

		const loadIcons = async () => {
			try {
				// 获取提供商元数据
				const providerMetadata = ProviderServiceFactory.getInstance().getAllProviderMetadata();
				const providerMeta = providerMetadata.find(m => m.id === message.provider);
				if (providerMeta?.icon) {
					setProviderIcon(providerMeta.icon);
				}

				// 获取具体模型元数据（包含图标）
				const allModels = await manager.getAllAvailableModels();
				const modelInfo = allModels.find(
					m => m.id === message.model && m.provider === message.provider
				);
				if (modelInfo?.icon) {
					setModelIcon(modelInfo.icon);
				}
			} catch (err) {
				console.error('Failed to load model/provider icons:', err);
			}
		};

		loadIcons();
	}, [message.provider, message.model, manager]);

	if (!modelInfo) return null;

	// 点击复制型号名称
	const handleCopy = useCallback(async (e: React.MouseEvent) => {
		e.stopPropagation();
		try {
			await navigator.clipboard.writeText(modelInfo);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch (err) {
			console.error('Failed to copy model info:', err);
		}
	}, [modelInfo]);

	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						type="button"
						className="pktw-h-6 pktw-w-6 pktw-p-0 pktw-cursor-pointer"
						onClick={handleCopy}
					>
						{modelIcon ? (
							<SafeModelIcon
								model={modelIcon}
								size={16}
								className="pktw-flex-shrink-0"
								fallback={
									providerIcon ? (
										<SafeProviderIcon
											provider={providerIcon}
											size={16}
											className="pktw-flex-shrink-0"
											fallback={<div className="pktw-w-4 pktw-h-4 pktw-rounded pktw-bg-blue-200" title="No icon available" />}
										/>
									) : (
										<div className="pktw-w-4 pktw-h-4 pktw-rounded pktw-bg-blue-200" title="No icon available" />
									)
								}
							/>
						) : providerIcon ? (
							<SafeProviderIcon
								provider={providerIcon}
								size={16}
								className="pktw-flex-shrink-0"
								fallback={<div className="pktw-w-4 pktw-h-4 pktw-rounded pktw-bg-blue-200" title="No icon available" />}
							/>
						) : (
							<div className="pktw-w-4 pktw-h-4 pktw-rounded pktw-bg-blue-200" title="No icon available" />
						)}
						<span className="pktw-sr-only">Model: {modelInfo}</span>
					</Button>
				</TooltipTrigger>
				<TooltipContent
					className="pktw-select-text"
					side="top"
					align="start"
					sideOffset={4}
					onPointerDown={(e) => e.stopPropagation()}
				>
					<p className="pktw-select-text">{copied ? 'Copied!' : modelInfo}</p>
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
};

/**
 * 子组件：显示消息消耗的 Token 数量
 */
const TokenCountButton: React.FC<{
	message: ChatMessage;
}> = ({ message }) => {
	const [copied, setCopied] = useState(false);
	// 计算总 Token 数逻辑
	const tokenCount = useMemo(() => {
		if (!message.tokenUsage) return null;
		const usage = message.tokenUsage as any;
		return usage.totalTokens ?? usage.total_tokens ??
			((usage.promptTokens ?? usage.prompt_tokens ?? 0) + (usage.completionTokens ?? usage.completion_tokens ?? 0));
	}, [message.tokenUsage]);

	if (tokenCount === null) return null;

	const handleCopy = useCallback(async (e: React.MouseEvent) => {
		e.stopPropagation();
		try {
			await navigator.clipboard.writeText(`${tokenCount} tokens`);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch (err) {
			console.error('Failed to copy token count:', err);
		}
	}, [tokenCount]);

	return (
		<Button
			variant="ghost"
			size="icon"
			type="button"
			className="pktw-h-auto pktw-w-auto pktw-px-1.5 pktw-cursor-pointer"
			onClick={handleCopy}
		>
			<span className="pktw-text-xs">
				{tokenCount} tokens{copied ? ' copied!' : ''}
			</span>
			<span className="pktw-sr-only">Token count: {tokenCount}</span>
		</Button>
	);
};

/**
 * 子组件：显示消息的具体创建时间 (悬停在 Action 区域时显示)
 */
const TimeDisplay: React.FC<{
	message: ChatMessage;
}> = ({ message }) => {
	const [copied, setCopied] = useState(false);
	const timeInfo = useMemo(() => {
		if (!message.createdAtTimestamp) return null;
		// 使用浏览器默认的本地时区
		const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		const date = formatTimestampLocale(message.createdAtTimestamp, userTimezone);
		return date ? `${date} (${userTimezone})` : null;
	}, [message.createdAtTimestamp]);

	if (!timeInfo) return null;

	const handleCopy = useCallback(async (e: React.MouseEvent) => {
		e.stopPropagation();
		try {
			await navigator.clipboard.writeText(timeInfo);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch (err) {
			console.error('Failed to copy time info:', err);
		}
	}, [timeInfo]);

	return (
		<Button
			variant="ghost"
			size="icon"
			type="button"
			className="pktw-h-auto pktw-w-auto pktw-px-1.5 pktw-cursor-pointer"
			onClick={handleCopy}
		>
			<span className="pktw-text-xs">
				{copied ? `${timeInfo} copied!` : timeInfo}
			</span>
			<span className="pktw-sr-only">Time: {timeInfo}</span>
		</Button>
	);
};

interface StreamingState {
	isStreaming: boolean;
	streamingContent: string;
	reasoningContent: string;
	isReasoningActive: boolean;
	currentToolCalls: Array<{
		toolName: string;
		input?: any;
		isActive?: boolean;
		output?: any;
	}>;
	isToolSequenceActive: boolean;
}

export interface MessageItemProps {
	message: ChatMessage;
	streamingState?: StreamingState;
	isLastMessage?: boolean;
}

/**
 * 组件：渲染一条独立的消息
 * 处理角色判断、右键菜单、重新生成、展开收起等核心逻辑
 */
export const MessageItem: React.FC<MessageItemProps> = ({
	message,
	streamingState = {
		isStreaming: false,
		streamingContent: '',
		reasoningContent: '',
		isReasoningActive: false,
		currentToolCalls: [],
		isToolSequenceActive: false,
	},
	isLastMessage = false,
}) => {
	const { manager, app, eventBus } = useServiceContext();

	const activeConversation = useProjectStore((state) => state.activeConversation);
	const activeProject = useProjectStore((state) => state.activeProject);

	/**
	 * 切换消息的收藏状态（Star）
	 * 会同时更新本地状态和数据库存储
	 */
	const handleToggleStar = useCallback(async (messageId: string, starred: boolean) => {
		console.debug('[MessageItem] Toggling star for message:', { messageId, starred });
		if (!activeConversation) return;
		await manager.toggleStar({
			messageId,
			conversationId: activeConversation.meta.id,
			starred,
		});
		// 更新本地 store 状态以立即响应 UI
		const updatedMessages = activeConversation.messages.map(msg =>
			msg.id === messageId ? { ...msg, starred } : msg
		);
		const updatedConv = {
			...activeConversation,
			messages: updatedMessages,
		};
		useChatViewStore.getState().setConversation(updatedConv);
		useProjectStore.getState().updateConversation(updatedConv);
		useProjectStore.getState().setActiveConversation(updatedConv);
		// 发送事件，通知其他监听者（如侧边栏列表）同步状态
		eventBus.dispatch(new ConversationUpdatedEvent({ conversation: updatedConv }));
	}, [activeConversation, manager, eventBus]);

	const { streamChat, updateConv } = useStreamChat();

	/**
	 * 重新生成助手回复的功能
	 * 逻辑：寻找该回复之前的上一条用户消息，带着当时的对话上下文重新发起 AI 请求
	 */
	const handleRegenerate = useCallback(async (messageId: string) => {
		if (!activeConversation) return;
		if (!isLastMessage) return; // 仅允许重新生成最后一条回复

		// 找到当前助手消息的索引
		const messageIndex = activeConversation.messages.findIndex(m => m.id === messageId);
		if (messageIndex === -1) return;
		const assistantMessage = activeConversation.messages[messageIndex];
		if (assistantMessage.role !== 'assistant') return;

		// 向上寻找最后一条用户消息
		let userMessageIndex = -1;
		for (let i = messageIndex - 1; i >= 0; i--) {
			if (activeConversation.messages[i].role === 'user') {
				userMessageIndex = i;
				break;
			}
		}
		if (userMessageIndex === -1) return;
		const userMessage = activeConversation.messages[userMessageIndex];

		try {
			// 构建请求上下文（截取到该用户消息为止）
			const conversationContext: ChatConversation = {
				...activeConversation,
				messages: activeConversation.messages.slice(0, userMessageIndex + 1),
			};

			// 发起流式请求
			const streamResult = await streamChat({
				conversation: conversationContext,
				project: activeProject,
				userContent: userMessage.content,
			});

			// 将新生成的回复存入数据库，并替换旧回复
			if (streamResult.finalMessage) {
				const conversationWithoutOldMessage: ChatConversation = {
					...activeConversation,
					messages: activeConversation.messages.slice(0, messageIndex),
				};

				await manager.addMessage({
					conversationId: conversationWithoutOldMessage.meta.id,
					message: streamResult.finalMessage,
					model: streamResult.finalMessage.model,
					provider: streamResult.finalMessage.provider,
					usage: streamResult.finalUsage ?? { inputTokens: -1, outputTokens: -1, totalTokens: -1 },
				});
			}
		} catch (error) {
			console.error('Failed to regenerate message:', error);
		}
	}, [activeConversation, activeProject, isLastMessage, streamChat, manager, updateConv]);

	const [copied, setCopied] = useState(false);
	const [isExpanded, setIsExpanded] = useState(false);

	// 环境判定
	const isUser = message.role === 'user';
	const displayContent = message.content;

	const handleCopy = useCallback(async () => {
		try {
			await navigator.clipboard.writeText(message.content);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch (err) {
			console.error('Failed to copy:', err);
		}
	}, [message.content]);

	/**
	 * 构建消息右键菜单
	 * 整合了复制选中文字、复制整条消息、收藏和重新生成功能
	 */
	const handleContextMenu = useCallback((e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();

		const menu = new Menu();

		// 检查是否有选中的文本，如果有则添加“复制选中内容”
		const selection = window.getSelection();
		const selectedText = selection?.toString().trim();

		if (selectedText && selectedText.length > 0) {
			menu.addItem((item) => {
				item.setTitle('Copy selection');
				item.setIcon('copy');
				item.onClick(async () => {
					try {
						await navigator.clipboard.writeText(selectedText);
					} catch (err) {
						console.error('Failed to copy selection:', err);
					}
				});
			});
			menu.addSeparator();
		}

		// 复制整条消息
		menu.addItem((item) => {
			item.setTitle('Copy message');
			item.setIcon('copy');
			item.onClick(handleCopy);
		});

		// 收藏/取消收藏
		menu.addItem((item) => {
			item.setTitle(message.starred ? 'Unstar message' : 'Star message');
			item.setIcon('lucide-star');
			item.onClick(() => {
				handleToggleStar(message.id, !message.starred);
			});
		});

		// 重新生成回复（仅限助手最后一条消息）
		if (message.role === 'assistant' && isLastMessage) {
			menu.addItem((item) => {
				item.setTitle('Regenerate response');
				item.setIcon('refresh-cw');
				item.onClick(() => {
					handleRegenerate(message.id);
				});
			});
		}

		// 在鼠标位置显示菜单
		menu.showAtPosition({ x: e.clientX, y: e.clientY });
	}, [message, handleCopy, handleToggleStar, handleRegenerate, isLastMessage]);

	// 长文本折叠判定逻辑（仅针对非流式传输中的用户消息）
	const contentLength = String(displayContent || '').length;
	const shouldShowExpand = isUser && !streamingState.isStreaming && contentLength > COLLAPSED_USER_MESSAGE_CHAR_LIMIT;
	const displayText = shouldShowExpand && !isExpanded
		? String(displayContent).slice(0, COLLAPSED_USER_MESSAGE_CHAR_LIMIT) + '...'
		: String(displayContent);

	// 是否显示流式加载动画：已开始流式传输但内容尚未到达，且也未在执行推理或工具调用时
	const shouldShowLoader = streamingState.isStreaming && !displayContent && !streamingState.isReasoningActive && !streamingState.isToolSequenceActive;

	return (
		<div
			className={cn(
				"pktw-mb-4 pktw-px-4 pktw-flex pktw-w-full",
				isUser ? "pktw-justify-end" : "pktw-justify-start"
			)}
			data-message-id={message.id}
			data-message-role={message.role}
			onContextMenu={handleContextMenu}
		>
			<Message from={message.role} className="pktw-max-w-[85%]">
				{/* 渲染消息关联的资源（图片、附件等） */}
				{message.resources && message.resources.length > 0 && (
					<div className="pktw-mb-2 pktw-w-full pktw-max-w-full pktw-min-w-0 pktw-overflow-hidden">
						<MessageAttachmentsList message={message} app={app} />
					</div>
				)}

				<MessageContent
					className={cn(
						isUser && "pktw-rounded-lg pktw-bg-secondary pktw-px-4 pktw-py-4 pktw-w-full"
					)}
				>
					{/* 等待流式内容时的 loading 动画 */}
					{shouldShowLoader ? (
						<div className="pktw-flex pktw-items-center pktw-justify-start pktw-py-2">
							<div className="pktw-scale-50 pktw-origin-left">
								<AnimatedSparkles isAnimating={true} />
							</div>
						</div>
					) : null}

					{/* 渲染助手消息的推理过程（Thinking） */}
					{!isUser && streamingState.reasoningContent && (
						<Reasoning isStreaming={streamingState.isReasoningActive} className="pktw-w-full pktw-mb-0">
							<ReasoningTrigger/>
							<ReasoningContent>
								{streamingState.reasoningContent}
							</ReasoningContent>
						</Reasoning>
					)}

					{/* 渲染助手消息的工具调用过程 */}
					{!isUser && streamingState.currentToolCalls.length > 0 && (
						<ToolCallsDisplay expanded={streamingState.isToolSequenceActive} toolCalls={streamingState.currentToolCalls.map(call => ({
							toolName: call.toolName,
							input: call.input,
							output: call.output,
							isActive: call.isActive ?? false,
						}))} />
					)}

					{/* 渲染消息正文内容 */}
					{(!shouldShowLoader && displayContent) ? (
						<div className="pktw-relative">
							{
								isUser ? (
									/* 用户消息显示为纯文本，支持文本选中 */
									<div className="pktw-select-text">
										{displayText}
									</div>
								) : (
									/* 助手消息使用 Streamdown 渲染 Markdown，并支持打字机动画 */
									<div
										className="pktw-select-text"
										data-streamdown-root
									>
										<Streamdown isAnimating={streamingState.isStreaming}>{displayText}</Streamdown>
									</div>
								)
							}
							{/* 展开/收起按钮 */}
							{shouldShowExpand && (
								<Button
									type="button"
									onClick={(e) => {
										e.stopPropagation();
										setIsExpanded(!isExpanded);
									}}
									className={cn(
										"pktw-mt-2 pktw-flex pktw-items-center pktw-gap-1 pktw-text-xs",
										"pktw-transition-colors pktw-cursor-pointer"
									)}
								>
									{isExpanded ? (
										<>
											<ChevronUp className="pktw-w-3 pktw-h-3" />
											<span>Show less</span>
										</>
									) : (
										<>
											<ChevronDown className="pktw-w-3 pktw-h-3" />
											<span>Expand</span>
										</>
									)}
								</Button>
							)}
						</div>
					) : null}
				</MessageContent>

				{/* 底部动作工具栏 */}
				<MessageActionsList
					message={message}
					isLastMessage={isLastMessage}
					isStreaming={streamingState.isStreaming}
					copied={copied}
					onToggleStar={handleToggleStar}
					onCopy={handleCopy}
					onRegenerate={handleRegenerate}
				/>
			</Message>
		</div>
	);
};

