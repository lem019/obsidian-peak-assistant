/**
 * 【这个文件是干什么的】
 * Conversation 组件是专门为“聊天对话流”设计的布局容器。
 * 
 * 【起了什么作用】
 * 1. 自动滚到底部：基于 `use-stick-to-bottom` 库，实现了聊天界面最常见的“锁定底部”功能，即当 AI 产生新回复时，窗口能自动向下滚动。
 * 2. 结构化布局：提供了 `Conversation` (外壳), `ConversationContent` (内容区), `ConversationEmptyState` (空状态) 和 `ConversationScrollButton` (回到底部预览) 等配套组件。
 * 3. 交互增强：当用户向上滚动查看历史记录时，会自动出现一个“回到底部”的按钮，提升操作便利性。
 * 
 * 【举例介绍】
 * 在 `MessageListRenderer` 中，我们使用这些组件来包裹所有的消息气泡。这样无论 AI 说多少话，用户都能跟上进度，且不会因为新消息弹出而打断手动查看历史。
 * 
 * 【技术实现】
 * - 使用了第三方库 `use-stick-to-bottom` 处理复杂的滚动平衡逻辑。
 * - 结合 `lucide-react` 图标和 Tailwind CSS 展示 UI 细节。
 */
import React, { useCallback } from "react";
import type { ComponentProps } from "react";
import { Button } from "@/ui/component/shared-ui/button";
import { cn } from "@/ui/react/lib/utils";
import { ArrowDownIcon } from "lucide-react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";

// 定义 Conversation 组件的属性，直接复用 StickToBottom 的属性定义
export type ConversationProps = ComponentProps<typeof StickToBottom>;

/**
 * 聊天对话的主容器
 */
export const Conversation = ({ className, ...props }: ConversationProps) => (
  <StickToBottom
    className={cn("pktw-relative pktw-flex-1 pktw-overflow-y-hidden", className)}
    initial="smooth" // 初始滚动效果
    resize="smooth"  // 窗口大小改变时的滚动效果
    role="log"       // 无障碍语义，标识为日志/动态更新内容
    {...props}
  />
);

// 消息内容的包装属性
export type ConversationContentProps = ComponentProps<
  typeof StickToBottom.Content
>;

/**
 * 聊天消息的实际内容容器
 * 采用 flex-col 布局，并设置了消息气泡之间的间距 (gap-8)
 */
export const ConversationContent = ({
  className,
  ...props
}: ConversationContentProps) => (
  <StickToBottom.Content
    className={cn("pktw-flex pktw-flex-col pktw-gap-8 pktw-p-4", className)}
    {...props}
  />
);

// 空状态（无消息时）的属性定义
export type ConversationEmptyStateProps = ComponentProps<"div"> & {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
};

/**
 * 当没有消息时显示的占位界面
 */
export const ConversationEmptyState = ({
  className,
  title = "No messages yet",
  description = "Start a conversation to see messages here",
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      "pktw-flex pktw-size-full pktw-flex-col pktw-items-center pktw-justify-center pktw-gap-3 pktw-p-8 pktw-text-center",
      className
    )}
    {...props}
  >
    {/* 允许通过 children 自定义，或者使用默认的 title/description 模式 */}
    {children ?? (
      <>
        {icon && <div className="pktw-text-muted-foreground">{icon}</div>}
        <div className="pktw-space-y-1">
          <h3 className="pktw-font-medium pktw-text-sm">{title}</h3>
          {description && (
            <p className="pktw-text-muted-foreground pktw-text-sm">{description}</p>
          )}
        </div>
      </>
    )}
  </div>
);

// 滚动到底部按钮的属性
export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

/**
 * 智能滚动按钮：只有当用户不在最底部时（比如在上翻历史记录）才会显示
 */
export const ConversationScrollButton = ({
  className,
  ...props
}: ConversationScrollButtonProps) => {
  // 从 StickToBottom 上下文中获取当前位置状态和滚动方法
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  const handleScrollToBottom = useCallback(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  return (
    // 如果已经在底部了，就没必要显示这个按钮
    !isAtBottom && (
      <Button
        className={cn(
          "pktw-absolute bottom-4 left-[50%] translate-x-[-50%] pktw-rounded-full",
          className
        )}
        onClick={handleScrollToBottom}
        size="icon"
        type="button"
        variant="outline"
        {...props}
      >
        <ArrowDownIcon className="pktw-size-4" />
      </Button>
    )
  );
};
