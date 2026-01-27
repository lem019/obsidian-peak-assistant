/**
 * ============================================================================
 * 文件说明: AISearchAgent.ts - AI 搜索代理
 * ============================================================================
 * 
 * 【这个文件是干什么的】
 * 这个文件实现了一个智能的 AI 搜索代理（Agent），它就像一个聪明的助手，
 * 可以理解用户的搜索需求，自动选择合适的工具（阅读内容、搜索笔记、网络搜索等），
 * 并返回综合的搜索结果。
 * 
 * 【起了什么作用】
 * 1. RAG 增强搜索: 结合检索（Retrieval）和生成（Generation），提供更智能的搜索体验
 * 2. 工具编排: 根据用户需求自动选择和调用不同的工具（本地搜索、网络搜索、内容阅读）
 * 3. 流式输出: 支持流式返回搜索结果，用户可以实时看到搜索进度
 * 4. 系统提示词: 为 AI 提供上下文信息（如当前时间、系统信息），让回答更准确
 * 
 * 【举例介绍】
 * 想象你问 AI："我上周关于项目管理的笔记在哪里？"
 * 
 * AI Search Agent 的工作流程：
 * 1. 理解你的需求：需要搜索本地笔记，关键词是"项目管理"，时间范围是"上周"
 * 2. 选择工具：决定使用 vault_inspector（本地搜索工具）
 * 3. 调用工具：在你的笔记库中搜索相关内容
 * 4. 整合结果：将搜索结果整合成自然语言回复，并提供笔记链接
 * 5. 流式返回：逐步显示搜索结果，而不是等所有内容都准备好才显示
 * 
 * 另一个例子：如果你问"TypeScript 的最新特性是什么？"
 * Agent 会识别出这需要网络搜索（因为本地可能没有最新信息），
 * 自动调用 web_search 工具去搜索网络内容。
 * 
 * 【技术实现】
 * - 基于 Vercel AI SDK 的 Agent 框架
 * - 支持多种工具（Tool）的动态加载和调用
 * - 使用 AsyncGenerator 实现流式输出
 * - 与 PromptService 集成，使用模板化的系统提示词
 * ============================================================================
 */

import { LLMStreamEvent } from '@/core/providers/types';
import { contentReaderTool } from '../tools/content-reader';
import { vaultGraphInspectorTool } from '../tools/search-graph-inspector';
import { localWebSearchTool } from '../tools/search-web';
import { LanguageModel, Experimental_Agent as Agent, ToolSet } from 'ai';
import { genSystemInfo } from '../tools/system-info';
import { PromptService } from '../prompt/PromptService';
import { PromptId } from '../prompt/PromptId';

/**
 * AI 搜索代理的配置选项
 */
export interface AISearchAgentOptions {
    enableWebSearch?: boolean;    // 是否启用网络搜索工具
    enableLocalSearch?: boolean;  // 是否启用本地搜索工具（搜索笔记库）
}

// export interface SearchResult {
//     path: string;
//     title: string;
//     excerpt?: string;
//     score?: number;
// }

// export interface NoteConnection {
//     backlinks: string[];
//     outlinks: string[];
// }

// export interface VaultStats {
//     totalNotes: number;
//     latestNote?: {
//         path: string;
//         modified: Date;
//     };
// }

/**
 * RAG Agent for Assistant
 * RAG (Retrieval-Augmented Generation) 代理类
 * 
 * 这个类封装了 AI 搜索代理的核心功能，负责：
 * 1. 管理可用的工具集（content_reader, web_search, vault_inspector）
 * 2. 与大语言模型交互，处理用户的搜索请求
 * 3. 提供流式和阻塞两种搜索模式
 */
export class AISearchAgent {
    private agent: Agent<ToolSet>; // Vercel AI SDK 的 Agent 实例

    /**
     * 构造函数：初始化 AI 搜索代理
     * 
     * @param model - 大语言模型实例（如 GPT-4、Claude 等）
     * @param options - 配置选项（决定启用哪些工具）
     * @param promptService - 提示词服务，用于生成系统提示词
     * 
     * 工作流程：
     * 1. 创建基础工具集（默认包含 content_reader）
     * 2. 根据配置动态添加可选工具（web_search, vault_inspector）
     * 3. 初始化 Agent 实例，绑定工具集
     */
    constructor(
        model: LanguageModel,
        options: AISearchAgentOptions,
        private promptService: PromptService
    ) {
        // 创建工具集：content_reader 是基础工具，用于读取文件内容
        let tools: ToolSet = {
            content_reader: contentReaderTool(),
        }
        
        // 如果启用了网络搜索，添加 web_search 工具
        if (options.enableWebSearch) {
            tools.web_search = localWebSearchTool();
        }
        
        // 如果启用了本地搜索，添加 vault_inspector 工具
        // vault_inspector 可以搜索笔记库、遍历图谱、查找关键节点等
        if (options.enableLocalSearch) {
            tools.vault_inspector = vaultGraphInspectorTool();
        }

        // 创建 Agent 实例
        this.agent = new Agent<ToolSet>({
            model,
            // stream and block will override the system prompt
            // 注意：stream 和 block 方法会覆盖这里的 system 提示词
            // system: await this.getSystemPrompt(),
            tools,
        });
    }

    /**
     * world view
     * 获取系统提示词（世界观）
     * 
     * 系统提示词告诉 AI 它处于什么环境中，有哪些能力，当前是什么时间等。
     * 这就像给 AI 设定一个"世界观"，让它知道自己的身份和能力边界。
     * 
     * @returns 格式化后的系统提示词字符串
     */
    private async getSystemPrompt(): Promise<string> {
        // 获取系统信息（如当前时间、笔记库信息等）
        const systemInfo = await genSystemInfo();
        // 使用模板渲染系统提示词
        return this.promptService.render(PromptId.AiSearchSystem, systemInfo);
    }

    /**
     * Stream search results
     * 流式搜索方法（推荐使用）
     * 
     * 这个方法会实时返回搜索结果，用户可以边搜索边看到内容，体验更好。
     * 就像水龙头流水一样，一点一点地返回结果，而不是等所有结果都准备好才返回。
     * 
     * @param prompt - 用户的搜索查询（例如："查找关于React的笔记"）
     * @returns 异步生成器，持续产出搜索事件（文本片段、工具调用、推理过程等）
     * 
     * 事件类型：
     * - text-delta: 返回的文本片段（AI 的回答内容）
     * - reasoning-delta: AI 的推理过程（如果模型支持）
     * - tool-call: AI 决定调用某个工具
     * - tool-result: 工具调用的结果
     */
    async stream(prompt: string): Promise<AsyncGenerator<LLMStreamEvent>> {
        // 调用 Agent 的 stream 方法，开始流式生成
        const result = this.agent.stream({
            system: await this.getSystemPrompt(), // 设置系统提示词
            prompt, // 用户的查询
        });

        // 返回一个异步生成器函数，逐个产出事件
        // 这是一个立即执行的异步生成器函数（IIFE）
        return (async function* (): AsyncGenerator<LLMStreamEvent> {
            // 遍历 Agent 返回的完整流
            for await (const chunk of result.fullStream) {
                // 根据不同的事件类型，转换为标准的 LLMStreamEvent
                switch (chunk.type) {
                    case 'text-delta':
                        // 文本片段：AI 生成的回答内容的一部分
                        yield { type: 'text-delta', text: chunk.text };
                        break;
                    case 'reasoning-delta':
                        // 推理片段：AI 的思考过程（某些模型支持）
                        yield { type: 'reasoning-delta', text: chunk.text };
                        break;
                    case 'tool-call':
                        // 工具调用：AI 决定调用某个工具（如搜索、读取文件等）
                        yield { type: 'tool-call', toolName: chunk.toolName, input: chunk.input };
                        break;
                    case 'tool-result':
                        // 工具结果：工具执行完毕，返回结果
                        yield { type: 'tool-result', toolName: chunk.toolName, input: chunk.input, output: chunk.output };
                        break;
                }
            }
        })();
    }

    /**
     * Block search execution
     * 阻塞式搜索方法
     * 
     * 这个方法会等待所有搜索完成后，一次性返回最终结果。
     * 适用于不需要实时反馈的场景，或者需要完整结果才能继续处理的情况。
     * 
     * @param prompt - 用户的搜索查询
     * @returns 完整的搜索结果文本
     * 
     * 使用场景：
     * - 批处理任务
     * - 需要完整结果才能进行后续处理
     * - 不需要实时反馈的情况
     */
    async block(prompt: string): Promise<string> {
        // 调用 Agent 的 generate 方法，等待完整结果
        const result = await this.agent.generate({
            system: await this.getSystemPrompt(), // 设置系统提示词
            prompt, // 用户的查询
        });
        // 返回生成的文本结果
        return result.text;
    }

}