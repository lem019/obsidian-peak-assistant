/**
 * ============================================================================
 * 文件说明: service-project.ts - 项目服务
 * ============================================================================
 * 
 * 【这个文件是干什么的】
 * 这个文件负责管理聊天项目（Chat Project），一个项目可以包含多个相关的对话。
 * 就像一个文件夹，帮你组织和管理同一个主题下的多个对话。
 * 
 * 【起了什么作用】
 * 1. 项目管理: 创建、列出、删除聊天项目
 * 2. 项目摘要: 自动生成项目级别的摘要，汇总所有对话的内容
 * 3. 资源组织: 管理项目级别的共享资源和上下文
 * 4. 文件夹映射: 为每个项目创建独立的文件夹存储对话
 * 
 * 【举例介绍】
 * 假设你正在使用 AI 助手帮你完成一个软件项目：
 * 
 * 1. 创建项目：
 *    createProject({ name: "电商网站开发" })
 *    - 创建项目文件夹：/chats/电商网站开发-20260124/
 *    - 生成项目元数据
 * 
 * 2. 在项目下创建多个对话：
 *    - "需求分析对话"：讨论功能需求
 *    - "技术选型对话"：选择技术栈
 *    - "架构设计对话"：设计系统架构
 *    - "代码实现对话"：具体编码问题
 * 
 * 3. 项目摘要：
 *    summarizeProject(project)
 *    - 汇总所有对话的内容
 *    - 生成项目的短摘要和完整摘要
 *    - 帮你快速了解项目进展
 * 
 * 【使用场景】
 * - 长期项目：需要多次对话，按主题组织
 * - 主题研究：围绕一个主题的多个讨论
 * - 工作流程：将工作拆分成多个对话，统一管理
 * 
 * 【技术实现】
 * - 项目与对话是一对多关系
 * - 使用文件夹结构组织项目数据
 * - 项目摘要通过 LLM 自动生成
 * ============================================================================
 */

import { App } from 'obsidian';
import { generateUuidWithoutHyphens } from '@/core/utils/id-utils';
import { ChatProject, ChatProjectMeta } from './types';
import { ChatStorageService } from '@/core/storage/vault/ChatStore';
import { DEFAULT_SUMMARY } from '@/core/constant';
import { PromptService } from '@/service/prompt/PromptService';
import { PromptId } from '@/service/prompt/PromptId';
import type { LLMProviderService } from '@/core/providers/types';

/**
 * Service for managing chat projects.
 */
export class ProjectService {
	constructor(
		private readonly app: App,
		private readonly storage: ChatStorageService,
		private readonly rootFolder: string,
		private readonly promptService?: PromptService,
		private readonly chat?: LLMProviderService,
	) {}

	/**
	 * Create a new project on disk.
	 */
	async createProject(input: Partial<ChatProjectMeta>): Promise<ChatProject> {
		const timestamp = Date.now();
		const projectId = generateUuidWithoutHyphens();
		const name = input.name || `New`;
		const folderPath = this.storage.buildProjectFolderRelPath(
			name,
			timestamp,
			projectId,
			input.folderPath
		);
		const project: ChatProjectMeta = {
			id: projectId,
			createdAtTimestamp: timestamp,
			updatedAtTimestamp: timestamp,
			name: name,
			folderPath: folderPath,
		};
		return await this.storage.saveProject(project);
	}

	/**
	 * List all projects managed by the service.
	 */
	async listProjects(): Promise<ChatProject[]> {
		return this.storage.listProjects();
	}

	/**
	 * Summarize a project by aggregating summaries from all conversations in the project.
	 */
	async summarizeProject(project: ChatProject): Promise<string> {
		if (!this.chat) {
			console.warn('[ProjectService] No LLM service available for project summary');
			return DEFAULT_SUMMARY;
		}

		try {
			// Get all conversations in this project
			const conversations = await this.storage.listConversations(project.meta.id);
			
			// Build conversations array with summaries
			const conversationsArray = conversations.map((conv) => ({
				title: conv.meta.title,
				shortSummary: conv.context?.shortSummary,
				fullSummary: conv.context?.fullSummary,
			}));

			// Build resources array if available
			const resourcesArray = project.context?.resourceIndex?.map((r) => ({
				title: r.title || r.id,
				source: r.source,
				shortSummary: r.shortSummary,
			})) || [];

			// Generate short summary
			if (!this.promptService) {
				return DEFAULT_SUMMARY;
			}
			const shortSummary = await this.promptService.chatWithPrompt(
				PromptId.ProjectSummaryShort,
				{
					conversations: conversationsArray,
					resources: resourcesArray.length > 0 ? resourcesArray : undefined,
				},
			) || DEFAULT_SUMMARY;

			// Generate full summary if project has multiple conversations
			if (conversations.length > 1) {
				const fullSummary = await this.promptService.chatWithPrompt(
					PromptId.ProjectSummaryFull,
					{
						conversations: conversationsArray,
						resources: resourcesArray.length > 0 ? resourcesArray : undefined,
						shortSummary,
					},
				);
				return fullSummary || shortSummary;
			}

			return shortSummary;
		} catch (error) {
			console.warn('[ProjectService] Failed to generate project summary:', error);
			return DEFAULT_SUMMARY;
		}
	}

	/**
	 * Rename a project by renaming its folder.
	 */
	async renameProject(projectId: string, newName: string): Promise<ChatProject> {
		const project = await this.storage.readProject(projectId);
		if (!project) {
			throw new Error('Project not found');
		}

		// Rename folder and get new relative path
		const newFolderPath = await this.storage.renameProjectFolder(projectId, newName);

		// Update project meta with new folder path and name
		const updatedMeta: ChatProjectMeta = {
			...project.meta,
			name: newName,
			folderPath: newFolderPath,
			updatedAtTimestamp: Date.now(),
		};

		// Save updated project meta
		return await this.storage.saveProject(updatedMeta, project.context);
	}
}

