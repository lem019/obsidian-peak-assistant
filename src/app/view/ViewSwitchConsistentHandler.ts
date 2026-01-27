/**
 * @file ViewSwitchConsistentHandler.ts
 * @description 视图切换一致性处理器。
 * 这是插件中最重要的 UI 协调逻辑。它确保 Obsidian 的左右边栏和中间主区在“对话场景”与“常规编辑场景”之间同步切换。
 * 它可以防止出现“左边是对话列表，中间却是文档编辑”这种割裂的 UI 状态。
 */

import { App, ViewState, WorkspaceLeaf } from 'obsidian';
import { CHAT_VIEW_TYPE, PROJECT_LIST_VIEW_TYPE, MESSAGE_HISTORY_VIEW_TYPE, TRACKED_VIEW_TYPES } from '@/app/view/types';

/**
 * 确保当处于聊天视图时，左、中、右面板始终保持一致的聊天相关布局
 * (即：左：项目列表，中：聊天窗口，右：消息历史)；
 * 相应地，当处于文档视图时，三块面板始终显示常规的文档视图。
 */
export class ViewSwitchConsistentHandler {
	// 标记当前是否处于“聊天模式布局”
	private isChatLayoutActive = false;
	// 防止并发调用的原子锁
	private isActivating = false;
	private isActivatingDocument = false;

	constructor(app: App) {
		this.app = app;
	}

	private readonly app: App;

	/**
	 * 获取标题为 'New tab' 的空标签页（如果有的话）。
	 */
	private getNewTabLeaf(): WorkspaceLeaf | null {
		const emptyLeaves = this.app.workspace.getLeavesOfType('empty');
		const newTabLeaf = emptyLeaves.find((leaf: WorkspaceLeaf) => {
			const state = leaf.getViewState() as any;
			return state.title === 'New tab';
		});
		return newTabLeaf ?? null;
	}

	/**
	 * 响应 Obsidian 的 active-leaf-change 事件。
	 * 该方法决定了用户在切换标签页时，UI 应该如何表现。
	 * 
	 * 规则如下：
	 * 1. 如果用户点击了插件的任何视图（聊天、历史、列表），则判定用户想进入“聊天工作区”，
	 *    此时会自动展开其余的配套面板。
	 * 2. 如果用户点击了普通的 Markdown 文档，则判定用户回到了“写作模式”，
	 *    此时会自动恢复左侧的文件树和右侧的大纲，并隐藏聊天相关的侧边栏。
	 */
	handleActiveLeafChange(leaf?: WorkspaceLeaf | null): void {
		const viewType = leaf?.view?.getViewType();
		
		// 检查激活的视图是否属于本插件管理的“追踪类型”
		if (viewType && TRACKED_VIEW_TYPES.has(viewType)) {
			// 一体化切换到聊天布局
			void this.activateChatView();
		} else if (viewType !== 'empty') {
			// 如果是普通文档（且排除掉了点击空页面的情况），则切换回文档布局
			void this.activeDocumentView(leaf);
		}
	}

	/**
	 * 强制激活全套聊天布局。
	 * 该方法确保：
	 * Center: ChatView 被置顶并获得焦点
	 * Left: ProjectListView (对话列表) 展开
	 * Right: MessageHistoryView (消息导航) 展开
	 * 
	 * 采用这种三位一体的设计是为了打造专注的 AI 交互空间。
	 */
	async activateChatView(): Promise<void> {
		// 并发控制：如果正在激活中或已经激活，则跳过
		if (this.isChatLayoutActive || this.isActivating) return;

		this.isActivating = true;
		try {
			// 步骤 1：设置中央主视图 (ChatView)
			// 首先寻找是否已经存在现成的 ChatView 标签页，避免重复创建引起资源浪费
			const existingChatLeaves = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);
			const centerLeaf = existingChatLeaves[0] ?? this.app.workspace.getLeaf(false);
			if(centerLeaf) {
				await centerLeaf.setViewState({ type: CHAT_VIEW_TYPE, active: true });
			}

			// 步骤 2：同步驱动左侧侧边栏 (ProjectListView)
			// 注意：getLeftLeaf(false) 代表在左侧面板中寻找或创建一个空间
			const existingProjectListLeaves = this.app.workspace.getLeavesOfType(PROJECT_LIST_VIEW_TYPE);
			const leftLeaf = existingProjectListLeaves[0] ?? this.app.workspace.getLeftLeaf(false);
			if (leftLeaf) {
				await leftLeaf.setViewState({ type: PROJECT_LIST_VIEW_TYPE, state: {}, active: true });
			}

			// 步骤 3：同步驱动右侧侧边栏 (MessageHistoryView)
			const existingMessageHistoryLeaves = this.app.workspace.getLeavesOfType(MESSAGE_HISTORY_VIEW_TYPE);
			const rightLeaf = existingMessageHistoryLeaves[0] ?? this.app.workspace.getRightLeaf(false);
			if (rightLeaf) {
				await rightLeaf.setViewState({ type: MESSAGE_HISTORY_VIEW_TYPE, state: {}, active: true });
			}

			// 最后：确保中央 ChatView 被强行拉到用户视觉中心 (Reveal)
			this.app.workspace.revealLeaf(centerLeaf);
			this.isChatLayoutActive = true;
		} finally {
			this.isActivating = false;
		}
	}

	/**
	 * 退出聊天工作区，返回常规文档布局。
	 * 该方法将左侧恢复为 [文件浏览器]，右侧恢复为 [大纲]。
	 * 
	 * @param preferredLeaf 可选。如果传入，则优先将此叶片作为中央激活页。
	 */
	async activeDocumentView(preferredLeaf?: WorkspaceLeaf | null): Promise<void> {
		if (!this.isChatLayoutActive || this.isActivatingDocument) return;

		this.isActivatingDocument = true;
		try {
			// 预定义的默认视图状态
			const fallbackLeft: ViewState = { type: 'file-explorer', state: {}, active: false } as ViewState;
			const fallbackRight: ViewState = { type: 'outline', state: {}, active: false } as ViewState;

			// 恢复左侧侧边栏为 Obsidian 默认的文件树
			const existingFileExplorerLeaves = this.app.workspace.getLeavesOfType('file-explorer');
			const leftLeaf = existingFileExplorerLeaves[0] ?? this.app.workspace.getLeftLeaf(false);
			if (leftLeaf) {
				await leftLeaf.setViewState({ ...fallbackLeft, active: true });
			}

			// 恢复右侧侧边栏为大纲
			const existingOutlineLeaves = this.app.workspace.getLeavesOfType('outline');
			const rightLeaf = existingOutlineLeaves[0] ?? this.app.workspace.getRightLeaf(false);
			if (rightLeaf) {
				await rightLeaf.setViewState({ ...fallbackRight, active: true });
			}

			// 步骤：寻找一个合适的 Markdown 文档页片作为主焦点
			const existingMarkdownLeaves = this.app.workspace.getLeavesOfType('markdown');
			let centerLeaf: WorkspaceLeaf | null = null;

			// 如果用户是从某个 Markdown 标签页跳过来的，优先切回那个页片
			if (preferredLeaf && preferredLeaf.view?.getViewType() === 'markdown') {
				centerLeaf = preferredLeaf;
			}

			// 兜底方案 1：寻找当前正处于活动状态的 Markdown 叶片
			if (!centerLeaf && existingMarkdownLeaves.length > 0) {
				const activeLeaf = this.app.workspace.activeLeaf;
				if (activeLeaf && activeLeaf.view.getViewType() === 'markdown') {
					centerLeaf = activeLeaf;
				} else {
					centerLeaf = existingMarkdownLeaves[0];
				}
			}

			// 兜底方案 2：如果没有开着的文档，尝试找一个空标签页 (New tab)
			if (!centerLeaf) {
				centerLeaf = this.getNewTabLeaf();
			}

			// 兜底方案 3：如果彻底找不到文档页，则新开一个空的 Markdown 编辑器
			if (!centerLeaf) {
				centerLeaf = this.app.workspace.getLeaf(false);
				if (centerLeaf) {
					await centerLeaf.setViewState({ type: 'markdown', active: true });
				}
			} else {
				// 激活选中的文档叶片并将其置于中心
				const currentState = centerLeaf.getViewState();
				await centerLeaf.setViewState({ ...currentState, active: true });
				this.app.workspace.revealLeaf(centerLeaf);
			}

			this.isChatLayoutActive = false;
		} finally {
			this.isActivatingDocument = false;
		}
	}

}



