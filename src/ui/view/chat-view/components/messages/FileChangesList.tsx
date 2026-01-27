import React, { useState, useCallback } from 'react';
import { FileChange } from '@/service/chat/types';
import { Button } from '@/ui/component/shared-ui/button';
import { X, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/ui/react/lib/utils';
import { getFileIconComponent } from '@/ui/view/shared/file-utils';
import { useChatSessionStore } from '../../store/chatSessionStore';

/**
 * FileChangesList.tsx
 * 
 * 【这个文件是干什么的】
 * 该文件定义了 `FileChangesList` 及其子组件 `FileChangeItem`。它是一个交互式的“变更确认栏”，
 * 用于展示 AI 在对话过程中提议对本地文件进行的修改（类似于 Git 的暂存区）。
 * 
 * 【起了什么作用】
 * 1. **变更审查**：列出 AI 建议修改的所有文件路径，以及每个文件的增加行数（+）和删除行数（-）。
 * 2. **精细化控制**：用户可以逐个点击“接受（Check）”或“丢弃（X）”某个文件的建议修改。
 * 3. **批量操作**：提供“Keep all（保留全部）”和“Undo all（撤销全部）”功能，快速处理大量建议。
 * 4. **视觉反馈**：通过半透明背景色（蓝调）和折叠/展开动画，将“提议中的修改”与正式对话历史区分开来。
 * 
 * 【举例介绍】
 * - 用户要求 AI “优化这段 CSS”。AI 分析后，生成了一个针对 `styles.css` 的修改。
 * - UI 中会浮现出一个蓝色区域，显示 “1 File”，列表里有 `styles.css`。
 * - 用户将鼠标移到文件名上，会出现对勾图标。点击对勾，修改正式应用到用户的笔记中；点击叉号，则取消该修改。
 * 
 * 【技术实现】
 * 1. **状态协作 (useChatSessionStore)**：通过 `chatSessionStore` 管理全局的提议变更列表。这种跨组件的状态共享确保了在对话的任何地方触发的变更都能在此统一处理。
 * 2. **响应式布局**：基于 Tailwind 的 `pktw-max-h-60` 和 `pktw-transition-all` 实现平滑的折叠展开效果，避免在变更文件过多时遮挡聊天界面。
 * 3. **动态图标**：`getFileIconComponent` 根据文件后缀动态加载对应的 Lucide 图标，增强视觉识别度。
 * 4. **交互控制**：`isHovered` 本地状态用于控制操作按钮（Accept/Discard）仅在鼠标滑过时显示，保持界面清爽。
 */

/**
 * Component for displaying a single file change item
 * 单个文件变更项组件
 */
const FileChangeItem: React.FC<{
	change: FileChange;
	onAccept: (id: string) => void;
	onDiscard: (id: string) => void;
}> = ({ change, onAccept, onDiscard }) => {
	const [isHovered, setIsHovered] = useState(false);
	const fileName = change.filePath.split('/').pop() || change.filePath;
	const extension = fileName.split('.').pop();
	const IconComponent = getFileIconComponent(extension);

	return (
		<div
			className="pktw-flex pktw-items-center pktw-justify-between pktw-px-4 pktw-py-2 pktw-transition-all pktw-duration-200 hover:pktw-bg-blue-500/10 hover:pktw-shadow-sm"
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
		>
			{/* 文件信息区域 */}
			<div className="pktw-flex pktw-items-center pktw-gap-3 pktw-flex-1 pktw-min-w-0">
				<IconComponent className="pktw-w-4 pktw-h-4 pktw-text-black pktw-flex-shrink-0" />
				<span className=" pktw-truncate pktw-text-black">
					{fileName}
				</span>
				{/* 增删行数统计 */}
				<div className="pktw-whitespace-nowrap pktw-flex-shrink-0 pktw-flex pktw-items-center pktw-gap-1">
					{change.addedLines > 0 && (
						<span className="pktw-text-green-600">
							+{change.addedLines}
						</span>
					)}
					&nbsp;
					{change.removedLines > 0 && (
						<span className="pktw-text-red-600">
							-{change.removedLines}
						</span>
					)}
				</div>
			</div>

			{/* 操作按钮区：仅在 Hover 时可见 */}
			<div className="pktw-flex pktw-items-center pktw-gap-1 pktw-flex-shrink-0">
				<Button
					variant="ghost"
					size="sm"
					className={cn(
						"pktw-h-6 pktw-w-6 pktw-p-0 pktw-transition-opacity pktw-duration-200",
						isHovered ? "pktw-opacity-100" : "pktw-opacity-0 pktw-pointer-events-none"
					)}
					onClick={() => onDiscard(change.id)}
					title="Discard changes"
				>
					<X className="pktw-w-4 pktw-h-4 pktw-text-black hover:pktw-text-white" />
				</Button>
				<Button
					variant="ghost"
					size="sm"
					className={cn(
						"pktw-h-6 pktw-w-6 pktw-p-0 pktw-transition-opacity pktw-duration-200",
						isHovered ? "pktw-opacity-100" : "pktw-opacity-0 pktw-pointer-events-none"
					)}
					onClick={() => onAccept(change.id)}
					title="Accept changes"
				>
					<Check className="pktw-w-4 pktw-h-4 pktw-text-black hover:pktw-text-white" />
				</Button>
			</div>
		</div>
	);
};

/**
 * Component for displaying list of file changes with bulk actions
 * 文件变更列表容器组件
 */
export const FileChangesList: React.FC = () => {
	// 从 store 中提取变更数据及操作方法
	const {
		fileChanges,
		acceptAllFileChanges,
		discardAllFileChanges,
		acceptFileChange,
		discardFileChange
	} = useChatSessionStore();

	const [isExpanded, setIsExpanded] = useState(true);

	// 如果没有挂起的变更，则不显示该组件
	if (fileChanges.length === 0) {
		return null;
	}

	const toggleExpanded = useCallback(() => {
		setIsExpanded(prev => !prev);
	}, []);

	return (
		<div className="pktw-border pktw-border-border pktw-rounded-lg pktw-mx-4">
			{/* 头部：包含统计信息和全选/全撤销操作 */}
			<div className={cn(
				"pktw-flex pktw-items-center pktw-justify-between pktw-px-4 pktw-py-3 pktw-border-b pktw-border-border pktw-bg-blue-500/15",
				isExpanded ? "pktw-rounded-t-lg" : "pktw-rounded-lg"
			)}>
				<div className="pktw-flex pktw-items-center pktw-gap-2">
					{/* 折叠/展开切换按钮 */}
					<Button
						variant="ghost"
						size="sm"
						className="pktw-h-6 pktw-w-6 pktw-p-0 pktw-text-black hover:pktw-text-white"
						onClick={toggleExpanded}
						title={isExpanded ? 'Collapse' : 'Expand'}
					>
						{isExpanded ? (
							<ChevronUp className="pktw-w-4 pktw-h-4" />
						) : (
							<ChevronDown className="pktw-w-4 pktw-h-4" />
						)}
					</Button>
					<span className="pktw-text-black">
						{fileChanges.length} File{fileChanges.length !== 1 ? 's' : ''}
					</span>
				</div>
				{/* 批量操作控制台 */}
				<div className="pktw-flex pktw-items-center pktw-gap-2">
					<Button
						variant="ghost"
						size="sm"
						className="pktw-text-black hover:pktw-text-white"
						onClick={discardAllFileChanges}
					>
						Undo all
					</Button>
					<Button
						variant="ghost"
						size="sm"
						className="pktw-text-black hover:pktw-text-white"
						onClick={acceptAllFileChanges}
					>
						Keep all
					</Button>
				</div>
			</div>

			{/* 文件列表 body 部分，带平滑高度切换动画 */}
			<div
				className={cn(
					"pktw-overflow-hidden pktw-transition-all pktw-duration-300 pktw-ease-in-out",
					isExpanded ? "pktw-max-h-60 pktw-opacity-100" : "pktw-max-h-0 pktw-opacity-0"
				)}
			>
				<div className="pktw-max-h-60 pktw-overflow-y-auto pktw-bg-blue-500/15 pktw-rounded-b-lg">
					{fileChanges.map((change) => (
						<FileChangeItem
							key={change.id}
							change={change}
							onAccept={acceptFileChange}
							onDiscard={discardFileChange}
						/>
					))}
				</div>
			</div>
		</div>
	);
};