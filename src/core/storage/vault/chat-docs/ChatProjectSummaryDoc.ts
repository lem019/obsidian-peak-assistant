/**
 * @file ChatProjectSummaryDoc.ts
 * @description 项目摘要文档模型。
 * 
 * ## 核心职能
 * 负责生成和解析项目级别的摘要 Markdown 文件。这些文件通常存储在项目根目录下，用于向用户展示该项目（对话集合）的整体简述。
 * 
 * ## 结构规范
 * - ## Short Summary (Level 2 Heading)
 * - ## Full Summary (Level 2 Heading)
 * 
 * ## 生活化类比
 * 就像是一本书的“内容导读”或“内容提要”。它不记录具体的对话内容，而是把这整个“项目文件夹”里发生的所有的事概括成一段话，方便你以后快速回想这个项目是在干什么。
 */

/**
 * Document model for project summary markdown (plain text, no meta).
 * 
 * 项目摘要 Markdown 的文档模型（纯文本，无元数据）。
 */
export interface ChatProjectSummaryModel {
	shortSummary: string;
	fullSummary: string;
}

export class ChatProjectSummaryDoc {
	/**
	 * Build project summary markdown (plain text, no meta).
	 * 
	 * 构建项目摘要 Markdown（纯文本，无元数据）。
	 */
	static buildMarkdown(params: {
		shortSummary?: string;
		fullSummary?: string;
	}): string {
		const model: ChatProjectSummaryModel = {
			shortSummary: (params.shortSummary ?? '').trim(),
			fullSummary: (params.fullSummary ?? '').trim(),
		};
		return ChatProjectSummaryDoc.render(model);
	}

	/**
	 * Render project summary markdown.
	 */
	private static render(model: ChatProjectSummaryModel): string {
		const parts: string[] = [];
		if (model.shortSummary) {
			parts.push('## Short Summary', model.shortSummary, '');
		}
		if (model.fullSummary) {
			parts.push('## Full Summary', model.fullSummary, '');
		}
		return parts.join('\n').trim() + '\n';
	}

	/**
	 * Parse project summary markdown.
	 *
	 * Supported formats:
	 * - Sectioned headings: `## Short Summary`, `## Full Summary`
	 * - Legacy/plain text: first paragraph => shortSummary, remainder => fullSummary
	 */
	static parse(raw: string): ChatProjectSummaryModel {
		const text = raw.replace(/\r\n/g, '\n').trim();
		if (!text) {
			return { shortSummary: '', fullSummary: '' };
		}

		const hasSectionHeadings =
			/^##\s+Short Summary\s*$/m.test(text) ||
			/^##\s+Full Summary\s*$/m.test(text);

		if (!hasSectionHeadings) {
			// Heuristic: first paragraph is short, rest is full.
			const blocks = text.split(/\n{2,}/);
			const shortSummary = (blocks[0] ?? '').trim();
			const fullSummary = blocks.slice(1).join('\n\n').trim();
			return { shortSummary, fullSummary };
		}

		const pickSection = (heading: string): string => {
			const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			const re = new RegExp(
				`^##\\s+${escaped}\\s*$\\n([\\s\\S]*?)(?=^##\\s+|\\n?$)`,
				'm'
			);
			const m = text.match(re);
			return (m?.[1] ?? '').trim();
		};

		return {
			shortSummary: pickSection('Short Summary'),
			fullSummary: pickSection('Full Summary'),
		};
	}
}
