/**
 * ============================================================================
 * 文件说明: PromptInput.tsx - 核心输入组件
 * ============================================================================
 * 
 * 【这个文件是干什么的】
 * 这个文件是聊天界面的“司令部”，也就是你打字聊天、拖入文件的地方。
 * 它不是一个简单的文本框，而是一个集成了文字输入、附件管理、自动补全、
 * 全局拖拽和表单提交功能的综合控制台。
 * 
 * 【起了什么作用】
 * 1. 状态大脑：管理着用户当前输入的所有内容（还没发送的消息、已经选好的文件附件等）。
 * 2. 附件处理：负责接收拖拽的文件，计算文件哈希（防止重复），并生成预览图。
 * 3. 自动补全调度：当你输入 @ 或 / 时，它会协调弹出补全菜单。
 * 4. 键盘交互：处理 Shift+Enter 换行、Enter 发送等逻辑。
 * 5. 全局拖拽支持：让用户可以从电脑桌面直接把文件甩进聊天窗口。
 * 
 * 【举例介绍】
 * 场景：你想让 AI 帮你分析一张 PDF 图片。
 * 1. 你把 PDF 拖到输入框，PromptInput 会立刻识别文件，显示一个小缩略图。
 * 2. 你接着输入“帮我总结一下”，PromptInput 会把文字和 PDF 文件合在一起。
 * 3. 点击发送按钮，它会通过 onSubmit 回调把这些数据打包发给后台服务。
 * 
 * 【技术实现】
 * - React Context: 定义了 PromptInputContext，让底部的小工具（文件按钮、搜索按钮）
 *   都能直接操作顶层的输入状态，无需复杂的属性传递。
 * - useCallback/useMemo: 大量使用性能优化手段，确保输入文字时不卡顿。
 * - FileReader API: 用于在本地生成图片的 Base64 预览图。
 * ============================================================================
 */
import React, { createContext, useContext, useRef, useCallback, useEffect, useState, useMemo, type FormEvent, type HTMLAttributes, type PropsWithChildren } from 'react';
import { cn } from '@/ui/react/lib/utils';
import { calculateFileHash } from '@/core/utils/hash-utils';
import { HiddenFileInput } from '@/ui/component/mine/input-for-file-with-hidden';
import { PromptInputBody } from './PromptInputBody';
import type { PromptInputMessage, FileAttachment } from './types';

// ============================================================================
// 上下文定义：定义了输入组件内部的“通信协议”
// ============================================================================
/**
 * Context for prompt input state management
 */
interface PromptInputContextValue {
	// 文本输入状态
	textInput: {
		value: string;             // 当前输入的文字内容
		setInput: (value: string) => void; // 设置文字的方法
		clear: () => void;         // 清空文字的方法
	};
	// 聚焦方法：让输入框重新获得光标
	focusInput: () => void;
	// 附件（文件）管理状态
	attachments: {
		files: FileAttachment[];   // 当前已选中的文件列表
		add: (files: File[] | FileList) => void; // 添加文件的方法
		remove: (id: string) => void;           // 移除某个附件
		clear: () => void;                      // 清空所有附件
		openFileDialog: () => void;             // 触发系统的文件选择对话框
		registerFileInput: (ref: React.RefObject<HTMLInputElement | null>) => void; // 绑定隐藏的文件输入框
	};
	// 自动补全相关的元数据（用于 @提及笔记 或 /使用提示词模板）
	autocompletion: {
		contextItems: any[];       // 选中的上下文项（如笔记路径）
		promptItems: any[];        // 选中的提示词项
		onLoadContextItems?: (query: string, currentFolder?: string) => Promise<any[]>; // 异步加载搜索结果
		onLoadPromptItems?: (query: string) => Promise<any[]>; // 异步加载提示词列表
		onMenuItemSelect?: (triggerChar: string, selectedItem: any) => void; // 菜单选中时的回调
	};
}

// 创建 Context 容器
const PromptInputContext = createContext<PromptInputContextValue | null>(null);

/**
 * Hook to access prompt input context
 * 方便子组件（如发送按钮、文件按钮）快速获取输入框的状态
 */
export const usePromptInputContext = () => {
	const context = useContext(PromptInputContext);
	if (!context) {
		throw new Error('usePromptInputContext must be used within PromptInput');
	}
	return context;
};

// ============================================================================
// Props 类型定义：规定了外部如何使用 PromptInput 组件
// ============================================================================
export interface PromptInputProps extends Omit<HTMLAttributes<HTMLFormElement>, 'onSubmit'> {
	// 提交回调：消息打完后点击发送的操作
	onSubmit: (message: PromptInputMessage, event: FormEvent<HTMLFormElement>) => void | Promise<void>;
	multiple?: boolean;            // 是否支持同时上传多个文件
	globalDrop?: boolean;          // 是否支持全局拖拽上传
	accept?: string;               // 限制上传的文件类型（如 "image/*"）
	initialInput?: string;         // 初始填写的文字
	inputFocusRef?: React.RefObject<{ focus: () => void }>; // 外部控制聚焦的引用
	// 自动化补全数据源
	contextItems?: any[];
	promptItems?: any[];
	onLoadContextItems?: (query: string, currentFolder?: string) => Promise<any[]>;
	onLoadPromptItems?: (query: string) => Promise<any[]>;
	onMenuItemSelect?: (triggerChar: string, selectedItem: any) => void;
	onTextChange?: (text: string, tags: Array<{ type: 'context' | 'prompt'; text: string; start: number; end: number; }>) => void;
}

/**
 * Main PromptInput component with internal state management
 * Layout: textarea on top, tools (file/search/model) on bottom left, submit on bottom right
 * 
 * 组件布局结构：
 * [ ------------------ 文本输入区域 ------------------ ]
 * [ 📄文件预览卡片（按需显示）                       ]
 * [ 🔍小工具按钮组(左)                   🚀发送按钮(右) ]
 */
export const PromptInput: React.FC<PromptInputProps> = ({
	className,
	onSubmit,
	multiple = true,
	globalDrop = false,
	accept,
	initialInput = '',
	inputFocusRef,
	contextItems = [],
	promptItems = [],
	onLoadContextItems,
	onLoadPromptItems,
	onMenuItemSelect,
	onTextChange,
	children,
	...props
}) => {
	// ============================================================================
	// 内部状态管理
	// ============================================================================
	const [textInput, setTextInput] = useState(initialInput); // 存储用户打的字
	const [attachments, setAttachments] = useState<FileAttachment[]>([]); // 存储选好的文件附件
	const openFileDialogRef = useRef<() => void>(() => { }); // 引用手动打开文件弹窗的方法
	const formRef = useRef<HTMLFormElement>(null); // 表单 DOM 引用
	const fileInputRef = useRef<HTMLInputElement>(null); // 隐藏文件框的 DOM 引用

	// 设置文字
	const setInput = useCallback((value: string) => {
		setTextInput(value);
	}, []);

	// 清空文字
	const clearInput = useCallback(() => {
		setTextInput('');
	}, []);

	// 让光标回到输入框
	const focusInput = useCallback(() => {
		inputFocusRef?.current?.focus();
	}, [inputFocusRef]);

	// ============================================================================
	// 辅助方法：处理图片和文件类型
	// ============================================================================
	// 将文件读取为预览图（Base64 字符串）
	const createImagePreview = useCallback((file: File): Promise<string> => {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = (e) => {
				if (e.target?.result) {
					resolve(e.target.result as string);
				} else {
					reject(new Error('Failed to read file'));
				}
			};
			reader.onerror = reject;
			reader.readAsDataURL(file);
		});
	}, []);

	// 识别文件类型：是图片、PDF 还是普通文件
	const getFileType = useCallback((file: File): 'image' | 'file' | 'pdf' => {
		if (file.type.startsWith('image/')) {
			return 'image';
		}
		if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
			return 'pdf';
		}
		return 'file';
	}, []);

	// 核心逻辑：添加文件到附件列表
	const addFiles = useCallback(async (files: File[] | FileList) => {
		const fileArray = Array.from(files);
		const newAttachments: FileAttachment[] = [];

		for (const file of fileArray) {
			// 计算文件哈希：用来做排重，防止同一个文件传两次
			let fileHash: string;
			try {
				fileHash = await calculateFileHash(file);
			} catch (error) {
				console.error('Failed to calculate file hash:', error);
				// 如果哈希计算失败，使用文件名+大小+修改时间凑合一下
				fileHash = `${file.name}-${file.size}-${file.lastModified}`;
			}

			const type = getFileType(file);
			const attachment: FileAttachment = {
				id: `${Date.now()}-${Math.random()}`, // 生成唯一 ID
				file,
				type,
				hash: fileHash,
			};

			// 如果是图片，我们生成一个本地预览图，好让用户在发送前确认
			if (type === 'image') {
				try {
					attachment.preview = await createImagePreview(file);
				} catch (error) {
					console.error('Failed to create image preview:', error);
				}
			}

			newAttachments.push(attachment);
		}

		// 将新选好的文件加入现有的附件列表中
		if (newAttachments.length > 0) {
			setAttachments((prev) => {
				// 再次根据哈希值排重：如果这个文件已经在列表里了（比如用户手滑选了两次），就跳过它
				const existingHashes = new Set(prev.map(a => a.hash).filter(Boolean));
				const uniqueNewAttachments = newAttachments.filter(a => !a.hash || !existingHashes.has(a.hash));

				if (uniqueNewAttachments.length < newAttachments.length) {
					console.log(`Skipped ${newAttachments.length - uniqueNewAttachments.length} duplicate file(s)`);
				}

				return [...prev, ...uniqueNewAttachments];
			});
		}
	}, [createImagePreview, getFileType]);

	// 移除某个附件
	const removeFile = useCallback((id: string) => {
		setAttachments((prev) => {
			const file = prev.find((f) => f.id === id);
			// 如果这个附件有预览图资源（blob），记得销毁它，释放内存
			if (file?.preview && file.preview.startsWith('blob:')) {
				URL.revokeObjectURL(file.preview);
			}
			return prev.filter((f) => f.id !== id);
		});
	}, []);

	// 清空所有附件
	const clearFiles = useCallback(() => {
		setAttachments((prev) => {
			// 循环释放所有预览图资源
			prev.forEach((f) => {
				if (f.preview && f.preview.startsWith('blob:')) {
					URL.revokeObjectURL(f.preview);
				}
			});
			return [];
		});
	}, []);

	// 触发原生的文件选择框
	const openFileDialog = useCallback(() => {
		openFileDialogRef.current?.();
	}, []);

	// 绑定隐藏的文件输入框引用
	const registerFileInput = useCallback((ref: React.RefObject<HTMLInputElement | null>) => {
		openFileDialogRef.current = () => {
			ref.current?.click();
		};
	}, []);

	// 当组件被销毁时，清理所有残留的预览图资源
	// Cleanup on unmount
	useEffect(() => {
		return () => {
			attachments.forEach((f) => {
				if (f.preview && f.preview.startsWith('blob:')) {
					URL.revokeObjectURL(f.preview);
				}
			});
		};
	}, []);

	// ============================================================================
	// 汇总 Context 值：这些值会被注入到 PromptInputContext 中
	// ============================================================================
	// Context value
	const contextValue = useMemo<PromptInputContextValue>(
		() => ({
			textInput: {
				value: textInput,
				setInput,
				clear: clearInput,
			},
			focusInput,
			attachments: {
				files: attachments,
				add: addFiles,
				remove: removeFile,
				clear: clearFiles,
				openFileDialog,
				registerFileInput,
			},
			autocompletion: {
				contextItems,
				promptItems,
				onLoadContextItems,
				onLoadPromptItems,
				onMenuItemSelect,
			},
		}),
		[textInput, setInput, clearInput, focusInput, attachments, addFiles, removeFile, clearFiles, openFileDialog, registerFileInput, contextItems, promptItems, onLoadContextItems, onLoadPromptItems, onMenuItemSelect]
	);

	// 初始化时绑定文件输入框
	// Register file input
	useEffect(() => {
		registerFileInput(fileInputRef);
	}, [registerFileInput]);

	// 处理隐藏文件框的选择事件
	// Handle file input change
	const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
		if (e.target.files && e.target.files.length > 0) {
			addFiles(e.target.files);
			// 重点：重置 input 的值。
			// 这样下次选同一个文件时，onChange 事件才能再次触发
			e.target.value = '';
		}
	}, [addFiles]);

	// ============================================================================
	// 核心逻辑：表单提交（点击发送或 Enter 键）
	// ============================================================================
	// Handle form submit
	const handleSubmit = useCallback((e: FormEvent<HTMLFormElement>) => {
		e.preventDefault(); // 阻止浏览器默认的网页提交行为

		// 打包消息数据
		const message: PromptInputMessage = {
			text: textInput.trim(),
			files: attachments.map((f) => f.file), // 提取出真正的 File 对象
		};

		// 安全检查：如果文字是空的，也没选文件，就不发送
		// Only submit if there's text or files
		if (!message.text && message.files.length === 0) {
			return;
		}

		// 调用外部传进来的提交方法（通常是发送给 AI 服务）
		const result = onSubmit(message, e);

		// 处理异步提交
		// Handle async submit
		if (result instanceof Promise) {
			result
				.then(() => {
					// 只有发送成功了，我们才清空输入框和附件
					// 这种体验比较好，万一网络挂了，用户打的内容还在
					// Clear on success
					clearInput();
					clearFiles();
				})
				.catch(() => {
					// 发生错误时不清理，让用户可以重试
					// Don't clear on error - user may want to retry
				});
		} else {
			// 如果是同步方法，直接清理
			// Sync submit - clear immediately
			clearInput();
			clearFiles();
		}
	}, [textInput, attachments, onSubmit, clearInput, clearFiles]);

	// ============================================================================
	// 交互逻辑：处理拖放（Drag & Drop）
	// ============================================================================
	// Handle drag and drop
	useEffect(() => {
		if (!formRef.current) return;

		// 当文件拖到输入框上方时，改变鼠标样式，提示可以放下
		const handleDragOver = (e: DragEvent) => {
			if (e.dataTransfer?.types?.includes('Files')) {
				e.preventDefault();
			}
		};

		// 真正放下文件时的逻辑
		const handleDrop = (e: DragEvent) => {
			if (e.dataTransfer?.types?.includes('Files')) {
				e.preventDefault(); // 组织浏览器直接在窗口打开图片/文件
			}
			if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
				// 获取拖入的文件并添加
				addFiles(e.dataTransfer.files);
			}
		};

		const form = formRef.current;
		form.addEventListener('dragover', handleDragOver);
		form.addEventListener('drop', handleDrop);

		return () => {
			form.removeEventListener('dragover', handleDragOver);
			form.removeEventListener('drop', handleDrop);
		};
	}, [addFiles, globalDrop]);

	// ============================================================================
	// 全局拖放逻辑：支持将文件拖入整个文档区域
	// ============================================================================
	// Global drop handler
	useEffect(() => {
		if (!globalDrop) return;

		// 当拖动文件经过文档时
		const handleDragOver = (e: DragEvent) => {
			if (e.dataTransfer?.types?.includes('Files')) {
				e.preventDefault(); // 允许释放
			}
		};

		// 当用户在文档区域释放文件时
		const handleDrop = (e: DragEvent) => {
			if (e.dataTransfer?.types?.includes('Files')) {
				e.preventDefault(); // 阻止浏览器打开文件
			}
			if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
				// 将释放的文件通过 addFiles 处理并加入列表
				addFiles(e.dataTransfer.files);
			}
		};

		// 绑定全局事件监听
		document.addEventListener('dragover', handleDragOver);
		document.addEventListener('drop', handleDrop);

		// 组件卸载时释放监听
		return () => {
			document.removeEventListener('dragover', handleDragOver);
			document.removeEventListener('drop', handleDrop);
		};
	}, [addFiles, globalDrop]);

	// ============================================================================
	// 渲染 (Render)
	// ============================================================================
	return (
		// 提供层级 Context，确保深层次的子组件能共享输入框的状态和方法
		<PromptInputContext.Provider value={contextValue}>
			<form
				ref={formRef}
				className={cn('pktw-w-full', className)}
				onSubmit={handleSubmit}
				{...props}
			>
				{/* 隐藏的文件上传输入框：它的核心作用是承接原生文件选择操作，但不显示在 UI 上 */}
				{/* Hidden file input */}
				<HiddenFileInput
					ref={fileInputRef}
					multiple={multiple}
					accept={accept}
					onChange={handleFileChange}
				/>

				{/* 主内容区域：采用 flex 布局，支持垂直堆叠样式 */}
				{/* Main content */}
				<div className="pktw-flex pktw-flex-col pktw-w-full">
					{React.Children.map(children, child => {
						// 这里稍微做了一点增强：如果子组件是 PromptInputBody 类型，会自动注入 onTextChange 回调
						// Pass onTextChange to PromptInputBody components
						if (React.isValidElement(child) && child.type === PromptInputBody) {
							return React.cloneElement(child, { (child.props as any).onTextChange || onTextChange });
						}
						return child;
					})}
				</div>
			</form>
		</PromptInputContext.Provider>
	);
};

