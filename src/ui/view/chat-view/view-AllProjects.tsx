import React, { useState, useEffect, useCallback } from 'react';
import { ChatProject } from '@/service/chat/types';
import { cn } from '@/ui/react/lib/utils';
import { Folder } from 'lucide-react';
import { useServiceContext } from '@/ui/context/ServiceContext';
import { useChatViewStore } from '@/ui/view/chat-view/store/chatViewStore';

/**
 * view-AllProjects.tsx
 * 
 * 【这个文件是干什么的】
 * 该文件定义了 `AllProjectsViewComponent` 组件，它是插件对话视图中的“所有项目”广场页面。
 * 用于以卡片网格的形式展示用户创建的所有知识库项目（Projects）。
 * 
 * 【起了什么作用】
 * 1. **全景展示**：作为项目导航的顶层，用户可以在这里一扫而过所有的研究主题或工作区。
 * 2. **摘要入口**：每张项目卡片不仅显示名称，还显示由 AI 生成的项目短摘要，帮助用户快速定位。
 * 3. **高性能加载**：集成了分页显示和无限滚动逻辑，即使项目数量巨大也能保持流畅的滚动体验。
 * 4. **导航控制**：点击项目卡片后，通过 `chatViewStore` 切换视图到对应的项目详情页。
 * 
 * 【举例介绍】
 * - 用户平时在 Obsidian 中管理了 50 个不同的研究项目。
 * - 打开“All Projects”视图，页面会呈现一个 3 列网格，每个卡片代表一个项目。
 * - 卡片上写着“React 源码解析”，下方是 AI 总结的“深入了解 React 重调度算法及 Fiber 结构”。
 * 
 * 【技术实现】
 * 1. **状态管理 (useState)**：独立维护 `projects` 原始数据和 `projectsPage` 当前显示页。
 * 2. **无限滚动 (IntersectionObserver)**：在列表末尾放置 `sentinelRef` 哨兵，当其由于用户滚动而暴露在视口中时，自动递增页码加载后续卡片。
 * 3. **响应式设计 (Grid Layout)**：使用 Tailwind 的 `pktw-grid-cols-1 md:pktw-grid-cols-2 lg:pktw-grid-cols-3`，确保在移动端、普通侧边栏和宽屏独立窗口下都有最佳排版。
 * 4. **视图切换**：利用 `useChatViewStore.getState().setProjectOverview(project)` 实现跨组件的深度视图切换。
 */

interface AllProjectsViewProps {
}

// 分页步长设置
const PROJECTS_PAGE_SIZE = 20;

/**
 * View component for displaying all projects in a card grid
 * 项目广场视图组件：以卡片网格形式展示所有项目
 */
export const AllProjectsViewComponent: React.FC<AllProjectsViewProps> = ({
}) => {
	const { manager } = useServiceContext();
	const [projects, setProjects] = useState<ChatProject[]>([]);
	const [projectsPage, setProjectsPage] = useState(0);
	const [loading, setLoading] = useState(true);

	/**
	 * 处理项目卡片点击跳转
	 */
	const onProjectClick = useCallback((project: ChatProject) => {
		useChatViewStore.getState().setProjectOverview(project);
	}, []);

	// 获取所有项目数据
	useEffect(() => {
		const loadProjects = async () => {
			setLoading(true);
			const allProjects = await manager.listProjects();
			setProjects(allProjects);
			setProjectsPage(0);
			setLoading(false);
		};
		loadProjects();
	}, [manager]);

	// 计算当前页需要渲染的切片数据
	const endIndex = (projectsPage + 1) * PROJECTS_PAGE_SIZE;
	const projectsToShow = projects.slice(0, endIndex);
	const hasMore = endIndex < projects.length;

	// --- 无限滚动逻辑设置 ---
	const sentinelRef = React.useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!hasMore || !sentinelRef.current) return;

		const observer = new IntersectionObserver(
			(entries) => {
				entries.forEach((entry) => {
					// 一旦感知到滚动触底，更新页码以触发展现更多切片
					if (entry.isIntersecting) {
						setProjectsPage((prev) => prev + 1);
					}
				});
			},
			{ threshold: 0.1 }
		);

		observer.observe(sentinelRef.current);

		return () => {
			observer.disconnect();
		};
	}, [hasMore, projectsPage]);

	// 加载占位
	if (loading) {
		return (
			<div className="pktw-flex pktw-items-center pktw-justify-center pktw-h-full pktw-text-muted-foreground">
				Loading projects...
			</div>
		);
	}

	// 空数据处理
	if (projectsToShow.length === 0) {
		return (
			<div className="pktw-flex pktw-items-center pktw-justify-center pktw-h-full pktw-text-muted-foreground">
				No projects yet.
			</div>
		);
	}

	return (
		<div className="pktw-flex pktw-flex-col pktw-h-full pktw-overflow-y-auto">
			{/* 卡片网格容器 */}
			<div className="pktw-grid pktw-grid-cols-1 md:pktw-grid-cols-2 lg:pktw-grid-cols-3 pktw-gap-4 pktw-p-6">
				{projectsToShow.map((project) => (
					<div
						key={project.meta.id}
						className={cn(
							'pktw-flex pktw-flex-col pktw-gap-3 pktw-p-4 pktw-rounded-lg',
							'pktw-border pktw-border-border pktw-bg-card',
							'pktw-cursor-pointer pktw-transition-all',
							'hover:pktw-shadow-md hover:pktw-border-primary/50'
						)}
						onClick={() => onProjectClick(project)}
					>
						{/* 项目标题与图标 */}
						<div className="pktw-flex pktw-items-center pktw-gap-2">
							<Folder className="pktw-w-5 pktw-h-5 pktw-text-muted-foreground" />
							<h3 className="pktw-text-lg pktw-font-semibold pktw-text-foreground pktw-m-0">
								{project.meta.name}
							</h3>
						</div>

						{/* AI 生成的项目简述，多行自动截断 */}
						<div className="pktw-text-sm pktw-text-muted-foreground pktw-line-clamp-3">
							{project.context?.shortSummary || 'No summary available.'}
						</div>
					</div>
				))}
			</div>

			{/* 无限滚动触发哨兵 */}
			{hasMore && (
				<div
					ref={sentinelRef}
					className="pktw-h-4 pktw-w-full"
					aria-hidden="true"
				/>
			)}
		</div>
	);
};

