/**
 * ============================================================================
 * 文件说明: service-manager.ts - AI 服务管理器
 * ============================================================================
 * 
 * 【这个文件是干什么的】
 * 这个文件是整个聊天功能的"总指挥"，负责协调和管理所有与 AI 对话相关的服务。
 * 就像一个大型项目的项目经理，统筹管理对话存储、模型调用、提示词服务、
 * 上下文管理、用户画像等各个子服务。
 * 
 * 【起了什么作用】
 * 1. 服务编排: 初始化并协调所有聊天相关的子服务（存储、对话、项目、上下文等）
 * 2. 统一接口: 为外部提供统一的 API，隐藏内部复杂的服务依赖关系
 * 3. 配置管理: 管理 AI 服务的配置（模型选择、输出控制、存储路径等）
 * 4. 生命周期管理: 负责服务的初始化、更新和清理
 * 5. 消息处理: 处理用户消息、生成 AI 回复、管理会话流程
 * 
 * 【举例介绍】
 * 想象你在使用聊天功能时：
 * 
 * 1. 创建新对话：
 *    - AIServiceManager 创建一个新的 Conversation
 *    - ConversationService 负责具体的对话逻辑
 *    - ChatStorageService 将对话保存到文件
 *    - ProjectService 关联到对应的项目
 * 
 * 2. 发送消息：
 *    - 你输入消息后，AIServiceManager 接收
 *    - ContextBuilder 构建上下文（历史消息、附加资源等）
 *    - MultiProviderChatService 调用 AI 模型生成回复
 *    - ResourceSummaryService 处理附件摘要
 *    - UserProfileService 更新用户画像
 * 
 * 3. 管理项目：
 *    - ProjectService 管理不同的聊天项目
 *    - 每个项目可以包含多个对话
 *    - 项目可以有自己的上下文和资源索引
 * 
 * 【技术实现】
 * - 依赖注入模式：各个服务通过构造函数注入
 * - 延迟初始化：某些服务在 init() 方法中初始化，避免循环依赖
 * - 事件驱动：通过 EventBus 发布和订阅事件
 * - 配置合并：用户配置与默认配置合并
 * ============================================================================
 */

import { App } from 'obsidian';
import { ModelInfoForSwitch, LLMUsage, LLMOutputControlSettings, LLMStreamEvent, MessagePart } from '@/core/providers/types';
import { MultiProviderChatService } from '@/core/providers/MultiProviderChatService';
import { ChatStorageService } from '@/core/storage/vault/ChatStore';
import { ChatConversation, ChatMessage, ChatProject, ChatProjectMeta, StarredMessageRecord, ChatResourceRef, StreamingCallbacks, StreamType } from './types';
import { PromptService } from '@/service/prompt/PromptService';
import { PromptId, PromptVariables } from '@/service/prompt/PromptId';
import { ProjectService } from './service-project';
import { ConversationService } from './service-conversation';
import { AIServiceSettings, DEFAULT_AI_SERVICE_SETTINGS } from '@/app/settings/types';
import { ResourceSummaryService } from './context/ResourceSummaryService';
import { IndexService } from '@/service/search/index/indexService';
import { UserProfileService } from '@/service/chat/context/UserProfileService';
import { ContextUpdateService } from './context/ContextUpdateService';
import { EventBus } from '@/core/eventBus';
import { createChatMessage } from './utils/chat-message-builder';

/**
 * Manage AI conversations, storage, and model interactions.
 */
export class AIServiceManager {
	private storage: ChatStorageService;
	private multiChat: MultiProviderChatService;
	private promptService: PromptService;
	private projectService?: ProjectService;
	private conversationService?: ConversationService;
	private resourceSummaryService: ResourceSummaryService;
	private profileService?: UserProfileService;
	private contextUpdateService?: ContextUpdateService;

	constructor(
		private readonly app: App,
		private settings: AIServiceSettings
	) {
		// === 设置初始化 Settings initialization ===
		// 将用户传入的设置与默认设置合并
		// 例如：如果用户只配置了 rootFolder，其他设置项会使用默认值
		// Merge given settings with defaults
		this.settings = { ...DEFAULT_AI_SERVICE_SETTINGS, ...settings };

		// === 核心服务初始化 Core services initialization ===
		// 创建聊天数据存储服务
		// 这个服务负责将对话、消息、项目等数据保存到 Obsidian 的文件系统中
		// 例如：保存到 .obsidian/plugins/peak-assistant/chats/ 文件夹
		// Storage service for chat data
		this.storage = new ChatStorageService(this.app, {
			rootFolder: this.settings.rootFolder,
		});

		// === 资源摘要服务 Resource summary service ===
		// 创建资源摘要服务
		// 当用户在对话中引用文件、上传图片或提供链接时，这个服务会：
		// 1. 为每个资源创建一个摘要笔记（存储在 Resources/ 文件夹）
		// 2. 记录资源被哪些对话引用
		// 3. 维护资源和对话之间的双向链接关系
		// 例如：上传 diagram.png 后，会创建 Resources/Resource-abc123.md
		this.resourceSummaryService = new ResourceSummaryService(
			this.app,
			this.settings.rootFolder,
			this.settings.resourcesSummaryFolder
		);

		// === AI 服务构建 Service construction ===
		// 获取 LLM 提供商配置（OpenAI、Claude、Gemini 等）
		// 如果没有配置，使用空对象作为默认值
		// 例如：{ "openai": { apiKey: "sk-...", models: ["gpt-4"] } }
		const providerConfigs = this.settings.llmProviderConfigs ?? {};
		// 创建多提供商聊天服务
		// 这个服务是与 AI 模型通信的核心，支持多个 LLM 提供商
		// 它会根据配置自动选择合适的模型，并处理 API 调用
		this.multiChat = new MultiProviderChatService({
			providerConfigs,
			defaultOutputControl: this.settings.defaultOutputControl,
		});
		// 创建提示词服务
		// 这个服务管理所有的提示词模板（如对话系统提示、摘要生成模板等）
		// 它使用 Handlebars 模板引擎，可以动态渲染模板并调用 AI
		// Create prompt service
		this.promptService = new PromptService(this.app, this.settings, this.multiChat);

		// 如果启用了用户画像功能，初始化用户画像服务
		// 用户画像服务会记住用户的偏好、习惯、专业领域等信息
		// 例如：记住"用户是前端开发者，喜欢 TypeScript"
		// Initialize context service if profile is enabled
		if (this.settings.profileEnabled) {
			this.profileService = new UserProfileService(
				this.app,
				this.promptService,
				this.multiChat,
				// 用户画像文件的路径，默认为 Chats/User-Profile.md
				this.settings.profileFilePath || `${this.settings.rootFolder}/User-Profile.md`,
			);
		}

		// 注意：ProjectService 和 ConversationService 在 init() 方法中初始化
		// 这样做是为了避免与 DocumentLoaderManager 的循环依赖
		// DocumentLoaderManager 需要先初始化完成，才能加载文档和资源
		// Note: ProjectService and ConversationService are initialized in init() method
		// to avoid circular dependency with DocumentLoaderManager
	}

	/**
	 * Initialize storage resources and services that depend on DocumentLoaderManager.
	 * 初始化存储资源和依赖 DocumentLoaderManager 的服务
	 * 
	 * 这个方法在插件启动时调用，负责初始化所有延迟加载的服务
	 */
	async init(): Promise<void> {
		// 初始化存储服务
		// 这会创建必要的文件夹结构（如 Chats/、Projects/、Resources/ 等）
		await this.storage.init();
		// 初始化提示词服务
		// 这会确保 prompts 文件夹存在，并加载所有提示词模板
		await this.promptService.init();
		// 初始化资源摘要服务
		// 这会创建 Resources/ 文件夹，用于存储资源摘要笔记
		await this.resourceSummaryService.init();
		// 如果启用了用户画像功能，初始化用户画像服务
		// 这会创建或读取 User-Profile.md 文件
		if (this.profileService) {
			await this.profileService.init();
		}

		// 初始化项目级别和对话级别的服务
		// 这些服务需要在 DocumentLoaderManager 准备就绪后才能初始化
		// 因为它们依赖文档加载功能来处理文件引用和资源
		// Initialize Project- and conversation-level services after DocumentLoaderManager is ready
		// 创建项目服务
		// 项目服务负责管理聊天项目（可以把多个对话组织在一个项目下）
		// 例如："React 学习项目"下可以有多个对话
		this.projectService = new ProjectService(
			this.app,
			this.storage,
			this.settings.rootFolder,
			this.promptService,
			this.multiChat
		);
		// 创建对话服务
		// 对话服务是处理单个对话的核心，负责：
		// 1. 创建和管理对话
		// 2. 发送消息并生成 AI 回复
		// 3. 处理流式响应
		// 4. 管理对话上下文
		this.conversationService = new ConversationService(
			this.app,
			this.storage,
			this.multiChat,
			this.promptService,
			this.settings.defaultModel,
			this.resourceSummaryService,
			this,
			this.profileService,
			this.settings,
		);

		// 初始化摘要更新服务
		// 这个服务监听消息发送事件，自动更新对话和项目的摘要
		// 例如：每发送 5 条消息后，自动生成一个对话摘要
		// Initialize summary update service
		// 获取事件总线单例
		// 事件总线用于在不同服务之间传递事件（如消息发送、文件打开等）
		const eventBus = EventBus.getInstance(this.app);
		// 创建上下文更新服务
		// 这个服务会在后台自动维护对话摘要、用户画像等信息
		this.contextUpdateService = new ContextUpdateService(
			eventBus,
			this.storage,
			this.conversationService,
			this.projectService,
		);
	}

	/**
	 * 通过 ID 读取对话内容
	 * 
	 * 【功能说明】
	 * 根据对话 ID 从存储中读取对话数据
	 * 
	 * 【参数说明】
	 * @param conversationId - 对话的唯一标识符，例如："conv_abc123"
	 * @param loadMessages - 是否加载完整的消息历史
	 *                       - true: 加载所有消息（用于显示对话详情）
	 *                       - false: 仅加载元数据和上下文（用于列表显示，节省内存）
	 * 
	 * 【使用示例】
	 * // 读取完整对话（包含所有消息）
	 * const fullConv = await manager.readConversation('conv_123', true);
	 * // fullConv.messages = [{role: 'user', content: '你好'}, {role: 'assistant', content: '您好'}]
	 * 
	 * // 仅读取对话元数据（不加载消息，用于列表显示）
	 * const metaOnly = await manager.readConversation('conv_123', false);
	 * // metaOnly.messages = [] (空数组，节省内存)
	 * 
	 * Read a conversation by id.
	 * @param loadMessages If true, loads all messages; if false, only loads metadata and context.
	 */
	async readConversation(conversationId: string, loadMessages: boolean = true): Promise<ChatConversation | null> {
		// 委托给存储服务来读取对话数据
		// 存储服务会从 .obsidian/plugins/peak-assistant/chats/conv_xxx.md 文件中读取
		// 如果 loadMessages=false，只解析 frontmatter，不解析消息内容
		return this.storage.readConversation(conversationId, loadMessages);
	}

	/**
	 * 返回当前 AI 服务的设置快照
	 * 
	 * 【功能说明】
	 * 获取当前正在使用的 AI 服务配置
	 * 
	 * 【返回值说明】
	 * 包含所有配置项，例如：
	 * - rootFolder: 'Chats'（对话存储目录）
	 * - llmProviderConfigs: { openai: {...}, claude: {...} }（AI 提供商配置）
	 * - defaultModel: 'gpt-4'（默认使用的模型）
	 * 
	 * 【使用场景】
	 * 1. UI 组件需要显示当前配置
	 * 2. 其他服务需要读取配置参数
	 * 3. 保存配置前查看当前状态
	 * 
	 * Return current AI service settings snapshot.
	 */
	getSettings(): AIServiceSettings {
		// 直接返回当前的设置对象
		// 注意：这是引用传递，外部修改会影响内部状态
		// 如果需要防止外部修改，应该返回深拷贝
		return this.settings;
	}

	/**
	 * 获取多提供商聊天服务实例
	 * 
	 * 【功能说明】
	 * 返回用于与 AI 模型通信的核心服务
	 * 
	 * 【用途】
	 * 1. 发送聊天消息到 OpenAI、Claude、Gemini 等
	 * 2. 生成文本的向量嵌入（用于搜索）
	 * 3. 调用不同模型的特定功能
	 * 
	 * 【使用示例】
	 * const multiChat = manager.getMultiChat();
	 * // 生成文本的向量表示（用于语义搜索）
	 * const embedding = await multiChat.generateEmbedding('这是一段文本');
	 * // embedding = [0.123, -0.456, 0.789, ...] （1536维向量）
	 * 
	 * Get MultiProviderChatService instance for embedding generation.
	 */
	getMultiChat(): MultiProviderChatService {
		// 返回多提供商聊天服务的实例
		// 这个服务在构造函数中创建，整个生命周期中只有一个实例
		return this.multiChat;
	}

	/**
	 * 更新服务设置并重建存储处理器
	 * 
	 * 【功能说明】
	 * 当用户修改插件设置时调用，重新配置所有相关服务
	 * 
	 * 【参数说明】
	 * @param next - 新的设置对象（可以只包含部分字段）
	 * 
	 * 【执行流程】
	 * 1. 合并新旧设置
	 * 2. 重建存储服务（可能更改了存储路径）
	 * 3. 更新提示词服务配置
	 * 4. 刷新所有依赖服务
	 * 
	 * 【使用示例】
	 * // 用户在设置界面修改了 API Key
	 * manager.updateSettings({
	 *   llmProviderConfigs: {
	 *     openai: { apiKey: 'sk-new-key-123' }
	 *   }
	 * });
	 * // 这会触发所有服务重新初始化，使用新的 API Key
	 * 
	 * Update settings and rebuild storage handlers.
	 */
	updateSettings(next: AIServiceSettings): void {
		// 合并默认设置和新设置
		// 使用展开运算符确保默认值不会丢失
		// 例如：如果 next 只包含 apiKey，其他字段会从 DEFAULT_AI_SERVICE_SETTINGS 继承
		this.settings = { ...DEFAULT_AI_SERVICE_SETTINGS, ...next };
		
		// 重新创建存储服务
		// 这很重要，因为用户可能修改了 rootFolder（存储路径）
		// 例如：从 'Chats' 改为 'MyAIChats'
		this.storage = new ChatStorageService(this.app, {
			rootFolder: this.settings.rootFolder,
		});
		
		// 更新提示词服务的文件夹路径
		// 如果用户修改了 promptFolder，提示词服务需要从新路径加载模板
		this.promptService.setPromptFolder(this.settings.promptFolder);
		
		// 更新提示词服务的设置
		// 提示词服务可能需要其他设置项，如默认模型、温度参数等
		this.promptService.setSettings(this.settings);
		
		// 刷新所有依赖服务
		// 这会重新创建所有服务实例，确保它们使用最新的配置
		this.refreshDefaultServices();
	}

	/**
	 * 刷新所有默认服务
	 * 
	 * 【功能说明】
	 * 当设置更新时，重新创建所有服务实例以应用新配置
	 * 
	 * 【为什么需要这个方法】
	 * 服务创建时会读取配置并缓存，配置更改后需要重建才能生效
	 * 例如：用户修改了 API Key，需要重建 multiChat 服务才能使用新 Key
	 * 
	 * 【刷新的服务】
	 * 1. MultiProviderChatService（AI 提供商服务）
	 * 2. UserProfileService（用户画像服务）
	 * 3. ProjectService（项目管理服务）
	 * 4. ResourceSummaryService（资源摘要服务）
	 * 5. ConversationService（对话管理服务）
	 * 6. ContextUpdateService（上下文更新服务）
	 * 7. IndexService（索引服务）
	 */
	refreshDefaultServices(): void {
		// 获取 LLM 提供商配置（OpenAI、Claude、Gemini 等）
		// 如果没有配置，使用空对象作为默认值
		const providerConfigs = this.settings.llmProviderConfigs ?? {};
		
		// 刷新多提供商聊天服务
		// 这会清除现有的 API 连接并使用新配置重新创建
		// 例如：用户从 OpenAI 切换到 Claude，这里会销毁 OpenAI 连接并建立 Claude 连接
		// Refresh provider services with new configurations
		// This clears existing services and recreates them with updated configs
		this.multiChat.refresh(
			providerConfigs,  // 新的提供商配置
			this.settings.defaultOutputControl ?? DEFAULT_AI_SERVICE_SETTINGS.defaultOutputControl!  // 输出控制参数（如温度、top_p）
		);
		
		// 更新提示词服务中的聊天服务引用
		// 因为 multiChat 已经刷新，提示词服务需要使用新的实例
		this.promptService.setChatService(this.multiChat);

		// 如果启用了用户画像功能，重新初始化用户画像服务
		// 用户画像会记录用户的偏好、习惯等信息，用于个性化 AI 回复
		// 例如：记录"用户喜欢详细的代码示例"，AI 会自动提供更多示例
		// Reinitialize context service if profile is enabled
		if (this.settings.profileEnabled) {
			// 创建新的用户画像服务实例
			// profileFilePath 指定画像文件的位置，默认是 Chats/User-Profile.md
			this.profileService = new UserProfileService(
				this.app,                    // Obsidian App 实例
				this.promptService,          // 提示词服务（用于生成画像提示词）
				this.multiChat,              // 聊天服务（用于调用 AI）
				this.settings.profileFilePath || `${this.settings.rootFolder}/User-Profile.md`,  // 画像文件路径
			);
		}

		// 重新创建项目服务
		// 项目服务管理聊天项目，一个项目可以包含多个对话
		// 例如："React 学习"项目下有"Hooks"、"Redux"等多个对话
		this.projectService = new ProjectService(
			this.app,                    // Obsidian App 实例
			this.storage,                // 存储服务
			this.settings.rootFolder,    // 根文件夹路径
			this.promptService,          // 提示词服务
			this.multiChat               // 聊天服务
		);
		
		// 重新创建资源摘要服务
		// 这个服务为上传的文件（图片、PDF 等）生成摘要笔记
		// 例如：上传 diagram.png，会生成 Resources/Resource-abc123.md
		this.resourceSummaryService = new ResourceSummaryService(
			this.app,                                // Obsidian App 实例
			this.settings.rootFolder,                // 根文件夹路径
			this.settings.resourcesSummaryFolder     // 资源摘要文件夹（如 Resources/）
		);
		
		// 重新创建对话服务
		// 这是最核心的服务，负责处理用户与 AI 的对话
		// 包括：发送消息、接收回复、管理对话历史等
		this.conversationService = new ConversationService(
			this.app,                       // Obsidian App 实例
			this.storage,                   // 存储服务
			this.multiChat,                 // 聊天服务
			this.promptService,             // 提示词服务
			this.settings.defaultModel,     // 默认模型（如 'gpt-4'）
			this.resourceSummaryService,    // 资源摘要服务
			this,                           // AIServiceManager 自身（用于访问其他服务）
			this.profileService,            // 用户画像服务
			this.settings,                  // 所有设置
		);

		// 重新初始化摘要更新服务
		// 这个服务在后台自动维护对话摘要、项目摘要等
		// 例如：每发送 5 条消息，自动生成一次对话摘要
		// Reinitialize summary update service
		// 获取事件总线实例（全局单例）
		const eventBus = EventBus.getInstance(this.app);
		
		// 如果已存在旧的上下文更新服务，先清理掉
		// cleanup() 会取消所有事件监听，避免内存泄漏
		if (this.contextUpdateService) {
			this.contextUpdateService.cleanup();
		}
		
		// 创建新的上下文更新服务实例
		// 它会监听消息发送事件，自动触发摘要更新
		this.contextUpdateService = new ContextUpdateService(
			eventBus,                    // 事件总线
			this.storage,                // 存储服务
			this.conversationService,    // 对话服务
			this.projectService,         // 项目服务
		);

		// 更新索引服务
		// 索引服务用于全文搜索，需要知道最新的 AIServiceManager 实例
		// 这样它才能访问最新的存储路径、配置等
		// Update IndexService with updated AIServiceManager instance
		IndexService.getInstance().init(this);
	}

	/**
	 * 设置提示词文件夹路径
	 * 
	 * 【功能说明】
	 * 更改提示词模板的存储位置
	 * 
	 * 【参数说明】
	 * @param folder - 提示词文件夹路径，例如："Chats/Prompts"
	 * 
	 * 【使用场景】
	 * 用户在设置中修改了提示词文件夹位置后调用
	 * 例如：从默认的 "Chats/Prompts" 改为自定义的 "MyPrompts"
	 */
	setPromptFolder(folder: string): void {
		// 委托给提示词服务来更新文件夹路径
		// 提示词服务会从新路径重新加载所有模板文件
		this.promptService.setPromptFolder(folder);
	}

	/**
	 * 创建新的项目
	 * 
	 * 【功能说明】
	 * 在磁盘上创建一个新的聊天项目
	 * 项目可以用来组织多个相关的对话
	 * 
	 * 【参数说明】
	 * @param input - 项目元数据（不包括 id 和时间戳，系统自动生成）
	 *   - title: 项目标题，例如："React 学习项目"
	 *   - description: 项目描述（可选）
	 * 
	 * 【返回值】
	 * 返回完整的项目对象，包含系统生成的 id 和时间戳
	 * 
	 * 【使用示例】
	 * const project = await manager.createProject({
	 *   title: 'React 学习',
	 *   description: '学习 React Hooks 和 Redux'
	 * });
	 * // project.id = 'proj_abc123'
	 * // project.createdAtTimestamp = 1706140800000
	 * 
	 * Create a new project on disk.
	 */
	async createProject(input: Omit<ChatProjectMeta, 'id' | 'createdAtTimestamp' | 'updatedAtTimestamp'>): Promise<ChatProject> {
		// 检查项目服务是否已初始化
		// 项目服务在 init() 方法中创建，需要等待插件启动完成
		if (!this.projectService) {
			throw new Error('ProjectService not initialized. Call init() first.');
		}
		// 委托给项目服务来创建项目
		// 项目服务会：
		// 1. 生成唯一 ID（如 proj_abc123）
		// 2. 创建项目文件（Projects/proj_abc123.md）
		// 3. 保存元数据到 frontmatter
		return this.projectService.createProject(input);
	}

	/**
	 * 列出所有项目
	 * 
	 * 【功能说明】
	 * 获取用户创建的所有聊天项目
	 * 
	 * 【返回值】
	 * 项目数组，按创建时间排序
	 * 每个项目包含：id、标题、描述、创建/更新时间等
	 * 
	 * 【使用示例】
	 * const projects = await manager.listProjects();
	 * // [
	 * //   { id: 'proj_123', title: 'React 学习', ... },
	 * //   { id: 'proj_456', title: 'Python 开发', ... }
	 * // ]
	 * 
	 * List projects managed by the service.
	 */
	async listProjects(): Promise<ChatProject[]> {
		// 检查项目服务是否已初始化
		if (!this.projectService) {
			throw new Error('ProjectService not initialized. Call init() first.');
		}
		// 委托给项目服务来查询
		// 项目服务会：
		// 1. 扫描 Projects/ 文件夹
		// 2. 读取每个项目文件的 frontmatter
		// 3. 返回项目列表
		return this.projectService.listProjects();
	}

	/**
	 * 列出对话，可按项目筛选
	 * 
	 * 【功能说明】
	 * 获取对话列表，支持分页和项目筛选
	 * 
	 * 【参数说明】
	 * @param projectId - 项目 ID，用于筛选
	 *   - 传入项目 ID：只返回该项目下的对话
	 *   - 传入 null/undefined：返回所有对话
	 * @param limit - 每页数量（可选），例如：10 表示每次返回 10 条
	 * @param offset - 偏移量（可选），例如：20 表示跳过前 20 条
	 * 
	 * 【返回值】
	 * 对话数组，按创建时间降序排列（最新的在前）
	 * 
	 * 【使用示例】
	 * // 获取所有对话
	 * const allConvs = await manager.listConversations(null);
	 * 
	 * // 获取特定项目下的对话
	 * const projectConvs = await manager.listConversations('proj_123');
	 * 
	 * // 分页查询：第 3 页，每页 20 条
	 * const page3 = await manager.listConversations(null, 20, 40);
	 * 
	 * List conversations, optionally filtered by project.
	 * Supports pagination with limit and offset parameters.
	 */
	async listConversations(
		projectId: string | null | undefined,
		limit?: number,
		offset?: number
	): Promise<ChatConversation[]> {
		// 检查对话服务是否已初始化
		if (!this.conversationService) {
			throw new Error('ConversationService not initialized. Call init() first.');
		}
		// 委托给对话服务来查询
		// 对话服务会：
		// 1. 扫描 Chats/ 文件夹
		// 2. 读取每个对话的 frontmatter（不加载消息内容，提高性能）
		// 3. 按项目筛选并应用分页
		return this.conversationService.listConversations(projectId ?? null, limit, offset);
	}

	/**
	 * 统计对话数量
	 * 
	 * 【功能说明】
	 * 计算对话总数，可按项目筛选
	 * 
	 * 【参数说明】
	 * @param projectId - 项目 ID
	 *   - 传入项目 ID：统计该项目下的对话数
	 *   - 传入 null/undefined：统计所有对话数
	 * 
	 * 【返回值】
	 * 对话总数
	 * 
	 * 【使用示例】
	 * // 统计所有对话
	 * const total = await manager.countConversations(null);
	 * // total = 156
	 * 
	 * // 统计某个项目下的对话
	 * const projectTotal = await manager.countConversations('proj_123');
	 * // projectTotal = 23
	 * 
	 * Count conversations, optionally filtered by project.
	 */
	async countConversations(projectId: string | null | undefined): Promise<number> {
		// 检查对话服务是否已初始化
		if (!this.conversationService) {
			throw new Error('ConversationService not initialized. Call init() first.');
		}
		// 委托给对话服务来统计
		// 对话服务会扫描 Chats/ 文件夹并计数
		return this.conversationService.countConversations(projectId ?? null);
	}

	/**
	 * 创建新对话
	 * 
	 * 【功能说明】
	 * 创建一个新的聊天对话，可选择性添加初始消息
	 * 
	 * 【参数说明】
	 * @param params 
	 *   - title: 对话标题，例如："React Hooks 使用问题"
	 *   - project: 所属项目（可选），例如：{ id: 'proj_123', title: 'React 学习' }
	 *   - initialMessages: 初始消息（可选），例如：[{ role: 'user', content: '你好' }]
	 *   - modelId: 使用的模型 ID（可选），例如：'gpt-4'
	 *   - provider: AI 提供商（可选），例如：'openai'
	 * 
	 * 【返回值】
	 * 返回创建的对话对象，包含 ID、标题、消息等
	 * 
	 * 【使用示例】
	 * // 创建空白对话
	 * const conv1 = await manager.createConversation({
	 *   title: '新对话'
	 * });
	 * 
	 * // 创建带初始消息的对话
	 * const conv2 = await manager.createConversation({
	 *   title: 'React 咨询',
	 *   initialMessages: [
	 *     { role: 'user', content: '请介绍 React Hooks' }
	 *   ],
	 *   modelId: 'gpt-4'
	 * });
	 * 
	 * Create a new conversation with optional seed messages.
	 */
	async createConversation(params: { title: string; project?: ChatProjectMeta | null; initialMessages?: ChatMessage[]; modelId?: string; provider?: string }): Promise<ChatConversation> {
		// 检查对话服务是否已初始化
		if (!this.conversationService) {
			throw new Error('ConversationService not initialized. Call init() first.');
		}
		// 委托给对话服务来创建
		// 对话服务会：
		// 1. 生成唯一 ID（如 conv_abc123）
		// 2. 创建对话文件（Chats/conv_abc123.md）
		// 3. 写入 frontmatter（标题、项目、模型等元数据）
		// 4. 如果有初始消息，写入消息内容
		return this.conversationService.createConversation(params);
	}

	/**
	 * Create a conversation from AI search analysis results.
	 * Builds a comprehensive initial message with search query, summary, sources, and topics.
	 */
	async createConvFromSearchAIAnalysis(params: {
		query: string;
		summary: string;
		sources: Array<{ path: string; title: string; highlight?: { text?: string } | null }>;
		topics?: Array<{ label: string; weight: number }>;
	}): Promise<ChatConversation> {
		console.debug('[AIServiceManager] createConvFromSearchAIAnalysis called', {
			query: params.query,
			sourcesCount: params.sources.length,
			topicsCount: params.topics?.length ?? 0,
		});

		// Build title from query
		const title = params.query.trim() || 'AI Search Analysis';
		console.debug('[AIServiceManager] Conversation title:', title);

		// Build content with sources as markdown links for context
		const sourcesList = params.sources.slice(0, 10).map((s, i) => {
			const link = `[[${s.path}|${s.title}]]`;
			const snippet = s.highlight?.text ? `\n  - ${s.highlight.text.substring(0, 200)}...` : '';
			return `${i + 1}. ${link}${snippet}`;
		}).join('\n');

		const topicsList = params.topics && params.topics.length > 0
			? `\n\n**Key Topics:**\n${params.topics.map(t => `- ${t.label} (weight: ${t.weight})`).join('\n')}`
			: '';

		const content = `## Search Query
${params.query}

## Analysis Summary
${params.summary || 'No summary available.'}

## Top Sources (${params.sources.length} files)
${sourcesList}${topicsList}

---
*This conversation was created from an AI Search analysis. You can reference the sources above to continue the discussion.*`;

		console.debug('[AIServiceManager] Initial message content length:', content.length);

		// Get default model and timezone
		const defaultModel = this.settings.defaultModel;
		const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

		// Create initial message with search context
		const initialMessage = createChatMessage(
			'user',
			content,
			defaultModel.modelId,
			defaultModel.provider,
			timezone
		);

		console.debug('[AIServiceManager] Creating conversation with initial message', {
			messageId: initialMessage.id,
			model: defaultModel.modelId,
			provider: defaultModel.provider,
		});

		// Create conversation with initial message containing all search context
		const conversation = await this.createConversation({
			title,
			initialMessages: [initialMessage],
		});

		console.debug('[AIServiceManager] Conversation created successfully', {
			conversationId: conversation.meta.id,
			projectId: conversation.meta.projectId ?? null,
		});

		return conversation;
	}

	/**
	 * Send a message and wait for the full model response (blocking).
	 * Returns the assistant message and usage without persisting. Call addMessage to persist.
	 *
	 * @experimental This method is temporarily not supported. Use streamChat instead.
	 */
	async blockChat(params: {
		conversation: ChatConversation;
		project?: ChatProject | null;
		userContent: string;
		attachments?: string[];
	}): Promise<{ message: ChatMessage; usage?: LLMUsage }> {
		throw new Error('Unsupported operation. Use streamChat instead.');
	}

	/**
	 * Send a message and stream incremental model output.
	 */
	streamChat(params: {
		conversation: ChatConversation;
		project?: ChatProject | null;
		userContent: string;
		attachments?: string[];
	}): AsyncGenerator<LLMStreamEvent> {
		if (!this.conversationService) {
			throw new Error('ConversationService not initialized. Call init() first.');
		}
		return this.conversationService.streamChat(params);
	}

	/**
	 * Update conversation's active model.
	 */
	async updateConversationModel(params: {
		conversationId: string;
		modelId: string;
		provider: string;
	}): Promise<void> {
		if (!this.conversationService) {
			throw new Error('ConversationService not initialized. Call init() first.');
		}
		await this.conversationService.updateConversationModel(params);
	}

	/**
	 * Update conversation title and mark it as manually edited.
	 */
	async updateConversationTitle(params: {
		conversationId: string;
		title: string;
	}): Promise<void> {
		if (!this.conversationService) {
			throw new Error('ConversationService not initialized. Call init() first.');
		}
		await this.conversationService.updateConversationTitle(params);
	}

	/**
	 * Update conversation's attachment handling mode override.
	 */
	async updateConversationAttachmentHandling(params: {
		conversationId: string;
		attachmentHandlingOverride?: 'direct' | 'degrade_to_text';
	}): Promise<void> {
		if (!this.conversationService) {
			throw new Error('ConversationService not initialized. Call init() first.');
		}
		await this.conversationService.updateConversationAttachmentHandling(params);
	}

	/**
	 * Regenerate conversation title based on current messages and context.
	 */
	async regenerateConversationTitle(conversationId: string): Promise<void> {
		if (!this.conversationService) {
			throw new Error('ConversationService not initialized. Call init() first.');
		}

		// Load conversation with messages
		const conversation = await this.readConversation(conversationId, true);
		if (!conversation) {
			throw new Error(`Conversation not found: ${conversationId}`);
		}

		// Get project if exists
		const projects = await this.listProjects();
		const project = conversation.meta.projectId 
			? projects.find(p => p.meta.id === conversation.meta.projectId) || null
			: null;

		// Build context window for title generation
		const context = await this.conversationService.buildContextWindow(conversation.messages, project);

		// Generate new title based on messages and context
		const newTitle = await this.conversationService.generateConversationTitle(conversation.messages, context);

		if (!newTitle || newTitle.trim().length === 0) {
			return;
		}

		// Update title - preserve titleManuallyEdited status, but mark as auto-updated
		await this.conversationService.updateConversationTitle({
			conversationId: conversation.meta.id,
			title: newTitle.trim(),
			titleManuallyEdited: conversation.meta.titleManuallyEdited ?? false,
			titleAutoUpdated: true,
		});
	}

	/**
	 * Update conversation's output control override settings.
	 */
	async updateConversationOutputControl(params: {
		conversationId: string;
		outputControlOverride?: LLMOutputControlSettings;
	}): Promise<void> {
		if (!this.conversationService) {
			throw new Error('ConversationService not initialized. Call init() first.');
		}
		await this.conversationService.updateConversationOutputControl(params);
	}

	/**
	 * Upload files and create resource references.
	 * Uploads files to vault and creates resourceRef for each file.
	 */
	async uploadFilesAndCreateResources(files: File[]): Promise<ChatResourceRef[]> {
		if (!this.conversationService) {
			throw new Error('ConversationService not initialized. Call init() first.');
		}
		return this.conversationService.uploadFilesAndCreateResources(files);
	}

	/**
	 * Add a message to conversation and save it.
	 */
	async addMessage(params: {
		conversationId: string;
		message: ChatMessage;
		model: string;
		provider: string;
		usage: LLMUsage;
	}): Promise<void> {
		if (!this.conversationService) {
			throw new Error('ConversationService not initialized. Call init() first.');
		}
		this.conversationService.addMessage({
			conversationId: params.conversationId,
			message: params.message,
			model: params.model,
			provider: params.provider,
			usage: params.usage,
		});
	}


	/**
	 * Toggle star status on a message.
	 */
	async toggleStar(params: {
		messageId: string;
		conversationId: string;
		starred: boolean;
	}): Promise<void> {
		if (!this.conversationService) {
			throw new Error('ConversationService not initialized. Call init() first.');
		}
		return this.conversationService.toggleStar(params);
	}

	/**
	 * Load starred message records.
	 */
	async loadStarred(): Promise<StarredMessageRecord[]> {
		if (!this.conversationService) {
			throw new Error('ConversationService not initialized. Call init() first.');
		}
		return this.conversationService.loadStarred();
	}

	/**
	 * List starred messages for a project.
	 */
	async listStarredMessagesByProject(projectId: string): Promise<{
		messages: ChatMessage[];
		messageToConversationId: Map<string, string>;
	}> {
		if (!this.storage) {
			throw new Error('StorageService not initialized. Call init() first.');
		}
		return this.storage.listStarredMessagesByProject(projectId);
	}

	/**
	 * Rename a project by renaming its folder.
	 */
	async renameProject(projectId: string, newName: string): Promise<ChatProject> {
		if (!this.projectService) {
			throw new Error('ProjectService not initialized. Call init() first.');
		}
		return this.projectService.renameProject(projectId, newName);
	}

	/**
	 * Chat with a prompt template.
	 * Renders the prompt and calls the LLM with the rendered text.
	 */
	async chatWithPrompt<T extends PromptId>(
		promptId: T,
		variables: PromptVariables[T] | null,
		provider?: string,
		model?: string,
		extraParts?: MessagePart[]
	): Promise<string> {
		return this.promptService.chatWithPrompt(promptId, variables, provider, model, extraParts);
	}

	/**
	 * Stream chat with prompt using streaming callbacks.
	 * @param promptId - The prompt identifier
	 * @param variables - Variables for the prompt template
	 * @param callbacks - Streaming callbacks for handling progress
	 * @param streamType - Stream type identifier (default: 'content')
	 * @param provider - LLM provider name
	 * @param model - Model identifier
	 * @returns The complete LLM response content
	 */
	async chatWithPromptStream<T extends PromptId>(
		promptId: T,
		variables: PromptVariables[T] | null,
		callbacks: StreamingCallbacks,
		streamType: StreamType = 'content',
		provider?: string,
		model?: string
	): Promise<string> {
		return this.promptService.chatWithPromptStream(promptId, variables, callbacks, streamType, provider, model);
	}

	/**
	 * Search for external prompts using AI
	 * This is a placeholder implementation that should be replaced with actual AI-powered prompt search
	 */
	async searchPrompts(query: string): Promise<Array<{ id: string; label: string; description: string; value: string; icon: string; showArrow: boolean }>> {
		// TODO: Implement actual AI-powered prompt search
		// This could involve:
		// 1. Searching through prompt templates
		// 2. Using embeddings to find similar prompts
		// 3. Querying external prompt databases
		// 4. Using LLM to generate relevant prompts based on query

		// For now, return empty array as placeholder
		console.debug('[AIServiceManager] searchPrompts called with query:', query);
		return [];
	}

	/**
	 * Get all available models from all configured providers
	 * Only returns models from enabled providers and enabled models
	 */
	async getAllAvailableModels(): Promise<ModelInfoForSwitch[]> {
		const allModels = await this.multiChat.getAllAvailableModels();
		const providerConfigs = this.settings.llmProviderConfigs ?? {};

		// Filter models by provider and model enabled status
		return allModels
			.filter(model => {
				const providerConfig = providerConfigs[model.provider];

				// Skip if provider is not enabled
				if (providerConfig?.enabled !== true) {
					return false;
				}

				// Check model enabled status
				// If modelConfigs doesn't exist or model is not in modelConfigs, default to enabled
				const modelConfigs = providerConfig.modelConfigs;
				if (!modelConfigs) {
					return true; // Default enabled if no modelConfigs
				}

				const modelConfig = modelConfigs[model.id];
				// If model is explicitly configured, check its enabled status
				// If not configured, default to enabled
				return modelConfig?.enabled === true;
			})
			.map(m => ({
					id: m.id,
					displayName: m.displayName,
					provider: m.provider,
					icon: m.icon,
				capabilities: m.capabilities, // Pass through capabilities from provider
			}));
	}

	async getModelInfo(modelId: string, provider: string): Promise<ModelInfoForSwitch | undefined> {
		const allModels = await this.getAllAvailableModels();
		return allModels.find(m => m.id === modelId && m.provider === provider);
	}

}

