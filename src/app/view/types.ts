/**
 * @file types.ts (View)
 * @description 视图相关的常量与标识符定义。
 * 统一管理插件注册到 Obsidian 中的各类自定义 View 类型 ID。
 */

import { CHAT_VIEW_TYPE } from '@/ui/view/ChatView';
import { PROJECT_LIST_VIEW_TYPE } from '@/ui/view/ProjectListView';
import { MESSAGE_HISTORY_VIEW_TYPE } from '@/ui/view/MessageHistoryView';

export {
	// 中央聊天主视图 ID
	CHAT_VIEW_TYPE,
	// 左侧项目/对话列表视图 ID
	PROJECT_LIST_VIEW_TYPE,
	// 右侧消息历史视图 ID
	MESSAGE_HISTORY_VIEW_TYPE,
};

/**
 * 插件特有的视图类型集合。
 * 用于 `ViewSwitchConsistentHandler` 识别当前活动的 Tab 是否属于本插件。
 */
export const TRACKED_VIEW_TYPES = new Set<string>([
	CHAT_VIEW_TYPE,
	PROJECT_LIST_VIEW_TYPE,
	MESSAGE_HISTORY_VIEW_TYPE,
]);


