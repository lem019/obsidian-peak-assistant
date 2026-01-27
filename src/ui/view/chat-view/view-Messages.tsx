/**
 * 【这个文件是干什么的】
 * MessagesViewComponent 是插件最核心的“聊天窗口”视图组件。
 * 
 * 【起了什么作用】
 * 1. 消息渲染：它负责展示当前选定对话（Conversation）中的所有历史消息。
 * 2. 状态同步：它充当了数据流的中转站，负责将 `activeConversation` 的数据定期推送到 `messageStore` 供渲染器使用。
 * 3. 滚动管理：集成了自动滚动、手动滚动、回到底部等复杂的聊天窗口滚动逻辑，确保 AI 正在打字时窗口能实时跟进。
 * 4. 交互入口：整合了顶部的标题栏 (MessageHeader)、中间的消息列表 (MessageListRenderer)、底部的输入区 (ChatInputAreaComponent) 以及建议标签 (SuggestionTags)。
 * 
 * 【举例介绍】
 * 当用户进入一个对话时，这个组件会立刻读取消息历史并渲染，同时根据 AI 的输出状态开启“自动滚动”功能。如果用户手动向上翻阅，它会自动暂停自动滚动以避免干扰阅读。
 * 
 * 【技术实现】
 * - 使用多种自定义 Hook (`useScrollManager`, `useAutoScroll`, `useChatSession`) 隔离复杂的 UI 逻辑。
 * - 响应式监听 `activeConversation` 的变更，实现数据的按需刷新。
 * - 结合 Tailwind CSS 类名 (pktw-*) 实现高度自适应的布局。
 */
import React, { useEffect, useRef } from 'react';
import { useChatViewStore } from './store/chatViewStore';
import { useProjectStore } from '@/ui/store/projectStore';
import { useMessageStore } from '@/ui/view/chat-view/store/messageStore';
import { OpenLinkEvent, ViewEventType } from '@/core/eventBus';
import { MessageHeader } from './components/messages/MessageViewHeader';
import { MessageListRenderer } from './components/messages/MessageListRenderer';
import { ChatInputAreaComponent } from './components/ChatInputArea';
import { FileChangesList } from './components/messages/FileChangesList';
import { SuggestionTags } from '../../component/prompt-input/SuggestionTags';
import { useServiceContext } from '@/ui/context/ServiceContext';
import { useScrollManager, scrollToBottom as scrollToBottomUtil } from '../shared/scroll-utils';
import { useAutoScroll } from './hooks/useAutoScroll';
import { IconButton } from '@/ui/component/shared-ui/icon-button';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { useChatSessionStore } from './store/chatSessionStore';
import { useChatSession } from './hooks';


/**
 * Main component for rendering and managing the messages list view
 * 消息列表主视图组件：负责组装聊天界面的各个部分
 */
export const MessagesViewComponent: React.FC = () => {
	// 获取基础服务和当前激活的对话状态
    const { app, eventBus } = useServiceContext();
    const pendingConversation = useChatViewStore().pendingConversation;
    const activeConversation = useProjectStore((state) => state.activeConversation);

    // ============================================================================
    // 获取会话相关的数据和操作
    // ============================================================================
    // Get computed session data from hook
    const {
        suggestionTags
    } = useChatSessionStore();

    const { handleSuggestionTagClick } = useChatSession();

    // ============================================================================
    // 同步消息仓库 (Message Sync Logic)
    // ============================================================================
    // Sync messages from activeConversation to messageStore
    const { setMessages, clearMessages } = useMessageStore();
    useEffect(() => {
		// 当 activeConversation 变化时（比如点击了别的聊天），我们需要同步更新专门负责渲染消息的 Store
        if (activeConversation?.messages) {
            setMessages(activeConversation.messages);
        } else {
            clearMessages();
        }
    }, [activeConversation?.meta.id, setMessages, clearMessages]);


    // ============================================================================
    // 滚动逻辑管理 (Scroll Management)
    // ============================================================================
    const bodyContainerRef = useRef<HTMLDivElement>(null);
    const bodyScrollRef = useRef<HTMLDivElement>(null);

    // 基础滚动管理器：负责常规的滚到顶/滚到底操作
    // Scroll management - all scroll logic centralized here
    const { scrollToTop, scrollToBottom } = useScrollManager({
        scrollRef: bodyScrollRef,
        containerRef: bodyScrollRef,
        eventBus,
        autoScrollOnMessagesChange: true, // 消息条数变多了，我们要考虑往下滚
        messagesCount: activeConversation?.messages.length,
        autoScrollOnStreaming: false, // 旧的流式滚动选项已停用，现在由 useAutoScroll 专门处理
    });

    // 智能流式滚动方案：当 AI 正在吐字（Streaming）时，实时跟踪到底部。
	// 如果用户自己向上划了，会自动暂停，不会强行把用户拉到底部，体验更好。
    // Auto-scroll management for streaming content with user scroll detection
    const { resumeAutoScroll, isAutoScrollPaused } = useAutoScroll({
        scrollRef: bodyScrollRef,
        enabled: true,
        userScrollThreshold: 100, // 距离底部超过 100 像素即视为用户在手动翻阅
    });

    // ============================================================================
    // 事件监听 (Event Listeners)
    // ============================================================================
    // Handle open link events
    useEffect(() => {
        if (!eventBus) return;

		// 监听来自聊天内容的链接点击事件，使其能在 Obsidian 环境中正确打开
        const unsubscribeOpenLink = eventBus.on<OpenLinkEvent>(
            ViewEventType.OPEN_LINK,
            async (event) => {
                await app.workspace.openLinkText(event.path, '', true);
            }
        );

        return () => {
            unsubscribeOpenLink();
        };
    }, [eventBus, app]);


    // 当对话刚切换时，无条件强制滚到最底部
    // Auto scroll to bottom when conversation is opened/changed
    useEffect(() => {
        if (!activeConversation) return;
        // Scroll to bottom when conversation changes
        scrollToBottomUtil(bodyScrollRef, true);
    }, [activeConversation?.meta.id]); // Scroll when conversation ID changes

    return (
        <div className="pktw-flex pktw-flex-col pktw-h-full pktw-relative pktw-overflow-hidden">

			{/* 如果对话还没加载好或正在加载，显示一个简约的提示 */}
            {!activeConversation || pendingConversation ? (
                <div className="pktw-flex pktw-items-center pktw-justify-center pktw-h-full pktw-min-h-[400px]">
                    <div className="pktw-text-2xl pktw-font-light pktw-text-muted-foreground pktw-text-center">Ready when you are.</div>
                </div>
            ) : null}

            {/* 顶栏：显示对话标题、模型信息和各种功能按钮 */}
            {/* Header */}
            <div className="pktw-px-6 pktw-py-4 pktw-border-b pktw-border-border pktw-flex-shrink-0">
                <MessageHeader />
            </div>

            {/* 中间层：消息列表展示区 */}
            {/* Body - Messages List */}
            <div
                className="pktw-flex-1 pktw-overflow-y-auto pktw-overflow-x-hidden pktw-relative pktw-min-h-0 pktw-w-full"
                ref={bodyScrollRef}
                style={{ scrollBehavior: 'smooth' }}
            >
				{/* 消息渲染核心，采用虚拟列表或普通列表按需渲染消息气泡 */}
                <MessageListRenderer />

                {/* 文件变更列表：通常用于展示 AI 处理过的文件建议（如 Artifacts） */}
                {/* File Changes List - positioned after messages, before footer */}
                <FileChangesList />
            </div>

            {/* 功能区：位于消息列表和输入框之间，包含推荐标签和滚动控制 */}
            {/* Footer Upper Area - positioned between body and footer, outside scroll area */}
            <div className="pktw-flex-shrink-0 pktw-flex pktw-justify-between pktw-items-center pktw-px-6 pktw-pt-6 pktw-border-b pktw-border-borde">
                {/* 左侧：展示 AI 生成的追问建议（Suggestion Tags） */}
                {/* Tags on the left */}
                <SuggestionTags
                    tags={suggestionTags}
                    onTagClick={handleSuggestionTagClick}
                />

                {/* 右侧：滚动控制按钮（一键到顶、一键到底） */}
                {/* Scroll buttons on the right */}
                <div className="pktw-flex pktw-items-center pktw-gap-1">
                    <IconButton
                        size="lg"
                        onClick={() => scrollToTop(false)}
                        title="Scroll to top"
                        className="hover:pktw-bg-gray-200"
                    >
                        <ArrowUp className="pktw-w-4 pktw-h-4 pktw-text-muted-foreground group-hover:pktw-text-black" />
                    </IconButton>
                    <IconButton
                        size="lg"
                        onClick={() => {
                            scrollToBottom(true);
                            resumeAutoScroll(); // 滚到底部后，顺便恢复自动滚动
                        }}
                        title="Scroll to latest"
                        className="hover:pktw-bg-gray-200"
                    >
                        <ArrowDown className="pktw-w-4 pktw-h-4 pktw-text-muted-foreground group-hover:pktw-text-black" />
                    </IconButton>
                </div>
            </div>

            {/* 底栏：用户打字输入区 */}
            {/* Footer - Input Area */}
            <div className="pktw-flex-shrink-0">
                <ChatInputAreaComponent />
            </div>

            {/* 弹窗区域（如果需要可以放在这里） */}
            {/* Modals */}
        </div>
    );
};
