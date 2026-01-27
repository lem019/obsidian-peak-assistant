import React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

/**
 * project-summary.tsx
 * 
 * 【这个文件是干什么的】
 * 该文件定义了 `ProjectSummary` 组件，它是一个可折叠的卡片容器，专门用于在项目视图中展示 AI 生成的项目总体摘要。
 * 
 * 【起了什么作用】
 * 1. **核心价值提炼**：项目可能包含海量文件和对话，该组件通过展示汇总后的文本，让用户一眼理解项目的核心目标和当前进度。
 * 2. **空间优化**：采用折叠面板设计，默认可以收起以节省垂直空间，让用户专注于下方的对话记录。
 * 3. **视觉引导**：使用次要背景色（pktw-bg-secondary）和阴影效果，将其作为页面头部的“背景信息”与其他动态内容区分。
 * 
 * 【举例介绍】
 * - 用户进入“我的学术论文”项目。
 * - 页面顶部出现一个“Project Summary”卡片。
 * - 展开后显示：“本项目专注于研究 LLM 在 OBSIDIAN 环境下的 RAG 优化，涉及核心模块 eventBus 和 MultiProviderChatService...”
 * 
 * 【技术实现】
 * 1. **受控组件模式**：通过 `summaryExpanded` 和 `onSummaryExpandedChange` props 接收父组件的状态控制，确保状态在视图切换间保持同步。
 * 2. **平滑过渡动画**：利用 Tailwind 的 `pktw-transition-all`、`pktw-max-h-96` 以及 `pktw-opacity` 的组合，实现具有高度感知的平滑展开/收起动画。
 * 3. **条件渲染**：如果 `summaryText` 为空，组件会返回 `null`，确保不会显示一个难看的空白卡片。
 */

export interface ProjectSummaryProps {
	/** 摘要文本内容 */
	summaryText?: string;
	/** 当前是否展开 */
	summaryExpanded: boolean;
	/** 展开状态切换的回调 */
	onSummaryExpandedChange: (expanded: boolean) => void;
}

/**
 * Project summary collapsible component
 * 项目摘要折叠组件
 */
export const ProjectSummary: React.FC<ProjectSummaryProps> = ({
	summaryText,
	summaryExpanded,
	onSummaryExpandedChange,
}) => {
	// 如果没有摘要文本，不渲染任何内容
	if (!summaryText) {
		return null;
	}

	return (
		<div className="pktw-mb-6 pktw-border pktw-rounded-lg pktw-bg-secondary pktw-shadow-md pktw-overflow-hidden">
			{/* 标题栏/触发区域 */}
			<div
				className="pktw-flex pktw-items-center pktw-justify-between pktw-p-4 pktw-cursor-pointer hover:pktw-bg-muted/50 pktw-transition-colors"
				onClick={() => onSummaryExpandedChange(!summaryExpanded)}
			>
				<h3 className="pktw-text-base pktw-font-semibold pktw-text-foreground pktw-m-0">Project Summary</h3>
				<div className="pktw-transition-transform pktw-duration-200 pktw-ease-in-out">
					{summaryExpanded ? (
						<ChevronDown className="pktw-w-4 pktw-h-4 pktw-text-muted-foreground" />
					) : (
						<ChevronRight className="pktw-w-4 pktw-h-4 pktw-text-muted-foreground" />
					)}
				</div>
			</div>
			
			{/* 内容区域：带过渡动画 */}
			<div
				className={`pktw-transition-all pktw-duration-300 pktw-ease-in-out pktw-overflow-hidden ${summaryExpanded
						? 'pktw-max-h-96 pktw-opacity-100' // 展开状态：设置足够大的 max-h
						: 'pktw-max-h-0 pktw-opacity-0'     // 收起状态：高度归零，透明度归零
					}`}
			>
				<div className="pktw-px-4 pktw-pb-4 pktw-text-sm pktw-text-foreground/90 pktw-leading-relaxed">
					{summaryText}
				</div>
			</div>
		</div>
	);
};