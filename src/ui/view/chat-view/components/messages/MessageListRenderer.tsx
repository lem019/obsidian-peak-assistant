/**
 * 【这个文件是干什么的】
 * MessageListRenderer.tsx 是消息列表的渲染容器。
 * 它负责从状态库（messageStore）中获取所有历史消息以及当前正在流式生成的 AI 消息，并统一渲染。
 * 
 * 【起了什么作用】
 * 1. 数据聚合：通过 useMessageStore 监听消息的变化，实现响应式渲染。
 * 2. 状态分发：为每条消息准备渲染所需的 props，包括 StreamingState 和 isLastMessage 标志。
 * 3. 动态渲染：实时处理 AI 的搜索过程、推理过程（Reasoning）和工具调用展示。
 * 4. 空状态处理：当没有消息时，显示“Ready when you are”的友好提示。
 * 
 * 【举例介绍】
 * - 当 AI 正在回复时，messageStore 会更新 streamingContent，此组件会立即渲染出一个带打字机效果的消息项。
 * - 用户滚动或刷新对话时，此组件会重新映射 savedMessagesToRender 列表。
 * 
 * 【技术实现】
 * - 性能优化：使用 useMemo 缓存已保存消息的渲染属性（savedMessagesToRender）和流式消息属性（streamingMessageToRender），避免不必要的重绘。
 * - 消息分类：将已持久化的 messages 和临时生成的流式消息（streamingMessageId）分开处理，并将流式消息追加到列表末尾。
 */

import React, { useMemo } from 'react';
import { ChatRole } from '@/core/providers/types';
import { MessageItem, MessageItemProps } from './MessageViewItem';
import { useMessageStore } from '../../store/messageStore';
import { DEFAULT_AI_SERVICE_SETTINGS } from '@/app/settings/types';

/**
 * MessageListRenderer 组件的 Props 定义
 */
interface MessageListRendererProps {
}

/**
 * 组件：高效渲染消息列表，并优化流式传输中的最后一条消息处理
 */
export const MessageListRenderer: React.FC<MessageListRendererProps> = ({
}) => {
	// 从全局 messageStore 中获取消息数据和流式状态
	const {
		messages,
		streamingMessageId,
		streamingContent,
		reasoningContent,
		isReasoningActive,
		currentToolCalls,
		isToolSequenceActive,
	} = useMessageStore();

	// 预处理已保存的消息列表，转换为 MessageItem 所需的格式
	const savedMessagesToRender: Array<MessageItemProps> = useMemo(() => {
		const result: Array<MessageItemProps> = [];

		messages.forEach(message => {
			result.push({
				message,
				// 对于已保存消息，其流式状态通常为 false，但可能包含已持久化的推理或工具调用
				streamingState: {
					isStreaming: false,
					streamingContent: '',
					reasoningContent: message.reasoning ? message.reasoning.content : '',
					isReasoningActive: false,
					currentToolCalls: message.toolCalls || [],
					isToolSequenceActive: false,
				},
				isLastMessage: false,
			});
		});

		// 标记最后一条消息（用于显示快捷操作按钮）
		if (result.length > 0) {
			result[result.length - 1].isLastMessage = true;
		}

		return result;
	}, [messages]);

	// 单独准备正在流式生成中的消息项
	const streamingMessageToRender: MessageItemProps | null = useMemo(() => {
		if (!streamingMessageId) {
			return null;
		}

		return {
			message: {
				id: streamingMessageId,
				role: 'assistant' as ChatRole,
				content: streamingContent,
				createdAtTimestamp: Date.now(),
				createdAtZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
				starred: false,
				model: DEFAULT_AI_SERVICE_SETTINGS.defaultModel.modelId,
				provider: DEFAULT_AI_SERVICE_SETTINGS.defaultModel.provider,
			},
			streamingState: {
				isStreaming: true,
				streamingContent: streamingContent,
				reasoningContent: reasoningContent,
				isReasoningActive: isReasoningActive,
				currentToolCalls: currentToolCalls,
				isToolSequenceActive: isToolSequenceActive,
			},
			isLastMessage: true,
		};
	}, [streamingMessageId, streamingContent, reasoningContent, isReasoningActive, currentToolCalls, isToolSequenceActive]);

	// 空对话状态下的 UI 展示
	if (savedMessagesToRender.length === 0 && !streamingMessageToRender) {
		return (
			<div className="pktw-flex pktw-items-center pktw-justify-center pktw-h-full pktw-min-h-[400px]">
				<div className="pktw-text-2xl pktw-font-light pktw-text-muted-foreground pktw-text-center">Ready when you are.</div>
			</div>
		);
	}

	return (
		<div className="pktw-flex pktw-flex-col pktw-w-full pktw-max-w-none pktw-m-0 pktw-px-4 pktw-py-6 pktw-gap-0 pktw-box-border">
			{/* 渲染已保存的消息历史 */}
			{savedMessagesToRender.map((item, index) => {
				return (
					<MessageItem
						key={index}
						{...item}
					/>
				);
			})}
			{/* 如果有正在生成的 AI 响应，将其追加到末尾 */}
			{streamingMessageToRender && (
				<MessageItem
					{...streamingMessageToRender}
				/>
			)}
		</div>
	);
};