/**
 * @file eventBus.ts
 * @description 应用级事件总线。
 * 基于 Obsidian 的 Workspace 事件机制实现，用于在不同的 View、Component 和 Service 之间进行解耦通信。
 * 定义了所有自定义事件类型（如选择变更、消息发送等）及其对应的数据载荷。
 */

import { App } from 'obsidian';
import { ChatConversation, ChatProject } from '@/service/chat/types';

/**
 * Custom events for view communication
 * 
 * 视图通信的自定义事件枚举。
 */
export enum ViewEventType {
	/** 侧边栏/列表中的选择项发生了变化（如点击了另一个对话） */
	SELECTION_CHANGED = 'peak:selection-changed',
	/** 某个对话的内容或元数据被更新（如重命名、摘要更新） */
	CONVERSATION_UPDATED = 'peak:conversation-updated',
	/** 项目元数据被更新 */
	PROJECT_UPDATED = 'peak:project-updated',
	/** 通知聊天视图滚动到某条特定消息 */
	SCROLL_TO_MESSAGE = 'peak:scroll-to-message',
	/** 打开链接（内部笔记或外部 URL） */
	OPEN_LINK = 'peak:open-link',
	/** 显示全局 Toast 提示 */
	SHOW_TOAST = 'peak:show-toast',
	/** 插件设置被保存并更新 */
	SETTINGS_UPDATED = 'peak:settings-updated',
	/** 用户发送了一条新消息（用于触发自动保存、UI 更新等） */
	MESSAGE_SENT = 'peak:message-sent',
	/** 创建了新的会话 */
	CONVERSATION_CREATED = 'peak:conversation-created',
}

/**
 * Base class for all view events
 * 
 * 视图事件基类。包含事件类型和发生时间戳。
 */
export abstract class ViewEvent {
	readonly type: ViewEventType;
	readonly timestamp: number;

	constructor(type: ViewEventType) {
		this.type = type;
		this.timestamp = Date.now();
	}
}

/**
 * Selection changed event
 * 
 * 选择项变更事件。用于同步左侧列表的高亮状态。
 */
export class SelectionChangedEvent extends ViewEvent {
	conversationId?: string | null;
	projectId?: string | null;

	constructor(data: { conversationId?: string | null; projectId?: string | null }) {
		super(ViewEventType.SELECTION_CHANGED);
		this.conversationId = data.conversationId;
		this.projectId = data.projectId;
	}
}

/**
 * Conversation updated event
 * 
 * 会话内容更新事件。
 */
export class ConversationUpdatedEvent extends ViewEvent {
	conversation: ChatConversation;

	constructor(data: { conversation: ChatConversation }) {
		super(ViewEventType.CONVERSATION_UPDATED);
		this.conversation = data.conversation;
	}
}

/**
 * Project updated event
 * 
 * 项目内容更新事件。
 */
export class ProjectUpdatedEvent extends ViewEvent {
	project: ChatProject;

	constructor(data: { project: ChatProject }) {
		super(ViewEventType.PROJECT_UPDATED);
		this.project = data.project;
	}
}

/**
 * Scroll to message event
 * 
 * 消息滚动定位事件。
 */
export class ScrollToMessageEvent extends ViewEvent {
	messageId: string;

	constructor(data: { messageId: string }) {
		super(ViewEventType.SCROLL_TO_MESSAGE);
		this.messageId = data.messageId;
	}
}

/**
 * Open link event
 * 
 * 链接跳转事件。
 */
export class OpenLinkEvent extends ViewEvent {
	path: string;

	constructor(data: { path: string }) {
		super(ViewEventType.OPEN_LINK);
		this.path = data.path;
	}
}

/**
 * Settings updated event
 * 
 * 设置更新通知。
 */
export class SettingsUpdatedEvent extends ViewEvent {
	constructor() {
		super(ViewEventType.SETTINGS_UPDATED);
	}
}

/**
 * Message sent event
 * 
 * 消息已发送事件。
 */
export class MessageSentEvent extends ViewEvent {
	conversationId: string;
	projectId?: string | null;

	constructor(data: { conversationId: string; projectId?: string | null }) {
		super(ViewEventType.MESSAGE_SENT);
		this.conversationId = data.conversationId;
		this.projectId = data.projectId;
	}
}

/**
 * Conversation created event
 * 
 * 会话已创建事件。
 */
export class ConversationCreatedEvent extends ViewEvent {
	conversationId: string;
	projectId?: string | null;

	constructor(data: { conversationId: string; projectId?: string | null }) {
		super(ViewEventType.CONVERSATION_CREATED);
		this.conversationId = data.conversationId;
		this.projectId = data.projectId;
	}
}

/**
 * Toast event for cross-instance toast display
 * 
 * 全局 Toast 提示事件。支持自定义描述、时长和动作按钮。
 */
export class ShowToastEvent extends ViewEvent {
	message: string | React.ReactNode;
	toastType: 'default' | 'success' | 'error' | 'warning' | 'info';
	description?: string | React.ReactNode;
	duration?: number;
	action?: {
		label: string;
		onClick: () => void;
	};

	constructor(data: {
		message: string | React.ReactNode;
		type?: 'default' | 'success' | 'error' | 'warning' | 'info';
		description?: string | React.ReactNode;
		duration?: number;
		action?: {
			label: string;
			onClick: () => void;
		};
	}) {
		super(ViewEventType.SHOW_TOAST);
		this.message = data.message;
		this.toastType = data.type || 'default';
		this.description = data.description;
		this.duration = data.duration;
		this.action = data.action;
	}
}

type EventListener<T extends ViewEvent = ViewEvent> = (event: T) => void;

/**
 * Simple event bus using Obsidian's workspace events
 * 
 * 事件总线封装。利用 Obsidian 内置的 workspace.trigger 和 workspace.on 实现。
 * 这保证了事件系统与 Obsidian 的生命周期同步。
 */
export class EventBus {
	private static instance: EventBus | null = null;
	private app: App;

	private constructor(app: App) {
		this.app = app;
	}

	/**
	 * Get singleton instance
	 * 
	 * 获取单例实例。
	 */
	static getInstance(app: App): EventBus {
		if (!EventBus.instance) {
			EventBus.instance = new EventBus(app);
		}
		return EventBus.instance;
	}

	/**
	 * Dispatch an event
	 * 
	 * 派发（触发）一个事件。
	 */
	dispatch<T extends ViewEvent>(event: T): void {
		this.app.workspace.trigger(event.type as any, event);
	}

	/**
	 * Subscribe to an event (custom view events or workspace events)
	 * @returns Unsubscribe function
	 * 
	 * 订阅一个事件。返回一个取消订阅的函数。
	 */
	on<T extends ViewEvent>(eventType: ViewEventType, callback: EventListener<T>): () => void;
	on(eventType: string, callback: (...args: any[]) => void): () => void;
	on(eventType: ViewEventType | string, callback: any): () => void {
		const ref = this.app.workspace.on(eventType as any, callback);
		// 返回清理函数以便在组件卸载时调用
		return () => {
			this.app.workspace.offref(ref);
		};
	}
}

		return () => this.app.workspace.offref(ref);
	}
}

