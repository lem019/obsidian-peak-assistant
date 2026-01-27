/**
 * @file ai-sdk-adapter.ts
 * @description AI SDK 适配层。
 * 
 * 本文件起到了“翻译官”的作用。它将插件自定义的 `LLMRequest` 数据结构
 * 转换为 Vercel AI SDK (npm: ai) 所能理解的格式，并统一处理生成结果。
 * 
 * 为什么需要这一层？
 * 1. 【解耦】屏蔽不同 AI SDK 版本间的差异。
 * 2. 【标准化】确保所有 Provider（OpenAI, Claude 等）在处理输出控制（温度、Token数）、工具调用和流式解析时逻辑一致。
 * 3. 【健壮性】集中处理流式传输中的异常，确保不论哪个环节出错，都能返回统一格式的错误事件。
 * 
 * 主要功能：
 * 1. `blockChat`: 执行同步阻塞对话，等待模型生成完整结果后返回。
 * 2. `streamChat`: 执行异步流式对话，将模型的输出拆分为：文本增量(text-delta)、思维图元(reasoning-delta)、工具调用等事件。
 */

import {
    LanguageModel,
    streamText,
    generateText,
    ModelMessage,
} from 'ai';
import { LLMRequest, LLMResponse, LLMStreamEvent, LLMResponseSource, MessagePart, LLMRequestMessage } from '../types';

/**
 * 【内部工具】将 LLMRequest 转换为 AI SDK 调用参数
 * 
 * 这里完成了从插件配置到 SDK 参数的映射：
 * - 提取 System Prompt（系统消息）
 * - 转换消息历史格式 (toAiSdkMessages)
 * - 映射采样参数（Temperature, TopP, MaxTokens 等）
 * - 绑定中断信号 (AbortSignal)，用于前端取消生成
 */
function buildAiSdkParams(model: LanguageModel, request: LLMRequest<any>) {
    return {
        model,
        // 提取系统提示词
        system: extractSystemMessage(request),
        // 转换上下文消息列表
        prompt: toAiSdkMessages(request.messages),
        // 核心输出控制参数
        maxOutputTokens: request.outputControl?.maxOutputTokens,
        temperature: request.outputControl?.temperature,
        topP: request.outputControl?.topP,
        topK: request.outputControl?.topK,
        frequencyPenalty: request.outputControl?.frequencyPenalty,
        presencePenalty: request.outputControl?.presencePenalty,
        // 超时设置：支持总时长和单步时长
        timeout: request.outputControl?.timeoutTotalMs || request.outputControl?.timeoutStepMs ? {
            totalMs: request.outputControl?.timeoutTotalMs,
            stepMs: request.outputControl?.timeoutStepMs,
        } : undefined,
        // 支持用户手动点击“停止生成”按钮
        abortSignal: request.abortSignal,
        // 工具调用设置
        toolChoice: request.toolChoice ?? 'auto',
        tools: request.tools,
    };
}

/**
 * 执行阻塞式对话
 * 模型完全生成完毕后才返回结果。适用于较短的文本生成或后台任务。
 */
export async function blockChat(
    model: LanguageModel,
    request: LLMRequest<any>
): Promise<LLMResponse> {
    try {
        const result = await generateText(buildAiSdkParams(model, request));
        // 将 SDK 返回的结果包装成插件内部的响应结构
        return {
            content: result.content,
            text: result.text,
            reasoning: result.reasoning,
            reasoningText: result.reasoningText,
            files: result.files,
            sources: result.sources,
            toolCalls: result.toolCalls,
            toolResults: result.toolResults,
            finishReason: result.finishReason,
            usage: result.usage,
            totalUsage: result.totalUsage,
            warnings: result.warnings,
            request: result.request,
            response: result.response,
            steps: result.steps,
            providerMetadata: result.providerMetadata,
        };
    } catch (error) {
        console.error('[ai-sdk-adapter] Block chat error:', error);
        throw error;
    }
}

/**
 * 执行流式对话（异步生成器）
 * 将 SDK 返回的原始流解析为一个个具体的业务事件，允许前端逐字渲染。
 * 
 * 核心逻辑：
 * 遍历 `fullStream`，通过 switch-case 将各种类型的 chunk 转换为标准的 `LLMStreamEvent`。
 */
export async function* streamChat(
    model: LanguageModel,
    request: LLMRequest<any>
): AsyncGenerator<LLMStreamEvent> {
    const startTime = Date.now();
    try {
        const result = streamText(buildAiSdkParams(model, request));

        for await (const chunk of result.fullStream) {
            console.debug('[ai-sdk-adapter] Chunk:', chunk);
            switch (chunk.type) {
                case 'text-delta':
                    // 输出正文文本增量
                    yield { type: 'text-delta', text: chunk.text };
                    break;
                case 'reasoning-delta':
                    // 输出思维链过程增量（通常用于深色背景显示或折叠显示）
                    yield { type: 'reasoning-delta', text: chunk.text };
                    break;
                case 'source':
                    // 输出参考资料来源（常见于联网搜索模型）
                    yield chunk as LLMResponseSource;
                    break;
                case 'tool-call':
                    // 模型决定调用某个工具
                    yield {
                        type: 'tool-call',
                        toolName: chunk.toolName,
                        input: chunk.input
                    };
                    break;
                case 'tool-input-start':
                    yield {
                        type: 'tool-input-start',
                        toolName: chunk.toolName,
                    };
                    break;
                case 'tool-input-delta':
                    yield { type: 'tool-input-delta', delta: chunk.delta };
                    break;
                case 'tool-result':
                    // 工具执行完毕的结果回显
                    yield {
                        type: 'tool-result',
                        toolName: chunk.toolName,
                        input: chunk.input,
                        output: chunk.output
                    };
                    break;
                case 'finish-step': {
                    // 一个步骤（如工具链调用）结束
                    yield {
                        type: 'on-step-finish',
                        text: '',
                        finishReason: chunk.finishReason,
                        usage: chunk.usage
                    };
                    break;
                }
                case 'finish': {
                    // 整个对话生成过程最终完成
                    yield {
                        type: 'complete',
                        usage: chunk.totalUsage
                    };
                    break;
                }
                case 'error': {
                    console.error('[ai-sdk-adapter] Stream chat chunk error:', chunk.error);
                    yield {
                        type: 'error',
                        error: chunk.error instanceof Error ? chunk.error : new Error(String(chunk.error))
                    };
                    break;
                }
                default:
                    // 兜底处理未识别的事件类型
                    yield { type: 'unSupported', chunk: chunk };
                    break;
            }
        }

        // 最后发送一次完整的 usage 信息和总耗时
        const finalUsage = await result.usage;
        yield { type: 'complete', usage: finalUsage, durationMs: Date.now() - startTime };
    } catch (error) {
        console.error('[ai-sdk-adapter] Stream chat exception error:', error);
        yield { type: 'error', error: error as Error, durationMs: Date.now() - startTime };
    }
}


/**
 * Map MessagePart to AI SDK message content parts.
 * AI SDK supports text, image, file, reasoning, tool-call, and tool-result content parts.
 */
function mapContentPartToAiSdk(part: MessagePart): Array<
    | { type: 'text'; text: string }
    | { type: 'image'; image: string }
    | { type: 'file'; url: string; mediaType: string; filename?: string }
    | { type: 'reasoning'; text: string }
    | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
    | { type: 'tool-result'; toolCallId: string; toolName: string; output: unknown }
> {
    switch (part.type) {
        case 'text':
            return [{ type: 'text', text: part.text }];
        case 'image': {
            // Convert data to appropriate format for AI SDK
            let imageUrl: string;
            if (typeof part.data === 'string') {
                // If it's already a string, assume it's a URL or data URL
                imageUrl = part.data;
            } else {
                // Convert binary data to data URL
                const base64 = Buffer.from(part.data as any).toString('base64');
                imageUrl = `data:${part.mediaType};base64,${base64}`;
            }
            return [{ type: 'image', image: imageUrl }];
        }
        case 'file': {
            // Convert data to appropriate format for AI SDK
            let fileUrl: string;
            if (typeof part.data === 'string') {
                // If it's already a string, assume it's a URL
                fileUrl = part.data;
            } else {
                // Convert binary data to data URL
                const base64 = Buffer.from(part.data as any).toString('base64');
                fileUrl = `data:${part.mediaType};base64,${base64}`;
            }
            return [{
                type: 'file',
                url: fileUrl,
                mediaType: part.mediaType,
                filename: part.filename
            }];
        }
        case 'reasoning':
            return [{ type: 'reasoning', text: part.text }];
        case 'tool-call':
            // Generate a tool call ID if not provided
            const toolCallId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            return [{
                type: 'tool-call',
                toolCallId,
                toolName: part.toolName,
                input: part.input
            }];
        case 'tool-result':
            return [{
                type: 'tool-result',
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                output: part.output
            }];
        default:
            return [{ type: 'text', text: '' }];
    }
}

/**
 * Convert LLMRequestMessage to AI SDK CoreMessage format.
 * Handles system, user, and assistant roles.
 * System messages are extracted separately and should be passed via the 'system' parameter.
 */
export function toAiSdkMessages(messages: LLMRequestMessage[]): ModelMessage[] {
    const aiSdkMessages: ModelMessage[] = [];

    for (const message of messages) {
        // Skip system messages - they should be handled via extractSystemMessage
        if (message.role === 'system') {
            continue;
        }

        // Map content parts for user/assistant messages
        const contentParts = message.content.flatMap(mapContentPartToAiSdk);

        // Ensure at least one text part exists
        if (contentParts.length === 0) {
            contentParts.push({ type: 'text', text: '' });
        }

        // Convert to AI SDK message format
        aiSdkMessages.push({
            role: message.role,
            content: contentParts,
        } as ModelMessage);
    }

    return aiSdkMessages;
}

/**
 * Extract system message text from LLMRequestMessage array.
 * Returns concatenated system message text or undefined if none.
 */
export function extractSystemMessage(request: LLMRequest<any>): string | undefined {
    if (request.system) {
        return request.system;
    }

    // parse from messages
    const messages = request.messages;
    const systemParts: string[] = [];
    for (const message of messages) {
        if (message.role !== 'system') {
            continue;
        }

        for (const part of message.content) {
            if (part.type === 'text') {
                systemParts.push(part.text);
            }
        }
    }
    return systemParts.length > 0 ? systemParts.join('\n\n') : undefined;
}