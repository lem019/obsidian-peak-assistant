
/**
 * @file Register.ts
 * @description 核心命令注册类。负责将插件的所有功能（搜索、聊天、索引等）注册到 Obsidian 的命令面板中。
 * 这些命令是用户与插件交互的主要入口点之一。
 */

import { Notice } from 'obsidian';
import type { ChatProjectMeta } from '@/service/chat/types';
import { ViewManager } from '@/app/view/ViewManager';
import { Command, Modal } from 'obsidian';
import { AIServiceManager } from '@/service/chat/service-manager';
import { useChatViewStore } from '@/ui/view/chat-view/store/chatViewStore';
import { QuickSearchModal } from '@/ui/view/QuickSearchModal';
import { SearchClient } from '@/service/search/SearchClient';
import type { MyPluginSettings, SearchSettings } from '@/app/settings/types';
import { IndexInitializer } from '@/service/search/index/indexInitializer';
import { IndexService } from '@/service/search/index/indexService';
import { DEFAULT_NEW_CONVERSATION_TITLE } from '@/core/constant';
import { ConfirmModal } from '@/ui/view/ConfirmModal';
import { verifyDatabaseHealth } from '@/core/storage/sqlite/DatabaseHealthVerifier';

/**
 * 构建并返回核心命令列表。这些命令随后会被插件实例通过 `this.addCommand()` 注册。
 */
export function buildCoreCommands(
	settings: MyPluginSettings,
	viewManager: ViewManager,
	aiManager: AIServiceManager,
	searchClient: SearchClient | null,
	indexInitializer: IndexInitializer,
	searchSettings?: SearchSettings,
	storageFolder?: string,
): Command[] {
	return [
		{
			// 快速搜索命令：允许用户通过一个统一的模态框搜索所有已索引的内容
			id: 'peak-quick-search',
			name: 'Open Quick Search',
			callback: () => {
				// 打开全局快速搜索模态框（类似 Ctrl+P 但针对插件索引内容）
				const modal: Modal = new QuickSearchModal(viewManager.appContext);
				modal.open();
			},
		},
		{
			// 打开聊天模式面板：激活包含左右侧边栏和中间聊天区的完整布局
			id: 'peak-chat-open-view',
			name: 'Open Chat Mode Panel',
			callback: () => void viewManager.getViewSwitchConsistentHandler().activateChatView(),
		},
		{
			// 切换到聊天视图：显式触发 UI 切换到对话布局
			id: 'peak-chat-switch-to-chat-view',
			name: 'Switch to Chat View',
			callback: () => void viewManager.getViewSwitchConsistentHandler().activateChatView(),
		},
		{
			// 切换到文档视图：关闭插件特有布局，恢复 Obsidian 默认的文件编辑状态
			id: 'peak-chat-switch-to-document-view',
			name: 'Switch to Document View',
			callback: () => void viewManager.getViewSwitchConsistentHandler().activeDocumentView(),
		},
		{
			// 新建聊天项目：用于对对话进行分类管理
			id: 'peak-chat-new-project',
			name: 'New Chat Project',
			callback: async () => {
				// 提示用户输入项目名称并创建新的聊天项目
				const name = await viewManager.promptForInput('Enter project name');
				if (!name) return;
				const meta: Omit<ChatProjectMeta, 'id' | 'createdAtTimestamp' | 'updatedAtTimestamp'> = {
					name,
				};
				await aiManager.createProject(meta);
			},
		},
		{
			// 新建聊天会话：在不离开当前视图的情况下开启一个空对话
			id: 'peak-chat-new-conversation',
			name: 'New Chat Conversation',
			callback: async () => {
				// 在当前 Chat 视图中准备一个新的会话，实际创建暂存于 Store 中
				useChatViewStore.getState().setPendingConversation({
					title: DEFAULT_NEW_CONVERSATION_TITLE,
					project: null,
				});
			},
		},
		{
			// 执行搜索索引：同步本地文件到向量数据库
			id: 'peak-search-index',
			name: 'Index Search',
			callback: async () => {
				// 执行本地搜索索引。如果已有索引则执行增量更新，否则执行全量更新。
				if (!searchClient) {
					new Notice('Search service is not available. Please restart the plugin.', 5000);
					return;
				}
				if (!searchSettings) {
					new Notice('Search settings are not available. Please restart the plugin.', 5000);
					return;
				}

				const indexStatus = await IndexService.getInstance().getIndexStatus();
				const hasIndex = indexStatus.isReady && indexStatus.indexBuiltAt !== null;
				console.debug('[Register] Index status hasIndex:', hasIndex);
				if (hasIndex) {
					// 增量索引：只扫描变更的文件，效率更高
					await indexInitializer.performIncrementalIndexing();
				} else {
					// 全量索引：扫描库中所有符合条件的文件，首次启动或数据损坏时使用
					await indexInitializer.performFullIndexing(true);
				}
			},
		},
		{
			// 删除索引数据：清理 SQLite 数据库，通常用于重置环境或节省空间
			id: 'peak-delete-index-data',
			name: 'Delete Index Data',
			callback: async () => {
				// 清除本地所有已建立的搜索索引数据（SQLite 中的数据）
				const indexStatus = await IndexService.getInstance().getIndexStatus();
				const hasIndex = indexStatus.isReady && indexStatus.indexedDocs !== null && indexStatus.indexedDocs > 0;

				if (!hasIndex) {
					new Notice('No index data found to delete.', 3000);
					return;
				}

				// 弹出确认框，防止用户误操作导致需要重新建立长时间的索引
				const modal = new ConfirmModal(
					viewManager.getApp(),
					viewManager.appContext,
					'Delete Index Data',
					`Are you sure you want to delete all index data? This will remove ${indexStatus.indexedDocs} indexed documents and cannot be undone.`,
					async () => {
						try {
							await IndexService.getInstance().clearAllIndexData();
							new Notice('Index data deleted successfully.', 3000);
						} catch (error) {
							console.error('[Register] Error deleting index data:', error);
							new Notice('Failed to delete index data. Please check the console for details.', 5000);
						}
					},
					undefined,
					'Love u CPU',
				);
				modal.open();
			},
		},
		{
			// 取消当前索引任务：如果用户发现索引占用过多资源，可以随时中断
			id: 'peak-cancel-index',
			name: 'Cancel Index',
			callback: () => {
				// 强行中断正在进行的索引扫描过程
				IndexService.cancelIndexing();
				new Notice('Index operation cancelled.', 3000);
			},
		},
		{
			// 验证数据库健康状态：检查 SQLite 文件是否正常、各种表是否损坏
			id: 'peak-database-verify',
			name: 'Verify Database Health',
			callback: async () => {
				// 检查 SQLite 数据库文件的完整性和可连接性
				await verifyDatabaseHealth(viewManager.getApp(), settings);
			},
		},

	];
}


