import { IconName, ItemView, TFolder, WorkspaceLeaf } from 'obsidian';
import { useChatViewStore } from './chat-view/store/chatViewStore';
import { ReactRenderer } from '@/ui/react/ReactRenderer';
import { ChatViewComponent } from './chat-view/ChatViewComponent';
import { createReactElementWithServices } from '@/ui/react/ReactElementFactory';
import { AppContext } from '@/app/context/AppContext';

/**
 * ============================================================================
 * 文件说明: ChatView.ts - 聊天视图入口
 * ============================================================================
 * 
 * 【这个文件是干什么的】
 * 这个文件是插件聊天界面的“大门”。由于 Obsidian 本身不是用 React 写的，
 * 它是用原生的 DOM 元素管理的，所以我们需要这个文件来充当一个“翻译官”。
 * 它负责告诉 Obsidian：“嘿，在侧边栏给我开一个窗口，我要在里面画 React 界面了”。
 * 
 * 【起了什么作用】
 * 1. 视图注册：定义了聊天窗口在 Obsidian 里的身份标识（CHAT_VIEW_TYPE）。
 * 2. 生命周期管理：负责窗口打开（onOpen）和关闭（onClose）时的资源初始化和清理。
 * 3. React 挂载：把 React 编写的聊天组件（ChatViewComponent）真正地“塞入”Obsidain 的 DOM 节点里。
 * 4. 界面设置：定义了聊天窗口显示的名称（Peak Chat）和图标（message-circle）。
 * 
 * 【举例介绍】
 * 当用户在 Obsidian 侧边栏点击那个“聊天”小图标时：
 * 1. Obsidian 会调用这个类的构造函数创建一个 ChatView 实例。
 * 2. 紧接着调用 onOpen 方法，这里会清空容器，腾出地方。
 * 3. 然后 render 方法被触发，React 引擎启动，所有的聊天记录、输入框就都显示出来了。
 * 
 * 【技术实现】
 * - 继承自 ItemView: Obsidian 官方提供的基础视图类。
 * - ReactRenderer: 一个自定义工具类，负责调用 React 的 createRoot 进行渲染。
 * - createReactElementWithServices: 一个工厂方法，自动给 React 组件注入所有的后台服务。
 * ============================================================================
 */
import { IconName, ItemView, TFolder, WorkspaceLeaf } from 'obsidian';
import { useChatViewStore } from './chat-view/store/chatViewStore';
import { ReactRenderer } from '@/ui/react/ReactRenderer';
import { ChatViewComponent } from './chat-view/ChatViewComponent';
import { createReactElementWithServices } from '@/ui/react/ReactElementFactory';
import { AppContext } from '@/app/context/AppContext';

// ============================================================================
// 通用常量定义：聊天视图的唯一 ID，Obsidian 通过这个 ID 来找我们
// ============================================================================
export const CHAT_VIEW_TYPE = 'peak-chat-view';

// ============================================================================
// 类定义：主要的视图逻辑类
// ============================================================================
export class ChatView extends ItemView {
	// React 渲染器实例：负责 React 组件的渲染、热更新和销毁
	private reactRenderer: ReactRenderer | null = null;

	/**
	 * 构造函数
	 * @param leaf - Obsidian 分配给这个视图的“叶子”（可以理解为选项卡或侧边栏槽位）
	 * @param appContext - 全局应用上下文，里面装着各种服务实例
	 */
	constructor(
		leaf: WorkspaceLeaf,
		private readonly appContext: AppContext
	) {
		super(leaf);
		// 注意：具体的初始化逻辑都在 onOpen 中，构造函数只负责基础赋值
	}

	// 告诉 Obsidian 这个视图属于哪一类
	getViewType(): string {
		return CHAT_VIEW_TYPE;
	}

	// 侧边栏图标悬停时显示的文字
	getDisplayText(): string {
		return 'Peak Chat';
	}

	// 侧边栏显示的图标样式（来自 Obsidian 官方图标库）
	getIcon(): IconName {
		return 'message-circle';
	}

	// ============================================================================
	// 生命周期：视图打开时的逻辑
	// ============================================================================
	async onOpen(): Promise<void> {
		// 1. 清空容器：Obsidian 默认会往里面放点东西，我们要先把它清空
		this.containerEl.empty();
		// 2. 添加类名：方便通过 CSS 给整个窗口加样式
		this.containerEl.addClass('peak-chat-view');

		// 3. 初始化 React 渲染器：把 Obsidian 的 containerEl（DOM 节点）作为 React 的根节点
		this.reactRenderer = new ReactRenderer(this.containerEl);

		// 4. 初次渲染：稍微延迟一点（requestAnimationFrame），确保 DOM 已经完全就绪
		requestAnimationFrame(() => {
			this.render();
		});
	}

	// ============================================================================
	// 生命周期：视图关闭时的逻辑
	// ============================================================================
	async onClose(): Promise<void> {
		// 1. 卸载 React：通知 React 停止工作，释放内存，防止内存泄漏
		if (this.reactRenderer) {
			this.reactRenderer.unmount();
			this.reactRenderer = null;
		}

		// 2. 清空容器内容
		this.containerEl.empty();
	}

	// ============================================================================
	// 渲染函数：真正把组件画出来的地方
	// ============================================================================
	private render(): void {
		// 安全检查
		if (!this.reactRenderer) return;

		// 使用专门的工厂方法创建 React 元素
		// 它会自动把 AIServiceManager、EventBus 等服务包装在 Provider 里
		// 这样 ChatViewComponent 及其所有子组件都能在内部直接用 useServiceContext() 拿到服务
		this.reactRenderer.render(
			createReactElementWithServices(
				ChatViewComponent,  // 我们真正的 React 聊天主界面组件
				{ },                // 传递给组件的 Props（目前为空，因为服务都通过 Context 传了）
				this.appContext     // 包含所有服务的上下文对象
			)
		);
	}


}
