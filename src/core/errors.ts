/**
 * @file errors.ts
 * @description 业务错误定义与处理工具。
 * 定义了插件特有的异常代码（ErrorCode）和错误类（BusinessError），
 * 并提供工具函数将复杂的程序错误转换为用户友好的提示信息。
 */

/**
 * Business error codes for application errors
 * 
 * 业务错误代码。用于标识错误的具体类型。
 */
export enum ErrorCode {
	/** 模型不可用：通常是 API Key 无效或网络问题 */
	MODEL_UNAVAILABLE = 'MODEL_UNAVAILABLE',
	/** 服务商未找到：配置了不存在或未启用的 Provider */
	PROVIDER_NOT_FOUND = 'PROVIDER_NOT_FOUND',
	/** 配置缺失：必要的插件设置项为空 */
	CONFIGURATION_MISSING = 'CONFIGURATION_MISSING',
	/** SQLite 向量扩展未加载：导致无法执行向量搜索 */
	SQLITE_VEC_EXTENSION_NOT_LOADED = 'SQLITE_VEC_EXTENSION_NOT_LOADED',
	/** 向量嵌入表缺失：索引损坏或未初始化 */
	VEC_EMBEDDINGS_TABLE_MISSING = 'VEC_EMBEDDINGS_TABLE_MISSING',
	/** 未知错误 */
	UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * Default error message when model/service is unavailable
 * 
 * 当模型不可用时的默认提示语。
 */
export const MODEL_UNAVAILABLE_MESSAGE = 'Model is currently unavailable. Please check your settings and ensure the provider is properly configured.';

/**
 * Custom error class for business errors
 * 
 * 业务异常类。继承自 Error，增加可识别的错误代码（code）。
 */
export class BusinessError extends Error {
	constructor(
		public readonly code: ErrorCode,
		message: string,
		cause?: Error
	) {
		super(message);
		this.name = 'BusinessError';
		if (cause) {
			this.cause = cause;
		}
	}
}

/**
 * Get user-friendly error message from an error
 * 
 * 工具函数：从捕获到的 error 对象中提取用户友好的提示文字。
 */
export function getErrorMessage(error: unknown): string {
	// 针对业务错误的特殊处理
	if (error instanceof BusinessError) {
		if (error.code === ErrorCode.MODEL_UNAVAILABLE || 
			error.code === ErrorCode.CONFIGURATION_MISSING ||
			error.code === ErrorCode.PROVIDER_NOT_FOUND) {
			return MODEL_UNAVAILABLE_MESSAGE;
		}
		return error.message;
	}
	
	// 针对标准 Error 对象的处理
	if (error instanceof Error) {
		return error.message;
	}
	
	// 兜底：直接转换为字符串
	return String(error);
}


