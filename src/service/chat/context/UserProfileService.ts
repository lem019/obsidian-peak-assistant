/**
 * ============================================================================
 * 文件说明: UserProfileService.ts - 用户画像服务
 * ============================================================================
 * 
 * 【这个文件是干什么的】
 * 这个文件实现了"用户画像"功能，让 AI 能够记住你的偏好、习惯、专业领域等个人信息，
 * 从而提供更个性化、更符合你需求的回答。
 * 
 * 【起了什么作用】
 * 1. 自动提取：从对话中自动提取关于你的信息（事实、偏好、习惯等）
 * 2. 智能分类：将信息分类存储（专业领域、工具偏好、沟通风格等 10 个类别）
 * 3. 置信度评分：AI 会给每条信息打分（0-1），低置信度的信息会被过滤
 * 4. 持续更新：随着对话积累，用户画像会不断更新和完善
 * 5. 上下文注入：在每次对话时，AI 会自动读取你的画像，提供更贴合你的回答
 * 
 * 【举例介绍】
 * 场景 1：AI 记住你的专业背景
 * - 你：我是一名前端开发者，主要用 React 和 TypeScript
 * - AI 提取信息：
 *   - category: "expertise-area"（专业领域）
 *   - text: "用户是前端开发者，擅长 React 和 TypeScript"
 *   - confidence: 0.9（高置信度）
 * - 下次你问"如何优化性能"时，AI 会自动针对 React 给出建议
 * 
 * 场景 2：AI 记住你的偏好
 * - 你：我喜欢简洁的代码风格，不喜欢过度封装
 * - AI 提取信息：
 *   - category: "preference"（偏好）
 *   - text: "用户偏好简洁代码，避免过度封装"
 *   - confidence: 0.85
 * - 之后 AI 生成代码时会遵循你的风格偏好
 * 
 * 场景 3：AI 记住你的工作模式
 * - 你：我通常在早上整理笔记，下午写代码
 * - AI 提取信息：
 *   - category: "work-pattern"（工作模式）
 *   - text: "用户早上整理笔记，下午编码"
 *   - confidence: 0.75
 * - 当你问"现在做什么合适"时，AI 会参考时间给出建议
 * 
 * 【10 个信息分类】
 * 1. fact（事实）：客观信息，如职业、所在地等
 * 2. preference（偏好）：喜好和厌恶
 * 3. decision（决策）：你做过的重要决定
 * 4. habit（习惯）：日常习惯和行为模式
 * 5. communication-style（沟通风格）：你喜欢的交流方式
 * 6. work-pattern（工作模式）：工作习惯和时间安排
 * 7. tool-preference（工具偏好）：喜欢使用的工具和技术
 * 8. expertise-area（专业领域）：你擅长的领域和技能
 * 9. response-style（回复风格）：你希望 AI 如何回答
 * 10. other（其他）：无法归类的信息
 * 
 * 【技术实现】
 * - 使用 LLM 从对话中提取候选信息（JSON 格式）
 * - 置信度阈值过滤（默认 >= 0.7）
 * - 存储在专门的 Markdown 文件中（带 Frontmatter）
 * - 支持批量更新和增量添加
 * ============================================================================
 */

import { App, TFile } from 'obsidian';
import { PromptService } from '@/service/prompt/PromptService';
import { PromptId } from '@/service/prompt/PromptId';
import type { LLMProviderService } from '@/core/providers/types';
import { ensureFolder } from '@/core/utils/vault-utils';
import { USER_PROFILE_MIN_CONFIDENCE_THRESHOLD } from '@/core/constant';

/**
 * User profile category constants.
 * 用户画像的有效分类常量（10 种）
 */
export const USER_PROFILE_VALID_CATEGORIES = [
	'fact',
	'preference',
	'decision',
	'habit',
	'communication-style',
	'work-pattern',
	'tool-preference',
	'expertise-area',
	'response-style',
	'other',
] as const;

/**
 * Valid category types for user profile items.
 */
export type UserProfileCategory = typeof USER_PROFILE_VALID_CATEGORIES[number];

/**
 * User profile item.
 * All user profile information (memories, preferences, profile) uses this structure.
 */
export interface UserProfileItem {
	text: string;
	category: UserProfileCategory;
	confidence?: number;
}

/**
 * Service for managing user profile.
 */
export class UserProfileService {
	constructor(
		private readonly app: App,
		private readonly promptService: PromptService,
		private readonly chat: LLMProviderService,
		private readonly contextFilePath: string,
	) {}

	/**
	 * Initialize context service and ensure file exists.
	 */
	async init(): Promise<void> {
		const folderPath = this.contextFilePath.substring(0, this.contextFilePath.lastIndexOf('/'));
		if (folderPath) {
			await ensureFolder(this.app, folderPath);
		}
		const file = this.app.vault.getAbstractFileByPath(this.contextFilePath);
		if (!(file instanceof TFile)) {
			await this.app.vault.create(this.contextFilePath, '# User Context\n\n- (No context items yet)\n');
		}
	}

	/**
	 * Extract context candidates from a conversation exchange or other sources.
	 */
	async extractCandidates(params: {
		userMessage: string;
		assistantReply: string;
		context?: Record<string, string>;
	}): Promise<UserProfileItem[]> {
		try {
			const content = await this.promptService.chatWithPrompt(
				PromptId.MemoryExtractCandidatesJson,
				{
					userMessage: params.userMessage,
					assistantReply: params.assistantReply,
					context: params.context || {},
				},
			);

			// Parse JSON response
			const rawCandidates: any[] = JSON.parse(content.trim());

			// Validate candidates
			const validatedCandidates: UserProfileItem[] = rawCandidates
				.filter((c): c is UserProfileItem => {
					// Must have text
					if (!c || typeof c.text !== 'string' || !c.text.trim()) {
						return false;
					}
					// Validate category
					if (!c.category || typeof c.category !== 'string' || !USER_PROFILE_VALID_CATEGORIES.includes(c.category as UserProfileCategory)) {
						return false;
					}
					// Validate confidence if provided
					if (c.confidence !== undefined && (typeof c.confidence !== 'number' || c.confidence < 0 || c.confidence > 1)) {
						return false;
					}
					return true;
				})
				.map((c) => ({
					text: c.text.trim(),
					category: c.category as UserProfileCategory,
					confidence: c.confidence,
				}))
				// Filter by confidence threshold if provided
				.filter((c) => !c.confidence || c.confidence >= USER_PROFILE_MIN_CONFIDENCE_THRESHOLD);

			return validatedCandidates;
		} catch (error) {
			console.warn('[UserProfileService] Failed to extract context candidates:', error);
			return [];
		}
	}

	/**
	 * Update context list with new items.
	 */
	async updateProfile(params: {
		newItems: UserProfileItem[];
	}): Promise<UserProfileItem[]> {
		try {
			// Load existing context
			const existingContext = await this.loadContext();

			// Convert new items to statements for prompt
			const newStatements = params.newItems.map(item => item.text).join('\n');

			// Convert Map to flat array of texts for prompt
			const existingMemories = Array.from(existingContext.values()).flat();

			// Render update prompt and call LLM
			const content = await this.promptService.chatWithPrompt(
				PromptId.MemoryUpdateBulletList,
				{
					newStatement: newStatements,
					existingMemories,
				},
			);

			// Parse bullet list from response
			const updatedTexts = this.parseBulletList(content);
			
			// Reconstruct items (preserve category from new items)
			const updatedItems: UserProfileItem[] = updatedTexts.map(text => {
				// Try to find matching item from new items to preserve category
				const matchingNewItem = params.newItems.find(item => text.includes(item.text) || item.text.includes(text));
				return {
					text,
					category: matchingNewItem?.category || 'other', // Use 'other' as fallback if no matching item found
				};
			});

			// Save updated context
			await this.saveContext(updatedItems);

			return updatedItems;
		} catch (error) {
			console.warn('[UserProfileService] Failed to update context:', error);
			return await this.loadContextItems();
		}
	}

	/**
	 * Load existing context items from file, grouped by category.
	 */
	async loadContext(): Promise<Map<UserProfileCategory, string[]>> {
		const items = await this.loadContextItems();
		const map = new Map<UserProfileCategory, string[]>();
		
		for (const item of items) {
			const texts = map.get(item.category) || [];
			texts.push(item.text);
			map.set(item.category, texts);
		}
		
		return map;
	}

	/**
	 * Load existing context items from file as UserProfileItem[].
	 */
	private async loadContextItems(): Promise<UserProfileItem[]> {
		const file = this.app.vault.getAbstractFileByPath(this.contextFilePath);
		if (!(file instanceof TFile)) {
			return [];
		}

		try {
			const content = await this.app.vault.read(file);
			// Try to parse as JSON first (structured format)
			const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || content.match(/\[[\s\S]*\]/);
			if (jsonMatch) {
				try {
					const rawItems = JSON.parse(jsonMatch[1] || jsonMatch[0]) as any[];
					// Validate categories
					const items: UserProfileItem[] = rawItems
						.filter((item): item is UserProfileItem => {
							if (!item || typeof item.text !== 'string' || !item.text.trim()) {
								return false;
							}
							if (!item.category || typeof item.category !== 'string' || !USER_PROFILE_VALID_CATEGORIES.includes(item.category as UserProfileCategory)) {
								return false;
							}
							return true;
						})
						.map((item) => ({
							text: item.text.trim(),
							category: item.category as UserProfileCategory,
							confidence: item.confidence,
						}));
					return items;
				} catch {
					// Fall through to bullet list parsing
				}
			}
			
			// Fallback: parse as bullet list (legacy format, use 'other' category)
			const texts = this.parseBulletList(content);
			return texts.map(text => ({
				text,
				category: 'other' as UserProfileCategory, // Legacy format doesn't have category info
			}));
		} catch (error) {
			console.warn('[UserProfileService] Failed to load context:', error);
			return [];
		}
	}

	/**
	 * Convert Map to UserProfileItem[].
	 */
	private mapToItems(map: Map<UserProfileCategory, string[]>): UserProfileItem[] {
		const items: UserProfileItem[] = [];
		for (const [category, texts] of map.entries()) {
			for (const text of texts) {
				items.push({ text, category });
			}
		}
		return items;
	}

	/**
	 * Save context items to file.
	 */
	private async saveContext(items: UserProfileItem[]): Promise<void> {
		// Save as JSON for structured format
		const content = `# User Context\n\n\`\`\`json\n${JSON.stringify(items, null, 2)}\n\`\`\`\n\n## Plain List\n\n${items.map((item) => `- ${item.text}`).join('\n')}\n`;
		const file = this.app.vault.getAbstractFileByPath(this.contextFilePath);
		if (file instanceof TFile) {
			await this.app.vault.modify(file, content);
		} else {
			await this.app.vault.create(this.contextFilePath, content);
		}
	}

	/**
	 * Parse bullet list from text.
	 */
	private parseBulletList(text: string): string[] {
		const lines = text.split('\n');
		const items: string[] = [];
		
		for (const line of lines) {
			const trimmed = line.trim();
			// Match bullet points: - item or * item
			const match = trimmed.match(/^[-*]\s+(.+)$/);
			if (match) {
				items.push(match[1].trim());
			}
		}

		return items;
	}

	/**
	 * Convert profile JSON to context items.
	 */
	private profileToContextItems(profile: Record<string, any>): UserProfileItem[] {
		const items: UserProfileItem[] = [];

		if (profile.communicationStyle) {
			items.push({
				text: profile.communicationStyle,
				category: 'communication-style',
			});
		}
		if (Array.isArray(profile.workPatterns)) {
			profile.workPatterns.forEach((pattern: string) => {
				items.push({
					text: pattern,
					category: 'work-pattern',
				});
			});
		}
		if (Array.isArray(profile.toolPreferences)) {
			profile.toolPreferences.forEach((tool: string) => {
				items.push({
					text: tool,
					category: 'tool-preference',
				});
			});
		}
		if (Array.isArray(profile.expertiseAreas)) {
			profile.expertiseAreas.forEach((area: string) => {
				items.push({
					text: area,
					category: 'expertise-area',
				});
			});
		}
		if (profile.responseStyle) {
			items.push({
				text: profile.responseStyle,
				category: 'response-style',
			});
		}

		return items;
	}

	/**
	 * Merge new context items with existing ones, avoiding duplicates.
	 */
	private mergeContextItems(existing: UserProfileItem[], newItems: UserProfileItem[]): UserProfileItem[] {
		const merged = [...existing];
		
		for (const newItem of newItems) {
			// Check if similar item already exists
			const existingIndex = merged.findIndex(item => 
				item.text.toLowerCase() === newItem.text.toLowerCase() ||
				(item.category === newItem.category && item.text.includes(newItem.text))
			);
			
			if (existingIndex >= 0) {
				// Update existing item
				merged[existingIndex] = newItem;
			} else {
				// Add new item
				merged.push(newItem);
			}
		}

		return merged;
	}

}
