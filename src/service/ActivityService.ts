
/**
 * ============================================================================
 * 文件说明: ActivityService.ts - 用户活动记录服务
 * ============================================================================
 * 
 * 【这个文件是干什么的】
 * 这个文件负责记录和加载用户在 Obsidian 中的活动数据。它就像一个"行为日志本"，
 * 记录用户打开了哪些文件、编辑了什么、窗口是否在激活状态等信息。
 * 
 * 【起了什么作用】
 * 1. 活动记录 (Activity Logging): 将用户的操作行为（打开文件、编辑、关闭等）
 *    写入到本地文件中，每条记录都带有时间戳
 * 2. 数据持久化: 使用文件系统将活动数据保存为 JSON 格式，一行一条记录
 * 3. 数据加载: 从文件中读取历史活动记录，供统计分析使用
 * 4. 基础数据源: 为 DailyStatisticsService 提供用户行为数据，用于统计每日工作情况
 * 
 * 【举例介绍】
 * 例如，当用户在 Obsidian 中：
 * - 打开 "工作笔记.md" 文件时，会记录一条 FileOpen 事件
 * - 编辑该文件时，会记录 FileEdit 事件
 * - 切换到其他应用时，会记录 WindowLose 事件
 * - 回到 Obsidian 时，会记录 WindowActive 事件
 * 
 * 这些记录最终形成一个时间线，帮助插件统计用户的工作时长、编辑的文件数量等信息。
 * 例如通过分析这些记录，可以知道用户今天在哪个笔记上花的时间最多，
 * 或者什么时间段最活跃。
 * 
 * 【技术实现】
 * - 使用 Node.js 的 fs 模块进行文件读写
 * - 数据格式：每行一个 JSON 对象，包含时间戳、事件类型、相关文件路径等
 * - 时间格式：YYYYMMDD-HH:mm:ss（例如：20260124-14:30:45）
 * ============================================================================
 */

import * as fs from 'fs';
import * as path from 'path';
import moment from 'moment';

// 活动记录的类型，是一个字符串（如 "FileOpen", "FileEdit" 等）
// 活动记录的类型，是一个字符串（如 "FileOpen", "FileEdit" 等）
export type ActivityRecordType = string;

/**
 * 活动记录接口 - 待记录的活动数据结构
 * 这是"原始"的活动记录，还没有加上时间戳
 */
export interface ActivityRecord {
    // record type name. eg: OpenEditor. OpenFile
    // 记录类型名称，比如 "FileOpen"（打开文件）、"FileEdit"（编辑文件）
    type: ActivityRecordType;
    // eg: which file for OpenFile recordType
    // 记录的值，例如：对于 FileOpen 类型，这里存储文件路径
    value?: string;
    // record desc.
    // 记录的描述信息（可选）
    desc?: string;
}

/**
 * 已完成的活动记录接口 - 带时间戳的完整记录
 * 这是"已完成"的活动记录，已经添加了时间戳，可以写入文件
 */
export interface ActivityRecordAchieved {
    // "YYYYMMDD-HH:mm:ss"
    // 记录的时间戳，格式：YYYYMMDD-HH:mm:ss（如 "20260124-14:30:45"）
    time: string;
    // record type name. eg: OpenEditor
    // 记录类型名称
    type: string;
    // eg: which file for OpenFile recordType
    // 记录的值（可选）
    value?: string;
    // record desc.
    // 记录的描述（可选）
    desc?: string;
}

/**
 * 记录单条活动指标
 * 这是一个便捷函数，用于记录单个活动事件
 * 
 * @param record - 要记录的活动数据
 * @param data_store - 数据存储文件的路径（例如："/path/to/activity.log"）
 * 
 * 例如：logMetric({ type: "FileOpen", value: "笔记.md" }, "/data/activity.log")
 */
export function logMetric(record: ActivityRecord, data_store: string) {
    // 内部调用 logMetrics，将单条记录包装成数组
    logMetrics([record], data_store)
}

/**
 * 批量记录多条活动指标
 * 这个函数是核心的记录函数，负责将活动数据写入文件
 * 
 * @param records - 要记录的活动数据数组
 * @param data_store - 数据存储文件的路径
 * 
 * 工作流程：
 * 1. 确保存储目录存在（如果不存在则创建）
 * 2. 将每条记录转换为带时间戳的完整记录
 * 3. 转换为 JSON 字符串并追加到文件末尾
 */
export function logMetrics(records: ActivityRecord[], data_store: string) {
    // Ensure the directory for the data store exists
    // 确保数据存储的目录存在，如果不存在则递归创建整个目录路径
    const directory = path.dirname(data_store);
    if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory, { recursive: true });
    }

    // Convert each record to JSON string and add newline, then concatenate into final string
    // 将每条记录转换为 JSON 字符串并添加换行符，然后拼接成最终字符串
    // 这样做的好处是：每行一个 JSON 对象，方便逐行读取和解析
    const recordString = records
        .map(record => JSON.stringify(convertToAchieved(record)) + '\n') // Convert and add newline for each record
        .join(''); // Concatenate into final string

    // Append the record to the specified file
    // 将记录追加到指定文件（使用追加模式，不会覆盖已有内容）
    fs.appendFile(data_store, recordString, (err) => {
        if (err) {
            console.error(`Error writing to file ${data_store}:`, err);
        }
        else {
            console.log(`Record logged successfully to ${data_store}`);
        }
    });
}

/**
 * 将原始活动记录转换为带时间戳的完整记录
 * 这个函数为记录添加当前时间戳，使其成为可以存储的完整记录
 * 
 * @param record - 原始活动记录（没有时间戳）
 * @returns 带时间戳的完整活动记录
 */
function convertToAchieved(record: ActivityRecord): ActivityRecordAchieved {
    return {
        time: formatDate(new Date()), // 添加当前时间的格式化字符串
        type: record.type,
        value: record.value,
        desc: record.desc,
    };
}

/**
 * Formats a Date object to a string in the "YYYYMMDD-HH:mm:ss" format
 * 将 Date 对象格式化为 "YYYYMMDD-HH:mm:ss" 格式的字符串
 * 
 * @param date - The date to format / 要格式化的日期对象
 * @returns The formatted string / 格式化后的字符串（例如："20260124-14:30:45"）
 */
function formatDate(date: Date): string {
    return moment(date).format('YYYYMMDD-HH:mm:ss');
}

/**
 * 从数据存储文件中加载活动记录条目
 * 这个函数读取之前记录的所有活动数据，用于后续的统计分析
 * 
 * @param data_store - 数据存储文件的路径
 * @returns 活动记录数组，如果文件不存在或解析失败则返回空数组
 * 
 * 工作流程：
 * 1. 检查文件是否存在
 * 2. 读取文件内容
 * 3. 按行分割
 * 4. 解析每行的 JSON 数据
 * 5. 过滤掉无效的记录
 */
export function loadMetricEntries(data_store: string): ActivityRecordAchieved[] {
    // Ensure the data_store file exists
    // 确保数据存储文件存在，如果不存在则返回空数组
    if (!fs.existsSync(data_store)) {
        console.error(`Data store file does not exist: ${data_store}`);
        return [];
    }

    // Read the file and parse each line as JSON
    // 读取文件并将每一行解析为 JSON 对象
    const fileContent = fs.readFileSync(data_store, 'utf-8');
    const entries: ActivityRecordAchieved[] = fileContent
        .split('\n') // Split the content by new lines / 按换行符分割内容，得到每一行
        .filter(line => line.trim() !== '') // Remove empty lines / 移除空行
        .map(line => {
            try {
                return JSON.parse(line) as ActivityRecordAchieved; // Parse each line / 解析每一行的 JSON
            } catch (error) {
                console.error(`Error parsing line: ${line}`, error);
                return null; // Return null for invalid lines / 对于无效行返回 null
            }
        })
        .filter(entry => entry !== null) as ActivityRecordAchieved[]; // Filter out null entries / 过滤掉 null 条目

    return entries; // Return the array of parsed entries / 返回解析后的条目数组
}