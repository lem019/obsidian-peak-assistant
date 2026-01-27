/**
 * @file ScriptLoader.ts
 * @description 脚本加载与执行器。
 * 支持从指定目录加载多种格式的自动化脚本：
 * 1. Markdown 文件：提取带有特定元数据的代码块执行。
 * 2. JS/TS 文件：作为模块加载并执行导出函数。
 * 3. Python 文件：通过子进程调用执行。
 * 核心功能是建立“事件 -> 脚本回调”的映射关系，实现插件的插件化扩展。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

export type Callback<T = any> = (context: T) => void;

/**
 * Load all script files from specified directory and register callback functions based on events
 * 
 * 加载指定目录下的所有脚本并建立事件映射。
 * 遍历文件夹，识别对应的文件扩展名，并调用相应的处理器。
 */
export function loadScriptsForEvent(directoryPath: string): Map<string, Callback[]> {
  // console.log('directoryPath: ', directoryPath);

  const handlerMap = new Map<string, Callback[]>();
  const files = getAllFiles(directoryPath);
  // console.log("scriptFolder files: ", files);

  files.forEach((file) => {
    const filePath = file;
    const fileExtension = path.extname(file).toLowerCase();

    switch (fileExtension) {
      case '.md':
        mergeHandlerMaps(handlerMap, registerMarkdownCallback(filePath));
        break;
      case '.js':
      case '.ts':
      case '.py':
        mergeHandlerMaps(handlerMap, registerScriptCallback(filePath));
        break;
      default:
        console.log(`Unsupported file format: ${fileExtension}, file: ${file}`);
    }
  });

  return handlerMap;
}

/**
 * Recursively find all files in a directory
 * 
 * 递归获取目录下所有文件。
 */
function getAllFiles(directoryPath: string): string[] {
  let files: string[] = [];
  const items = fs.readdirSync(directoryPath);

  items.forEach((item) => {
    const itemPath = path.join(directoryPath, item);
    const itemStat = fs.statSync(itemPath);

    if (itemStat.isDirectory()) {
      // If it's a folder, recurse
      files = files.concat(getAllFiles(itemPath));
    } else {
      // If it's a file, add to file list
      files.push(itemPath);
    }
  });

  return files;
}

/**
 * Merge new handlerMap into total handlerMap
 * 
 * 合并两个处理器映射表。
 */
function mergeHandlerMaps(targetMap: Map<string, Callback[]>, sourceMap: Map<string, Callback[]>): void {
  sourceMap.forEach((callbacks, eventName) => {
    const existingCallbacks = targetMap.get(eventName) || [];
    targetMap.set(eventName, existingCallbacks.concat(callbacks));
  });
}

/**
 * Detect if event type is specified from first line of code block
 * 
 * 从代码第一行提取事件名称标志（PeakAssistantEvent: event-name）。
 */
function extractEventMatchFromCodeFirstLine(lineStr:string) {
  return lineStr.match(/PeakAssistantEvent:\s*(\S+)/i);
}

/**
 * Register callback for qualified Markdown files
 * 
 * 解析 Markdown 文件。
 * 必须包含 YAML Frontmatter 且其中定义了 PeakAssistantEvent 字段。
 */
function registerMarkdownCallback(filePath: string): Map<string, Callback[]> {
  let handlerMap = new Map<string, Callback[]>();
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const yamlMatch = fileContent.match(/^---\n([\s\S]*?)\n---/);

  if (!yamlMatch) {
    return handlerMap
  }

  const yamlContent = yaml.load(yamlMatch[1]) as { PeakAssistantEvent?: string };
  if (yamlContent.PeakAssistantEvent) {
    handlerMap = allMarkdownCodeBlocksExecutableScripts(fileContent)
  }

  return handlerMap;
}

/**
 * Register callback for qualified script files
 * 
 * 解析 JS/TS/PY 脚本文件。
 * 文件首行必须包含事件定义注释。
 */
function registerScriptCallback(filePath: string): Map<string, Callback[]> {
  const handlerMap = new Map<string, Callback[]>();
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const firstLine = fileContent.split('\n')[0].trim();
  const eventMatch = extractEventMatchFromCodeFirstLine(firstLine);
  // console.log(filePath);
  // console.log(eventMatch);

  if (!eventMatch) {
    return handlerMap
  }

  const eventName = eventMatch[1];
  const callbacks = handlerMap.get(eventName) || [];
  callbacks.push((context) => executeScriptFile(filePath, context));
  handlerMap.set(eventName, callbacks);

  return handlerMap;
}

/**
 * Execute code blocks in Markdown file
 * 
 * 提取并准备执行 Markdown 中的代码块。
 * 支持标准 Markdown (```js) 和 Templater 语法 (<%* ... %>)。
 */
function allMarkdownCodeBlocksExecutableScripts(fileContent: string): Map<string, Callback[]> {
  const handlerMap = new Map<string, Callback[]>();
  // Match code blocks in Markdown file
  const codeBlocks = fileContent.match(/```([\s\S]*?)```|<%[\s\S]*?-%>/g);

  if (!codeBlocks) {
    return handlerMap
  }

  // console.log('executeMarkdownCodeBlocks: ', codeBlocks);

  codeBlocks.forEach((codeBlock) => {
    let code: string | null = null;

    // Handle Obsidian Templater syntax
    if (codeBlock.startsWith('<%*')) {
      code = codeBlock.replace(/^<%\*[\s\S]*?\n?/, '').replace(/-%>$/, '').trim();
    } else {
      // Remove ``` and language type from Markdown code block
      code = codeBlock.replace(/```[\s\S]*?\n/, '').replace(/```/g, '').trim();
    }
    // console.log(code);

    if (!code) {
      return
    }

    // Only execute JavaScript code blocks
    // Can add further checks for code language type as needed
    // For example, check if it's JavaScript code
    const isJavaScript = /```[\s\S]*?(javascript|js|typescript|ts)[\s\S]*?\n/.test(codeBlock) || codeBlock.startsWith('<%*');
    if (!isJavaScript) {
      return
    }

    const firstLine = fileContent.split('\n')[0].trim();
    const eventMatch = extractEventMatchFromCodeFirstLine(firstLine);
    if (!eventMatch) {
      return
    }
    const eventName = eventMatch[1];
    const callbacks = handlerMap.get(eventName) || [];
    // callbacks.push((context) => executeJavaScriptCode(code, context));
    handlerMap.set(eventName, callbacks);
  });

  return handlerMap
}


/**
 * Execute JavaScript, TypeScript files
 * 
 * 执行 JS/TS 脚本文件。使用 CommonJS 的 require 机制加载。
 */
function executeScriptFile(filePath: string, context: any) {
  if (filePath.endsWith('.js') || filePath.endsWith('.ts')) {
    const script = require(filePath);
    if (typeof script === 'function') {
      script(context);
    }
  } else if (filePath.endsWith('.py')) {
    executePythonFile(filePath, context);
  }
}

/**
 * Execute Python file
 * 
 * 执行 Python 脚本。
 * 通过 shell 调用子进程实现，并将 context 作为 JSON 字符串通过命令行参数传递。
 */
function executePythonFile(filePath: string, context: any) {
  const { execSync } = require('child_process');
  try {
    const contextString = JSON.stringify(context);
    const result = execSync(`python ${filePath} '${contextString}'`, { stdio: 'pipe' });
    console.log(`executePythonFile: ${filePath}, result: `, result.toString());
  } catch (error) {
    console.error(`Python script execution failed: `, error);
  }
}

/**
 * Execute JavaScript code in code blocks
 * 
 * 使用 new Function 动态执行提取出来的 JS 代码块。
 */
function executeJavaScriptCode(code: string, context: any) {
  try {
    const func = new Function('context', code);
    func(context);
  } catch (error) {
    console.error(`JavaScript code block execution failed:`, error);
  }
}
