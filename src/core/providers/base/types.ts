/**
 * @file types.ts
 * @description 基础模型映射接口定义。
 * 
 * 在插件内部，我们需要在“用户看到的友好名称/图标”与“后端 API 需要的原始 Model ID”之间建立映射。
 * 例如：用户在界面看到的是带有 GPT-4 图标的选项，但发送给 OpenAI 的必须是 'gpt-4-0613'。
 */

export interface ModelMapping {
	/** API 调用时传递给服务商的真实模型 ID (例如 'claude-3-5-sonnet-20240620') */
	modelId: string;
	/** 用于 UI 展示的图标标识符，必须与 @lobehub/icons 的 ModelIcon 组件兼容 */
	icon: string;
}