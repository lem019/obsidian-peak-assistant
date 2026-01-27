/**
 * @file template-engine-helper.ts
 * @description 模板引擎辅助函数注册。
 * 集中管理所有 Handlebars 模板使用的自定义 Helper 函数（如时间格式化、逻辑判断等）。
 */

import Handlebars from 'handlebars';
import { humanReadableTime } from '@/core/utils/date-utils';

/**
 * Register global Handlebars helpers
 * 
 * 注册全局模板辅助函数。
 */
export function registerTemplateEngineHelpers() {
    // Register global Handlebars helpers
    // 时间格式化：将时间戳转换为易读格式
    Handlebars.registerHelper('humanReadableTime', function (timestamp: number) {
        return timestamp ? humanReadableTime(timestamp) : 'N/A';
    });
    // 相等判断：用于模板内的条件分支
    Handlebars.registerHelper('eq', function (a, b) {
        return a === b;
    });
}
