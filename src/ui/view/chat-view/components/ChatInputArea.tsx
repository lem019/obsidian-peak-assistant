/**
 * 【这个文件是干什么的】
 * ChatInputAreaComponent 是聊天界面的“输入总成”组件。
 * 
 * 【起了什么作用】
 * 1. 组合 UI：它把底层的 `PromptInput` 及其各个零件（输入框、按钮、附件列表）组合在一起。
 * 2. 业务适配：处理特定的业务逻辑，如：
 *    - 联想搜索：输入 `@` 时搜索文件，输入 `/` 时联想 Prompt 模板。
 *    - 会话配置：选择 AI 模型、切换聊天模式（Search, Code, etc.）、控制 LLM 输出参数。
 *    - 发送控制：调用 `useChatSubmit` 发送消息，并管理发送中的 Loading 状态和取消流操作。
 *    - 自动清理：当发送开始时，自动清空输入框。
 * 
 * 【举例介绍】
 * 即使你在输入框写了很长的文字并带了 3 个附件，当你点击“发送”按钮时，这个组件会通过 `useChatSubmit` 异步把数据推给后台，
 * 同时它会立刻通过 `InputClearHandler` 清除当前视图里的文字和文件，让用户感觉操作很丝滑。
 * 
 * 【技术实现】
 * - 使用 `useChatSessionStore` 管理本地化的会话偏好（如选中的搜索提供商等）。
 * - 深度集成 `PromptInput` 的 Context 体系，通过扩展 `autocompletion` 逻辑实现复杂的 `@` 联想。
 * - 结合 `CodeMirror` 的底层能力（通过 PromptInput 暴露），支持丰富的文本编辑体验。
 */
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useProjectStore } from '@/ui/store/projectStore';
import { useMessageStore } from '@/ui/view/chat-view/store/messageStore';
import {
	PromptInput,
	PromptInputBody,
	PromptInputAttachments,
	PromptInputFileButton,
	PromptInputSearchButton,
	PromptInputSubmit,
	TokenUsage,
	usePromptInputContext,
	type PromptInputMessage,
	type TokenUsageInfo,
} from '@/ui/component/prompt-input';
import { ToolButton } from '@/ui/component/prompt-input';
import { ModeSelector } from '../../../component/prompt-input/ModeSelector';
import { cn } from '@/ui/react/lib/utils';
import { useChatSubmit } from '../hooks/useChatSubmit';
import { ChatTag, useChatSessionStore } from '../store/chatSessionStore';
import { useServiceContext } from '@/ui/context/ServiceContext';
import type { NavigableMenuItem } from '@/ui/component/mine/NavigableMenu';
import { getFileIcon } from '@/ui/view/shared/file-utils';
import { ModelSelector } from '@/ui/component/mine/ModelSelector';
import { HoverButton, OutputControlSettingsList } from '@/ui/component/mine';
import { Settings2 } from 'lucide-react';
import { useModels } from '@/ui/hooks/useModels';
import { SearchResultItem } from '@/service/search/types';

// 配置常量
// Constants for search configuration
const RECENT_FILES_COUNT = 3; // 默认展示的最近文件数量
const SEARCH_RESULTS_TOP_K = 20; // 搜索返回的最大条数

interface ChatInputAreaComponentProps {
}

/**
 * Internal component to clear input immediately when sending starts
 * 【辅助组件】输入清理处理器
 * 专门负责在发送状态变为 true 的那一瞬间，扣动扳手清空输入框，提升响应感。
 */
const InputClearHandler: React.FC<{ isSending: boolean }> = ({ isSending }) => {
	const inputContext = usePromptInputContext();
	const prevIsSendingRef = React.useRef(isSending);

	React.useEffect(() => {
		// 监听 isSending 从 false 变为 true 的瞬间
		// Clear input immediately when sending starts (changes from false to true)
		if (!prevIsSendingRef.current && isSending) {
			inputContext.textInput.clear();
			inputContext.attachments.clear();
		}
		prevIsSendingRef.current = isSending;
	}, [isSending, inputContext]);

	return null;
};

/**
 * 聊天输入区主组件
 */
export const ChatInputAreaComponent: React.FC<ChatInputAreaComponentProps> = ({
}) => {
	// 获取会话相关的状态和 setters (从 Zustand store)
	const {
		promptsSuggest,
		isSearchActive,
		searchProvider,
		enableWebSearch,
		enableVaultSearch,
		enableTwitterSearch,
		enableRedditSearch,
		attachmentHandlingMode,
		llmOutputControlSettings,
		isCodeInterpreterEnabled,
		chatMode,
		selectedModel,
		setSearchActive,
		setSearchProvider,
		setEnableWebSearch,
		setEnableVaultSearch,
		setEnableTwitterSearch,
		setEnableRedditSearch,
		setAttachmentHandlingMode,
		setLlmOutputControlSettings,
		setIsCodeInterpreterEnabled,
		setChatMode,
		setSelectedModel
	} = useChatSessionStore();

	// 使用专用 Hook 获取/管理模型列表
	// Use the models hook for managing model data
	const { models, isModelsLoading } = useModels();
	const activeConversation = useProjectStore((state) => state.activeConversation);
	const activeProject = useProjectStore((state) => state.activeProject);
	
	// 组件内部 UI 状态
	const [isSending, setIsSending] = useState(false);
	const [menuContextItems, setMenuContextItems] = useState<NavigableMenuItem[]>([]);
	const { searchClient, manager } = useServiceContext();
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const inputFocusRef = useRef<{ focus: () => void } | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	// 获取提交逻辑和会话状态管理
	const { submitMessage, cancelStream } = useChatSubmit();
	const { setCurrentInputTags } = useChatSessionStore();

	// 处理文本变化：不仅同步内容，还要同步提取出的标签（如 `@文件` 这种特殊的 CodeMirror 节点）
	// Handle text changes with pre-parsed tags
	const handleTextChange = useCallback((text: string, tags: ChatTag[]) => {
		setCurrentInputTags(tags);
	}, [setCurrentInputTags]);

	/**
	 * 上下文搜索逻辑 (用于 @ 联想)
	 * 当用户输入 @ 时，调用此方法搜索整个库库或特定文件夹。
	 */
	// Callback for searching context items in context menu
	const handleSearchContext = useCallback(async (query: string, currentFolder?: string): Promise<NavigableMenuItem[]> => {
		if (!searchClient) return [];

		try {
			// todo maybe we can filter among existing menu context items first. and then search the rest from db to get better performance.
			console.debug('[ChatInputAreaComponent] Searching context:', query, currentFolder);

			// 始终初始化一部分“最近文件”，提高常用文件的选择速度
			// always have recent files in the menu
			let results: SearchResultItem[] = await searchClient.getRecent(RECENT_FILES_COUNT);
			
			// 如果有查询词，执行全文搜索
			if (query.trim() || currentFolder) {
				const searchResults = await searchClient.search({
					text: query.trim() || '',
					scopeMode: currentFolder ? 'inFolder' : 'vault',
					scopeValue: currentFolder ? { folderPath: currentFolder } : undefined,
					topK: SEARCH_RESULTS_TOP_K,
					searchMode: 'fulltext'
				});
				results.push(...(searchResults.items || []));
			}

			// 哈希去重：防止最近列表和搜索结果里有重复的文件项
			// Deduplicate results based on path/id to prevent duplicate React keys
			const seen = new Set<string>();
			const uniqueResults = results.filter(item => {
				const key = item.path || item.id;
				if (seen.has(key)) {
					return false;
				}
				seen.add(key);
				return true;
			});

			// 将原始搜索结果转换为 UI 菜单项格式
			return uniqueResults.map((item: SearchResultItem) => ({
				id: item.path || item.id,
				label: item.title || item.path || item.id,
				description: item.path || item.id,
				value: item.path || item.id,
				icon: (isSelected: boolean) => getFileIcon(item.type, isSelected),
				showArrow: item.type === 'folder'
			}));
		} catch (error) {
			console.error('Error searching files:', error);
			return [];
		}
	}, [searchClient]);

	// 初始化时先加载一遍默认菜单项（通常是最近文件）
	// Initialize menu context items
	useEffect(() => {
		handleSearchContext('', undefined).then(setMenuContextItems);
	}, [handleSearchContext]);

	/**
	 * Prompt 模板搜索逻辑 (用于 / 联想)
	 */
	// Callback for searching prompts in prompt menu
	const handleSearchPrompts = useCallback(async (query: string): Promise<NavigableMenuItem[]> => {
		// 结合本地缓存的 Prompt 和 远程服务的 Prompt
		// Combine results from local prompts and external prompt service search
		const results: NavigableMenuItem[] = [];

		// 1. 过滤本地建议列表
		// 1. Filter local prompts
		let localPrompts: NavigableMenuItem[] = [];
		if (!query.trim()) {
			localPrompts = promptsSuggest;
		} else {
			const lowerQuery = query.toLowerCase();
			localPrompts = promptsSuggest.filter(prompt =>
				prompt.label.toLowerCase().includes(lowerQuery) ||
				prompt.description?.toLowerCase().includes(lowerQuery) ||
				prompt.value.toLowerCase().includes(lowerQuery)
			);
		}
		results.push(...localPrompts);

		// 2. 如果 query 够长，去远程搜搜更有创意的 Prompt
		// 2. Search external prompts using AI service manager
		if (query.trim()) {
			try {
				const externalPrompts = await manager.searchPrompts(query);
				results.push(...externalPrompts);
			} catch (error) {
				console.error('Error searching external prompts:', error);
			}
		}

		// 再次基于 value 去重
		// Deduplicate results by value, keeping the first occurrence
		const seen = new Set();
		const dedupedResults = [];
		for (const item of results) {
			if (!seen.has(item.value)) {
				seen.add(item.value);
				dedupedResults.push(item);
			}
		}

		return dedupedResults;
	}, [promptsSuggest, manager]);

	// 处理自动补全菜单选中事件
	// Handle menu selection from CodeMirror autocompletion
	const handleMenuSelect = useCallback(async (triggerChar: string, selectedItem?: any) => {
		console.debug('[ChatInputAreaComponent] Trigger ', triggerChar, '.selected item:', selectedItem);

		// 【文件夹导航逻辑】
		// 如果用户正在使用 @ 或 [[ 联想，并且选中的是一个“文件夹”
		// Handle folder navigation - if selecting a folder with @ or [[ triggers, navigate into it instead of closing menu
		const isContextTrigger = triggerChar === '@' || triggerChar === '[[';
		if (isContextTrigger && selectedItem?.showArrow) {
			try {
				console.debug('[ChatInputAreaComponent] Navigating to folder:', selectedItem.value);
				// 核心逻辑：不关闭菜单，而是递归加载该文件夹下的内容并更新菜单项
				// Get the contents of the selected folder
				const folderContents = await handleSearchContext('', selectedItem.value);
				setMenuContextItems(folderContents);
			} catch (error) {
				console.error('Error loading folder contents:', error);
				setMenuContextItems([]);
			}
			// 注意：此时不关闭菜单，也不更新输入框文字，让用户继续挑选文件
			// Don't close menu or update input for folder navigation
		}

		// 对于 CodeMirror，文本插入逻辑已经在底层实现，这里通常只做补充逻辑
		// For CodeMirror, text insertion is handled by the autocompletion apply function
		// We don't need to manually update the DOM here
	}, [handleSearchContext]);

	/**
	 * 消息发送核心回调
	 */
	// Handle submit
	const handleSubmit = useCallback(async (message: PromptInputMessage) => {
		const currentInputValue = message.text;
		const currentPendingFiles = message.files;

		// 简单的空检查，防止误触
		// Validate input
		if (!currentInputValue.trim() && currentPendingFiles.length === 0) return;
		if (isSending) return; // 单点锁：防止重复发送同一个消息

		setIsSending(true);
		try {
			// 将消息委托给专门的 submitMessage 钩子处理，涉及数据库写入和 LLM 调用
			await submitMessage({
				text: currentInputValue,
				files: currentPendingFiles,
				conversation: activeConversation,
				project: activeProject,
			});
		} catch (error) {
			console.error('[ChatInputAreaComponent] Error in handleSubmit:', error);
			// 具体的错误提示通已经在 submitMessage 内部处理了
			// Error handling is done inside submitMessage
		} finally {
			setIsSending(false);
		}
	}, [submitMessage, activeConversation, activeProject, isSending]);

	/**
	 * 计算当前会话的 Token 消耗总量
	 */
	// Calculate total token usage from all messages
	const tokenUsage = useMemo<TokenUsageInfo>(() => {
		if (!activeConversation || !activeConversation.messages || activeConversation.messages.length === 0) {
			return {
				totalUsed: 0,
			};
		}

		// 累加所有历史消息中的 Token 计数字段
		// Sum up token usage from all messages
		const totalUsed = activeConversation.messages.reduce((sum, msg) => {
			if (!msg.tokenUsage) return sum;
			const usage = msg.tokenUsage as any;
			// 兼容不同平台的字段命名 (Snake Case / Camel Case)
			const tokens = usage.totalTokens ?? usage.total_tokens ??
				((usage.promptTokens ?? usage.prompt_tokens ?? 0) + (usage.completionTokens ?? usage.completion_tokens ?? 0));
			return sum + (tokens || 0);
		}, 0);

		return {
			totalUsed,
		};
	}, [activeConversation]);

	// 当切换对话 ID 时，自动把焦点打回输入框，方便用户立刻打字
	// Clear input when conversation changes
	useEffect(() => {
		if (textareaRef.current) {
			setTimeout(() => {
				textareaRef.current?.focus();
			}, 100);
		}
	}, [activeConversation?.meta.id]);

	/**
	 * 键盘快捷键监听
	 * 为深度用户提供的各种黑科技组合键。
	 */
	// Handle keyboard shortcuts (Cmd/Ctrl+K to focus input, Cmd/Ctrl+Enter for line break, Cmd/Ctrl+A for select all)
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			const isModKey = e.metaKey || e.ctrlKey; // 适配不同操作系统的修饰键 (Mac: Cmd, Win/Linux: Ctrl)
			const isKKey = e.key === 'k' || e.key === 'K' || e.keyCode === 75;
			const isEnterKey = e.key === 'Enter';
			const isAKey = e.key === 'a' || e.key === 'A' || e.keyCode === 65;

			// Cmd/Ctrl + K：全局（组件范围内）快速聚焦到输入框
			// Cmd/Ctrl+K to focus input
			if (isModKey && isKKey) {
				const activeElement = document.activeElement;
				if (textareaRef.current && activeElement !== textareaRef.current) {
					e.preventDefault();
					e.stopPropagation();
					e.stopImmediatePropagation();
					setTimeout(() => {
						textareaRef.current?.focus();
					}, 100);
					return false;
				}
			}

			// Cmd/Ctrl + Enter：强制换行
			// 在 Obsidian 的默认逻辑中 Enter 可能是发送，这里提供了一个显式的换行方案
			// Cmd/Ctrl+Enter for line break in textarea
			if (isModKey && isEnterKey && textareaRef.current) {
				e.preventDefault();
				e.stopPropagation();

				const textarea = textareaRef.current;
				const start = textarea.selectionStart;
				const end = textarea.selectionEnd;
				const value = textarea.value;

				// 在光标位置插入一个换行符
				// Insert line break at cursor position
				textarea.value = value.substring(0, start) + '\n' + value.substring(end);
				textarea.selectionStart = textarea.selectionEnd = start + 1;

				// 手动触发 input 事件，让那些依赖 onChange 的 React 状态同步
				// Trigger input event to update any reactive state
				textarea.dispatchEvent(new Event('input', { bubbles: true }));
			}

			// Cmd/Ctrl + A：一键全选
			// Cmd/Ctrl+A for select all in textarea
			if (isModKey && isAKey && textareaRef.current) {
				e.preventDefault();
				e.stopPropagation();

				const textarea = textareaRef.current;
				textarea.select(); // 原生 select() 方法
			}
		};

		// 使用捕获阶段 (true) 来确保我们的快捷键逻辑优先被处理
		window.addEventListener('keydown', handleKeyDown, true);
		return () => {
			window.removeEventListener('keydown', handleKeyDown, true);
		};
	}, []);

	// 判断聊天历史，为 Placeholder 提供一点动感
	const hasMessages = activeConversation && activeConversation.messages.length > 0;
	// 动态提示文字，暗示用户可以使用各种联想功能
	const placeholder = (hasMessages ? '' : 'Type your message here...\n')
		+ '@ or [[]] for context. / for prompts. ⌘ ↩︎ for a line break.';

	// 检查当前是否有流在跑（AI 是否正在输出）
	// Check if streaming is active
	const isStreaming = useMessageStore((state) => state.streamingMessageId !== null);

	// 处理取消流（那个红色的 X 按钮）
	// Handle cancel stream
	const handleCancelStream = useCallback(async () => {
		if (isStreaming) {
			console.log('[ChatInputArea] Canceling stream');
			await cancelStream();
			// 手动重置 loading 状态，提升 UI 反馈感
			// Note: setIsSending(false) will be called in handleSubmit's finally block
			// But we set it here immediately for better UX
			setIsSending(false);
		}
	}, [isStreaming, cancelStream]);

	// 计算提交按钮的四种状态：准备就绪、等待提交中、正在流式接收、错误状态（暂未用）
	// Button status: 'ready' (blue + Enter) when not sending, 'streaming' when streaming, 'submitted' when sending but not streaming
	const status: 'ready' | 'submitted' | 'streaming' | 'error' = isStreaming ? 'streaming' : (isSending ? 'submitted' : 'ready');

	// ============================================================================
	// 渲染 (Render)
	// ============================================================================
	return (
		<div ref={containerRef} className="pktw-relative pktw-px-6 pktw-pt-2 pktw-pb-6 pktw-border-t pktw-border-border pktw-flex-shrink-0">
			{/* 高阶组件 PromptInput：封装了所有的 Context 和输入状态逻辑 */}
			<PromptInput
				className={cn(
					'pktw-flex pktw-flex-col pktw-w-full pktw-border pktw-rounded-lg',
					'pktw-border-[var(--background-modifier-border)]',
					'pktw-shadow-[0_0_0_2px_rgba(59,130,246,0.1)]',
					'focus-within:pktw-border-accent focus-within:pktw-shadow-[0_0_0_4px_rgba(59,130,246,0.4)]'
				)}
				globalDrop // 允许文件拖入整个输入区域
				multiple // 允许选择多个附件
				inputFocusRef={inputFocusRef}
				onSubmit={handleSubmit}
				contextItems={menuContextItems}
				promptItems={promptsSuggest}
				onLoadContextItems={handleSearchContext}
				onLoadPromptItems={handleSearchPrompts}
				onMenuItemSelect={handleMenuSelect}
				onTextChange={handleTextChange}
			>
				{/* 内部监听器：发送瞬间清空输入框 */}
				{/* Clear input handler */}
				<InputClearHandler isSending={isSending} />

				{/* 附件展示栏：展示已选中的图片、文档等文件图标 */}
				{/* Attachments display */}
				<PromptInputAttachments />

				{/* 编辑器主体：包含 CodeMirror 高阶编辑能力 */}
				{/* Textarea */}
				<PromptInputBody
					ref={textareaRef}
					inputRef={inputFocusRef}
					placeholder={placeholder}
				/>

				{/* 输入框底部工具栏：包含模式切换、文件按钮、发送按钮等 */}
				{/* Footer with tools and submit */}
				<div className="pktw-flex pktw-items-center pktw-justify-between pktw-gap-1.5 pktw-px-3 pktw-py-2">
					{/* 左侧：工具集（文件、搜索、代码执行等开关） */}
					{/* Left side: tools */}
					<div className="pktw-flex pktw-items-center pktw-gap-0.5">
						{/* 文件上传按钮 */}
						<PromptInputFileButton
							attachmentHandlingMode={attachmentHandlingMode}
							onAttachmentHandlingModeChange={setAttachmentHandlingMode}
						/>
						{/* 搜索开关按钮（Vault, Web, Twitter...） */}
						<PromptInputSearchButton
							active={isSearchActive}
							searchProvider={searchProvider}
							enableWebSearch={enableWebSearch}
							enableVaultSearch={enableVaultSearch}
							enableTwitterSearch={enableTwitterSearch}
							enableRedditSearch={enableRedditSearch}
							onToggleActive={() => setSearchActive(!isSearchActive)}
							onChangeProvider={setSearchProvider}
							onToggleWebSearch={setEnableWebSearch}
							onToggleVaultSearch={setEnableVaultSearch}
							onToggleTwitterSearch={setEnableTwitterSearch}
							onToggleRedditSearch={setEnableRedditSearch}
						/>
						{/* 更多 LLM 输出控制参数（温和度、TopP 等） */}
						<HoverButton
							icon={Settings2}
							menuId="output-control-settings"
							menuClassName="pktw-w-[560px] pktw-p-1 pktw-bg-white pktw-border pktw-z-50"
							hoverMenuContent={
								<OutputControlSettingsList
									settings={llmOutputControlSettings}
									onChange={setLlmOutputControlSettings}
									variant="compact"
									useLocalState={true}
								/>
							}
						/>
						{/* 代码解释器开关 */}
						<ToolButton
							isCodeInterpreterEnabled={isCodeInterpreterEnabled}
							onCodeInterpreterEnabledChange={setIsCodeInterpreterEnabled}
						/>
					</div>

					{/* 右侧：模式选择、模型选择、Token 计数和发送按钮 */}
					{/* Right side: mode selector, model selector, token usage and submit */}
					<div className="pktw-flex pktw-items-center pktw-gap-1.5">
						{/* 会话模式切换器（Chat, Code, Deep Search 等） */}
						<ModeSelector
							selectedMode={chatMode}
							onModeChange={setChatMode}
						/>
						{/* 当前使用的模型名展示及切换 */}
						<ModelSelector
							models={models}
							isLoading={isModelsLoading}
							currentModel={selectedModel}
							onChange={async (provider: string, modelId: string) => setSelectedModel(provider, modelId)}
							placeholder="No model selected"
						/>
						{/* Token 使用量统计展示 */}
						<TokenUsage usage={tokenUsage} conversation={activeConversation} />
						{/* 提交/发送按钮 */}
						<PromptInputSubmit
							status={status}
							onCancel={isStreaming ? handleCancelStream : undefined}
						/>
					</div>
				</div>
			</PromptInput>
		</div>
	);
};

