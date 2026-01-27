/**
 * @file types.ts
 * @description LLM 提供商类型定义核心文件。
 * 本文件定义了整个插件 AI 能力的基础数据结构。它起到了“协议”的作用，
 * 确保不论是 OpenAI、Claude 还是本地的 Ollama，都能以统一的格式进行配置、调用和界面展示。
 * 
 * 主要职责：
 * 1. 【配置层】定义了 ProviderConfig，用于存储 API Key、Base URL 等敏感信息和自定义选项。
 * 2. 【能力层】定义了 ModelCapabilities，描述模型是否支持 视觉(Vision)、PDF、联网搜索等高级功能。
 * 3. 【展示层】定义了 ModelMetaData，包含用于 UI 显示的图标 ID（兼容 lobe-chat 图标规范）、名称和价格信息。
 * 
 * 举例：
 * 当你需要新增一个 AI 提供商时，你需要确保其返回的 metadata 符合这里的接口规范，
 * 这样插件的设置面板和聊天视图才能正确渲染出该供应商的图标。
 */

import { LanguageModelUsage, FinishReason, CallWarning, LanguageModelRequestMetadata, LanguageModelResponseMetadata, ProviderMetadata, StepResult, GeneratedFile, ContentPart, ReasoningOutput, LanguageModel } from 'ai';

/**
 * 提供商配置接口
 * 存储用户在设置面板输入的各项参数。
 */
export interface ProviderConfig {
	/** 是否启用该服务 */
	enabled?: boolean;
	/** 访问凭证 */
	apiKey?: string;
	/** 代理地址或私有化部署地址 */
	baseUrl?: string;
	/** 模型级别的细颗粒度配置，如：哪些模型在列表中可见 */
	modelConfigs?: Record<string, ModelConfig>;
	/**
	 * 特定提供商自定义选项。
	 * 采用键值对形式存储不通用的额外参数。
	 * @example
	 * // 对于 OpenRouter:
	 * { referer: 'https://example.com', title: 'My App' }
	 * // 对于 Claude:
	 * { maxOutputTokens: 2048 }
	 */
	extra?: Record<string, any>;
}

/**
 * 具体的模型开关配置
 */
export interface ModelConfig {
	/** 模型 ID (例如 'gpt-4o') */
	id: string;
	/** 是否在 UI 中隐藏该模型 */
	enabled?: boolean;
}

/**
 * 模型用途类型
 */
export enum ModelType {
	/** 文本大语言模型 */
	LLM = 'llm',
	/** 向量嵌入模型 */
	EMBEDDING = 'embedding',
	/** 图像生成模型 */
	IMAGE = 'image',
	/** 视频生成模型 */
	VIDEO = 'video',
	/** 语音相关模型 */
	SOUND = 'sound',
}

/**
 * 提供商元数据
 * 用于设置页面和品牌展示。
 */
export interface ProviderMetaData {
	/** 内部唯一标识 (如 'openai') */
	id: string;
	/** 显示名称 (如 'OpenAI') */
	name: string;
	/** 默认的 API 终结点 */
	defaultBaseUrl: string;
	/**
	 * 图标标识符，对接 @lobehub/icons。
	 * 该字符串会被直接传递给 ProviderIcon 组件。
	 * 每个 Provider 的 getProviderMetadata() 方法应决定该值。
	 */
	icon?: string;
}

/**
 * 模型元数据
 * 描述一个具体模型（如 GPT-4）的所有公开信息和技术指标。
 */
export interface ModelMetaData {
	/** 原始 ID */
	id: string;
	/** 用户界面显示的友好名称 */
	displayName: string;
	/** 模型主类型 */
	modelType?: ModelType;
	/**
	 * 模型图标标识符，对接 @lobehub/icons 的 ModelIcon。
	 * 允许 UI 为不同版本的模型显示特定图标（如 GPT-4 vs GPT-3.5）。
	 */
	icon?: string;
	/** 发布时间戳，用于排序或显示“New”标记 */
	releaseTimestamp?: number;
	/** 输入价格（通常为每百万 token 的价格） */
	costInput?: string;
	/** 输出价格 */
	costOutput?: string;
	/**
	 * 模型核心能力集
	 * 用于 UI 根据能力显示或隐藏特定的功能按钮（如拍照上传、文件分析）。
	 */
	capabilities?: ModelCapabilities;
}

/**
 * 带提供商上下文的模型信息。
 * 这是一个视图对象 (VO)，将模型元数据与它所属的提供商 ID 结合。
 * 广泛用于在切换模型下拉框时提供上下文。
 */
export type ModelInfoForSwitch = ModelMetaData & {
	/** 所属提供商的 ID (如 'ollama') */
	provider: string;
};

/**
 * 带启用状态的模型设置信息。
 * 用于设置面板，让用户逐个勾选哪些模型需要出现在聊天选项中。
 */
export type ModelInfoForSettings = ModelMetaData & {
	enabled: boolean;
};

/**
 * 模型能力标志位
 * 这些布尔值决定了插件逻辑中“能否执行某项操作”。
 */
export interface ModelCapabilities {
	/** 是否支持视觉识别（多模态图片输入） */
	vision: boolean;
	/** 是否支持作为文档直接上传 PDF（通过 API 直接解析） */
	pdfInput: boolean;
	/** 是否支持函数调用（Tools/Function Calling） */
	tools: boolean;
	/** 是否原生支持联网搜索 */
	webSearch: boolean;
	/** xAI Grok 专用：X (Twitter) 实时搜索 */
	xSearch?: boolean;
	/** xAI Grok 专用：新闻搜索 */
	newsSearch?: boolean;
	/** xAI Grok 专用：RSS 订阅搜索 */
	rssSearch?: boolean;
	/** 代码解释器支持（Sandbox 环境执行 Python 等） */
	codeInterpreter?: boolean;
	/** 直接通过聊天生成图片 */
	imageGeneration?: boolean;
	/** 是否支持逻辑推理过程展示（如 OpenAI o1 系列） */
	reasoning?: boolean;
	/** 最大上下文窗口 (Tokens)，用于显示 128K, 1M 等标签 */
	maxCtx?: number;
}

/**
 * 解析并标准化模型能力。
 * 该函数确保能力对象中始终包含完整的布尔值，即使后端返回的是部分缺失的。
 */
export function resolveModelCapabilities(model?: { capabilities?: ModelCapabilities }): ModelCapabilities {
	if (model?.capabilities) {
		return {
			vision: model.capabilities.vision ?? false,
			pdfInput: model.capabilities.pdfInput ?? false,
			tools: model.capabilities.tools ?? false,
			webSearch: model.capabilities.webSearch ?? false,
			xSearch: model.capabilities.xSearch ?? false,
			newsSearch: model.capabilities.newsSearch ?? false,
			rssSearch: model.capabilities.rssSearch ?? false,
			codeInterpreter: model.capabilities.codeInterpreter ?? false,
			imageGeneration: model.capabilities.imageGeneration ?? false,
			reasoning: model.capabilities.reasoning ?? false,
			maxCtx: model.capabilities.maxCtx,
		};
	}

	// Return default capabilities if not provided
	// Providers should define capabilities in their getAvailableModels() method
	return {
		vision: false,
		pdfInput: false,
		tools: false,
		webSearch: false,
		xSearch: false,
		newsSearch: false,
		rssSearch: false,
		codeInterpreter: false,
		imageGeneration: false,
		reasoning: false,
		maxCtx: undefined,
	};
}

export interface LLMProviderService {
	blockChat(request: LLMRequest<any>): Promise<LLMResponse>;
	streamChat(request: LLMRequest<any>): AsyncGenerator<LLMStreamEvent>;
	/**
	 * Get provider ID
	 */
	getProviderId(): string;
	/**
	 * Get model client for this provider
	 */
	modelClient(model: string): LanguageModel;
	/**
	 * Get list of available models for this provider
	 * Returns empty array if models cannot be fetched or provider doesn't support listing
	 */
	getAvailableModels(): Promise<ModelMetaData[]>;
	/**
	 * Get provider metadata (name and default baseUrl)
	 */
	getProviderMetadata(): ProviderMetaData;
	/**
	 * Generate embeddings for texts.
	 * @param texts - Array of texts to generate embeddings for
	 * @param model - Model identifier for embedding generation
	 * @returns Promise resolving to array of embedding vectors (each is an array of numbers)
	 */
	generateEmbeddings(texts: string[], model: string): Promise<number[][]>;
}

export type LLMRequest<TOOLS extends any = any> = {
	provider: string;
	model: string;
	system?: string;
	messages: LLMRequestMessage[];
	/**
	 * LLM output control settings.
	 * If not provided, uses model defaults or model config settings.
	 */
	outputControl?: LLMOutputControlSettings;
	abortSignal?: AbortSignal;
	toolChoice?: 'auto' | 'none' | 'required' | {
		type: 'tool';
		toolName: string;
	};
	tools?: {
		[key: string]: TOOLS;
	};
};

export type ChatRole = 'user' | 'assistant' | 'system';

export interface LLMRequestMessage {
	role: ChatRole;
	content: MessagePart[];
}

/**
Data content. Can either be a base64-encoded string, a Uint8Array, an ArrayBuffer, or a Buffer.
 */
type DataContent = string | Uint8Array | ArrayBuffer | Buffer;

/**
 * inspire by ai-sdk's ModelMessage.
 * use for both request and response.
 */
export type MessagePart =
	| {
		type: 'text';
		text: string;
	}
	| {
		type: 'image';
		data: DataContent | URL;
		/**
		 * @see https://www.iana.org/assignments/media-types/media-types.xhtml
		 */
		mediaType: string;
	}
	| {
		type: 'file';
		data: DataContent | URL;
		/**
		 * @see https://www.iana.org/assignments/media-types/media-types.xhtml
		 */
		mediaType: string;
		filename?: string;
	}
	// maybe only assistant message. -- or system message.
	// we need to persist the process text. so we define the type here.
	| {
		type: 'reasoning';
		text: string;
	}
	| {
		type: 'tool-call';
		toolName: string;
		input: any;
		providerExecuted?: boolean;
	}
	| {
		type: 'tool-result';
		toolCallId: string;
		toolName: string;
		output: any;
	}
	;

export type LLMUsage = LanguageModelUsage;

export type LLMStreamEvent =
	// from AI-SDK StreamTextOnChunkCallback types
	{ type: 'text-delta'; text: string; } |
	{ type: 'reasoning-delta'; text: string; } |
	({ type: 'source'; } | LLMResponseSource) |
	{ type: 'tool-call'; toolName: string; input?: any; } |
	{ type: 'tool-input-start'; toolName: string; } |
	{ type: 'tool-input-delta'; delta: string; } |
	{ type: 'tool-result'; toolName: string; input?: any; output?: any; } |
	// from project usage
	{ type: 'on-step-finish'; text: string, finishReason: FinishReason, usage: LLMUsage } |
	{ type: 'complete'; usage: LLMUsage, durationMs?: number } |
	{ type: 'error'; error: Error, durationMs?: number } |
	{ type: 'unSupported'; chunk: any }
	;

export enum ToolEvent {
	BUILD_CONTEXT_MESSAGES = 'build-context-messages',
	LOAD_SYSTEM_PROMPT = 'load-system-prompt',
	LOAD_USER_PROFILE = 'load-user-profile',
	BUILD_CONTEXT_MEMORY = 'build-context-memory',
	PROCESS_MESSAGES = 'process-messages',
	CONVERT_IMAGE = 'convert-image',
	COMPLETE = 'complete',
	COLLECT_RECENT_MESSAGES = "COLLECT_RECENT_MESSAGES",
	GENERATE_SUMMARY = "GENERATE_SUMMARY",
}

/**
 * for some built in process stage. like summary image and pdf. use multiple chat access. we need returen the stage by tool-call.
 * export type ProgressStage =
	| 'image_upload'
	| 'image_summary'
	| 'pdf_upload'
	| 'pdf_parse'
	| 'resource_summary'
	| 'tools_enable'
	| 'codeinterpreter_enable';

 */

/**
 * Copy from AI SDK's GenerateTextResult & StreamTextResult
 */
export type LLMResponse = {
	/**
	 * The content that was generated in the last step.
	 */
	content: Array<ContentPart<any>>;
	/**
	 * The text that was generated in the last step.
	 */
	text: string;
	/**
	 * The full reasoning that the model has generated in the last step.
	 */
	reasoning: Array<ReasoningOutput>;
	/**
	 * The reasoning text that the model has generated in the last step. Can be undefined if the model
	 * has only generated text.
	 */
	reasoningText: string | undefined;
	/**
	 * The files that were generated in the last step.
	 * Empty array if no files were generated.
	 */
	files: Array<GeneratedFile>;
	/**
	 * Sources that have been used as references in the last step.
	 */
	sources: Array<LLMResponseSource>;
	/**
	 * The tool calls that were made in the last step.
	 */
	toolCalls: Array<any>;
	/**
	 * The results of the tool calls from the last step.
	 */
	toolResults: Array<any>;
	/**
	 * The reason why the generation finished.
	 */
	finishReason: FinishReason;
	/**
	 * The token usage of the last step.
	 */
	usage: LanguageModelUsage;
	/**
	 * The total token usage of all steps.
	 * When there are multiple steps, the usage is the sum of all step usages.
	 */
	totalUsage: LanguageModelUsage;
	/**
	 * Warnings from the model provider (e.g. unsupported settings)
	 */
	warnings: CallWarning[] | undefined;
	/**
	 * Additional request information.
	 */
	request: LanguageModelRequestMetadata;
	/**
	 * Additional response information.
	 */
	response: LanguageModelResponseMetadata & {
		/**
		 * The response messages that were generated during the call. It consists of an assistant message,
		 * potentially containing tool calls.
		 *
		 * When there are tool results, there is an additional tool message with the tool results that are available.
		 * If there are tools that do not have execute functions, they are not included in the tool results and
		 * need to be added separately.
		 */
		messages: Array<any>;
		/**
		 * Response body (available only for providers that use HTTP requests).
		 */
		body?: unknown;
	};
	/**
	 * Additional provider-specific metadata. They are passed through
	 * from the provider to the AI SDK and enable provider-specific
	 * results that can be fully encapsulated in the provider.
	 */
	providerMetadata: ProviderMetadata | undefined;
	/**
	 * Details for all steps.
	 * You can use this to get information about intermediate steps,
	 * such as the tool calls or the response headers.
	 */
	steps: Array<StepResult<any>>;
};

/**
 * LLM output control settings.
 * These settings control the generation behavior of language models.
 */
export interface LLMOutputControlSettings {
	/**
	 * Temperature setting (0-2).
	 * Higher values make the output more random.
	 * Default: undefined (uses model default)
	 */
	temperature?: number;
	/**
	 * Top-p (nucleus sampling) setting (0-1).
	 * Controls diversity via nucleus sampling.
	 * Default: undefined (uses model default)
	 */
	topP?: number;
	/**
	 * Top-k setting.
	 * Limits the number of top tokens to consider.
	 * Default: undefined (uses model default)
	 */
	topK?: number;
	/**
	 * Presence penalty (-2 to 2).
	 * Penalizes new tokens based on whether they appear in the text so far.
	 * Default: undefined (uses model default)
	 */
	presencePenalty?: number;
	/**
	 * Frequency penalty (-2 to 2).
	 * Penalizes new tokens based on their frequency in the text so far.
	 * Default: undefined (uses model default)
	 */
	frequencyPenalty?: number;
	/**
	 * Max output tokens.
	 * Maximum number of tokens to generate.
	 * Default: undefined (uses model default)
	 */
	maxOutputTokens?: number;
	/**
	 * Reasoning effort setting.
	 * Controls how much reasoning/thinking the model should do.
	 * Options: 'none', 'low', 'medium', 'high'
	 * Default: undefined (uses model default)
	 */
	reasoningEffort?: string;
	/**
	 * Text verbosity setting.
	 * Controls the level of detail in output text.
	 * Options: 'low', 'medium', 'high'
	 * Default: undefined (uses model default)
	 */
	textVerbosity?: string;
	/**
	 * Total timeout for the entire LLM call including all steps.
	 * In milliseconds. Default: undefined (no timeout)
	 */
	timeoutTotalMs?: number;
	/**
	 * Timeout for each individual step (LLM call).
	 * In milliseconds. Default: undefined (no timeout)
	 */
	timeoutStepMs?: number;
}

/**
 * All keys of LLMOutputControlSettings for runtime access
 */
export const LLM_OUTPUT_CONTROL_SETTING_KEYS = {
	temperature: 'temperature',
	topP: 'topP',
	topK: 'topK',
	presencePenalty: 'presencePenalty',
	frequencyPenalty: 'frequencyPenalty',
	maxOutputTokens: 'maxOutputTokens',
	reasoningEffort: 'reasoningEffort',
	textVerbosity: 'textVerbosity',
	timeoutTotalMs: 'timeoutTotalMs',
	timeoutStepMs: 'timeoutStepMs',
} as const;

/**
 * Get all LLMOutputControlSettings keys as an array
 */
export function getLLMOutputControlSettingKeys(): (keyof LLMOutputControlSettings)[] {
	return Object.keys(LLM_OUTPUT_CONTROL_SETTING_KEYS) as (keyof LLMOutputControlSettings)[];
}

/**
 * Copy from AI SDK's Source: LanguageModelV3Source
 */
export type LLMResponseSource = {
	type: 'source';
	/**
	 * The type of source - URL sources reference web content.
	 */
	sourceType: 'url';
	/**
	 * The ID of the source.
	 */
	id: string;
	/**
	 * The URL of the source.
	 */
	url: string;
	/**
	 * The title of the source.
	 */
	title?: string;
	/**
	 * Additional provider metadata for the source.
	 */
	providerMetadata?: Record<string, any>;
} | {
	type: 'source';
	/**
	 * The type of source - document sources reference files/documents.
	 */
	sourceType: 'document';
	/**
	 * The ID of the source.
	 */
	id: string;
	/**
	 * IANA media type of the document (e.g., 'application/pdf').
	 */
	mediaType: string;
	/**
	 * The title of the document.
	 */
	title: string;
	/**
	 * Optional filename of the document.
	 */
	filename?: string;
	/**
	 * Additional provider metadata for the source.
	 */
	providerMetadata?: Record<string, any>;
};