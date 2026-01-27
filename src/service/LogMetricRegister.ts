/**
 * ============================================================================
 * 文件说明: LogMetricRegister.ts - 日志指标注册器
 * ============================================================================
 * 
 * 【这个文件是干什么的】
 * 这个文件负责"监听"Obsidian 中的各种事件，并自动记录用户的活动。
 * 就像在办公室安装了一个考勤机，自动记录员工的上下班、工作时长等信息。
 * 
 * 【起了什么作用】
 * 1. 事件监听注册: 为 Obsidian 的各种事件（打开文件、编辑、关闭等）注册监听器
 * 2. 自动记录转换: 将 Obsidian 的事件自动转换为 ActivityRecord 并记录
 * 3. 去重处理: 防止重复记录同一个文件的事件
 * 4. 类型定义: 定义了所有可记录的活动类型（FileOpen、FileEdit 等）
 * 
 * 【举例介绍】
 * 想象一下：
 * - 当你在 Obsidian 中打开一个笔记时，workspace-file-open 事件被触发
 * - 这个文件中的监听器捕获到这个事件
 * - 自动创建一条 ActivityRecord：{ type: "FileOpen", value: "笔记.md" }
 * - 调用 logMetrics 将这条记录写入文件
 * 
 * 类似的，当你编辑笔记、关闭笔记、切换到其他应用时，都会被自动记录下来。
 * 这些记录最终会被 DailyStatisticsService 用来分析你的工作习惯。
 * 
 * 【技术实现】
 * - 使用事件监听器模式（Map<事件名称, 回调函数>）
 * - 与 Obsidian 的事件系统集成（workspace-file-open、vault-modify 等）
 * - 使用 Set 数据结构进行去重，避免同一文件被重复记录
 * ============================================================================
 */

import { TAbstractFile, TFile } from "obsidian";
import * as path from "path";
import { Callback } from "@/core/ScriptLoader";
import { ActivityRecord, ActivityRecordType, logMetrics } from "@/service/ActivityService";

// --------------------------------------------------------------------------------
// LogMetricType

/**
 * 日志指标类型枚举
 * 定义了所有可以记录的用户活动类型
 */
export enum LogMetricType {
    FILE_OPEN = "FileOpen",       // 打开文件
    FILE_EDIT = "FileEdit",       // 编辑文件
    FILE_CLOSE = "FileClose",     // 关闭文件
    WINDOW_ACTIVE = "WindowActive", // 窗口获得焦点（用户回到 Obsidian）
    WINDOW_LOSE = "WindowLose",   // 窗口失去焦点（用户切换到其他应用）
}

// Helper function to check if an entry is a file action
/**
 * 辅助函数：检查某个类型是否是文件操作
 * @param type - 活动类型字符串
 * @returns 如果是文件操作（打开、编辑、关闭）返回 true
 */
export function isFileAction(type: string) {
    return type === LogMetricType.FILE_EDIT || type === LogMetricType.FILE_OPEN || type === LogMetricType.FILE_CLOSE;
}

/**
 * 辅助函数：检查某个类型是否是关闭操作
 * @param type - 活动类型字符串
 * @returns 如果是关闭操作（文件关闭或窗口失去焦点）返回 true
 */
export function isCloseAction(type: string) {
    return type === LogMetricType.FILE_CLOSE || type === LogMetricType.WINDOW_LOSE;
}

// --------------------------------------------------------------------------------
// register

/**
 * 构建日志指标监听器映射表
 * 这是核心函数，为 Obsidian 的各种事件创建对应的监听器
 * 
 * @param data_store - 数据存储文件的路径
 * @returns 事件名称到回调函数的映射表（Map<事件名, 处理函数>）
 * 
 * 工作原理：
 * 1. 创建一个 Map，key 是 Obsidian 事件名称（如 "workspace-file-open"）
 * 2. value 是对应的回调函数，负责将事件转换为 ActivityRecord 并记录
 * 3. 使用 Set 进行去重，避免短时间内重复记录同一文件
 * 
 * 使用方式：
 * 在插件初始化时调用此函数获取监听器映射，然后将这些监听器注册到 Obsidian 的事件系统中
 */
export function buildLogMetricListener(data_store: string): Map<string, Callback> {
    const handlerMap = new Map<string, Callback>();

    // 监听器 1: 文件打开事件
    // 当用户在编辑器中打开文件时触发（可能同时打开多个文件）
    handlerMap.set("workspace-file-open", (params: any) => {
        let eventDataList = params as TFile[] // 事件参数是打开的文件数组
        const processedFiles = new Set<string>(); // 用于去重：避免重复记录同一个文件
        const result: ActivityRecord[] = []
        eventDataList.forEach(file => {
            const fileFulePath = buildFileAbsolutePath(file) // 构建文件的完整路径
            // 检查：只处理真正的文件，且没有被处理过的文件
            if (!(file instanceof TFile && !processedFiles.has(fileFulePath))) {
                return
            }

            // 创建文件打开的活动记录
            result.push({
                type: LogMetricType.FILE_OPEN,
                value: fileFulePath,
            });
            processedFiles.add(fileFulePath); // 标记为已处理
        });
        logMetrics(result, data_store) // 批量记录所有打开的文件

    });

    // 监听器 2: 文件修改事件
    // 当用户编辑并保存文件时触发
    handlerMap.set("vault-modify", (params: any) => {
        let eventDataList = params as TAbstractFile[]
        const processedFiles = new Set<string>();
        const result: ActivityRecord[] = [];
        eventDataList.forEach(file => {
            const fileFulePath = buildFileAbsolutePath(file)
            if (!(file instanceof TAbstractFile && !processedFiles.has(fileFulePath))) {
                return;
            }

            // 创建文件编辑的活动记录
            result.push({
                type: LogMetricType.FILE_EDIT, // Change to FILE_EDIT
                value: fileFulePath,
            });
            processedFiles.add(fileFulePath);
        });
        logMetrics(result, data_store);
    });

    // 监听器 3: 文件关闭事件
    // 当用户关闭编辑器中的文件时触发
    handlerMap.set("workspace-file-close", (params: any) => {
        let eventDataList = params as TFile[];
        const processedFiles = new Set<string>();
        const result: ActivityRecord[] = [];
        eventDataList.forEach(file => {
            const fileFulePath = buildFileAbsolutePath(file);
            if (!(file instanceof TFile && !processedFiles.has(fileFulePath))) {
                return;
            }

            // 创建文件关闭的活动记录
            result.push({
                type: LogMetricType.FILE_CLOSE,
                value: fileFulePath,
            });
            processedFiles.add(fileFulePath);
        });
        logMetrics(result, data_store);
    });

    // 监听器 4: 窗口获得焦点事件
    // 当用户从其他应用切换回 Obsidian 时触发
    handlerMap.set("window-focus", () => {
        const record: ActivityRecord = {
            type: LogMetricType.WINDOW_ACTIVE,
        };
        logMetrics([record], data_store);
    });

    // 监听器 5: 窗口失去焦点事件
    // 当用户从 Obsidian 切换到其他应用时触发
    handlerMap.set("window-blur", () => {
        const record: ActivityRecord = {
            type: LogMetricType.WINDOW_LOSE,
        };
        logMetrics([record], data_store);
    });

    // 返回完整的监听器映射表，供外部注册使用
    return handlerMap
}

/**
 * 构建文件的绝对路径
 * 将 Obsidian 的文件对象转换为完整的文件路径字符串
 * 
 * @param file - Obsidian 的文件对象（TAbstractFile 或 TFile）
 * @returns 文件的完整路径（例如："/notes/folder/file.md"）
 */
function buildFileAbsolutePath(file: TAbstractFile): string {
    return path.join(file.path, file.name)
}