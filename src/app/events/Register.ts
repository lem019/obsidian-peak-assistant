/**
 * @file Register.ts (Events)
 * @description 工作区级响应式事件注册。
 * 负责监听 Obsidian 的原生事件（如文件打开、活动叶片切换），并据此更新 UI（如在 Markdown 视图角落添加“切换到对话”按钮）。
 */

import { MarkdownView, TFile } from 'obsidian';
import type MyPlugin from 'main';
import { parseFrontmatter } from '@/core/utils/markdown-utils';
import { ViewManager } from '@/app/view/ViewManager';
import { EventBus, SelectionChangedEvent } from '@/core/eventBus';
import { useChatViewStore } from '@/ui/view/chat-view/store/chatViewStore';
import { createElement, icons } from 'lucide';
import { CHAT_PROJECT_SUMMARY_FILENAME } from '@/core/constant';

/**
 * 注册工作区级响应式事件。
 */
export function registerCoreEvents(plugin: MyPlugin, viewManager: ViewManager): void {
	const eventBus = EventBus.getInstance(plugin.app);

	/**
	 * 监听活动叶片 (Leaf) 变更：
	 * 核心逻辑：确保 UI 的一致性。当用户点击左边栏的文件浏览器或右边栏的其他插件视图时，
	 * 通过此监听器感知到的变化来决定是否应该切换回普通文档模式。
	 */
	eventBus.on('active-leaf-change', (leaf) => {
		viewManager.getViewSwitchConsistentHandler().handleActiveLeafChange(leaf);
	});

	/**
	 * 监听文件打开事件 (file-open)：
	 * 核心逻辑：按钮注入。每当一个新的 Markdown 文件被加载到编辑器，
	 * 我们都需要检查它是否是聊天历史文件，并动态注入悬浮按钮。
	 */
	eventBus.on('file-open', (file) => {
		// 首先清理掉之前页面上存在的按钮残余
		removeAllChatViewButtons();
		
		if (file && file.extension === 'md') {
			handleConversationFileOpen(plugin, viewManager, file, eventBus);
		}
	});

	// 再次监听 active-leaf-change 是一种保险机制
	// 因为有些操作（如在一个已经打开的 Leaf 中切换文件）可能不会可靠地触发 file-open
	// 或者在切换标签页时，需要根据新激活的叶片重新显示按钮
	eventBus.on('active-leaf-change', (leaf) => {
		removeAllChatViewButtons();
		
		const markdownView = leaf?.view;
		if (markdownView && markdownView instanceof MarkdownView) {
			const file = markdownView.file;
			if (file && file.extension === 'md') {
				handleConversationFileOpen(plugin, viewManager, file, eventBus);
			}
		}
	});
}

/**
 * 移除工作区中所有已注入的聊天视图快捷转换按钮。
 * 利用 CSS 类选择器 `.peak-chat-view-button-container` 找到并物理删除该 DOM 元素。
 */
function removeAllChatViewButtons(): void {
	const buttons = document.querySelectorAll('.peak-chat-view-button-container');
	buttons.forEach(button => button.remove());
}

/**
 * 检查打开的文件是否为对话文件（Conversation File）。
 */
async function handleConversationFileOpen(
	plugin: MyPlugin,
	viewManager: ViewManager,
	file: TFile,
	eventBus: EventBus
): Promise<void> {
	// 忽略特殊的“项目摘要”文件，这些文件是说明性的，不代表一个对话会话
	if (file.name === CHAT_PROJECT_SUMMARY_FILENAME) {
		return;
	}

	try {
		// 关键判别逻辑：
		// 1. 读取文件头。
		// 2. 查找 YAML 中的特殊的 ID 标记。
		const content = await plugin.app.vault.read(file);
		const frontmatter = parseFrontmatter<Record<string, unknown>>(content);
		
		// 如果 frontmatter 中包含对话 ID (id)，说明这是一个由插件生成的对话文件
		if (frontmatter?.data?.id && typeof frontmatter.data.id === 'string') {
			const conversationId = frontmatter.data.id as string;
			
			// 延迟 100ms 注入。这是一个性能优化的“黑魔法”，
			// 因为 Obsidian 在打开大文件时 DOM 渲染可能尚未完全稳定，延迟可以确保按钮挂载到正确的父容器上。
			setTimeout(() => {
				addChatViewButton(plugin, viewManager, file, conversationId, eventBus);
			}, 100);
		}
	} catch (error) {
		// 对于普通 Markdown 文件（没有 frontmatter 的）读取报错视为正常，不处理
	}
}

/**
 * 在 Markdown 编辑器的 contentEl 中注入一个悬浮的“切换到对话视图”按钮。
 */
function addChatViewButton(
	plugin: MyPlugin,
	viewManager: ViewManager,
	file: TFile,
	conversationId: string,
	eventBus: EventBus
): void {
	// 确保当前活动视图就是要注入的文件视图。防止在多标签或分屏模式下将按钮注入到错误的窗口。
	const markdownView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
	if (!markdownView || markdownView.file?.path !== file.path) {
		return;
	}

	// 检查按钮是否已存在（幂等操作，避免快速切换导致的重复注入）
	const existingButton = markdownView.contentEl.querySelector('.peak-chat-view-button');
	if (existingButton) {
		return;
	}

	// 确保容器可以承载绝对定位元素。
	// 通过动态修改 CSS 样式，让按钮可以相对于编辑器容器进行定位。
	if (getComputedStyle(markdownView.contentEl).position === 'static') {
		markdownView.contentEl.style.position = 'relative';
	}

	// 创建按钮容器 DOM
	const buttonContainer = markdownView.contentEl.createDiv({
		cls: 'peak-chat-view-button-container'
	});

	// 创建按钮 element，并添加无障碍支持（aria-label）
	const button = buttonContainer.createEl('button', {
		cls: 'peak-chat-view-button',
		attr: {
			title: 'Switch to chat view',
			'aria-label': 'Switch to chat view'
		}
	});

	// 使用 Lucide 图标集。通过图标让用户一目了然其聊天功能。
	const MessageCircleIcon = icons.MessageCircle;
	if (MessageCircleIcon) {
		const svg = createElement(MessageCircleIcon, {
			class: 'peak-icon',
			width: 16,
			height: 16,
			stroke: 'currentColor',
			'stroke-width': 2
		});
		button.appendChild(svg as unknown as Node);
	}

	/**
	 * 核心点击交互逻辑：
	 * 当用户在阅读对话 Markdown 文件时，点击此按钮可以无缝切换到插件的交互式聊天界面。
	 */
	button.addEventListener('click', async () => {
		// 第一步：强制切换 UI 到“三栏对话布局”
		await viewManager.getViewSwitchConsistentHandler().activateChatView();

		const aiManager = plugin.aiServiceManager;
		if (!aiManager) {
			return;
		}

		// 第二步：再次深度解析文件以获取所有必要的关联 ID（如项目 ID）
		let projectId: string | undefined;
		try {
			const content = await plugin.app.vault.read(file);
			const frontmatter = parseFrontmatter<Record<string, unknown>>(content);
			projectId = frontmatter?.data?.projectId as string | undefined;
		} catch (error) {
			console.error('Failed to read file for projectId:', error);
		}

		// 第三步：在数据层定位该项目与对话
		let project = null;
		if (projectId) {
			const projects = await aiManager.listProjects();
			project = projects.find(p => p.meta.id === projectId) || null;
		}

		const conversations = await aiManager.listConversations(projectId);
		const conversation = conversations.find(c => c.meta.id === conversationId);
		
		if (conversation) {
			// 第四步：同步 React Store 状态。
			// 这将导致中间的聊天主窗口立即重绘为此对话的内容。
			const { setConversation } = useChatViewStore.getState();
			setConversation(conversation);

			// 第五步：通知整个插件系统进行视觉同步。
			// 派发 SelectionChangedEvent 事件，让左侧的项目列表自动跳转并点亮当前的对话项。
			eventBus.dispatch(new SelectionChangedEvent({
				conversationId: conversation.meta.id,
				projectId: project?.meta.id ?? null,
			}));
		}
	});
}


