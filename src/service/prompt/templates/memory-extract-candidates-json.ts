/**
 * ============================================================================
 * Memory candidate extraction prompt (JSON output).
 * 记忆候选项提取提示词（JSON 输出）
 * ============================================================================
 * 
 * 【模板作用】
 * 从一轮对话中自动提取值得长期记忆的信息（用户画像、偏好、习惯等）。
 * 就像一个智能记录员，从对话中捕捉关键信息并结构化存储。
 * 
 * 【输入变量】
 * - userMessage: 用户的消息（必需）
 * - assistantReply: AI 的回复（必需）
 * - context: 额外的上下文信息（可选）
 * 
 * 【输出格式】
 * JSON 数组，每个元素包含：
 * - text: 记忆陈述（简洁、具体）
 * - category: 分类（fact/preference/decision 等 10 种）
 * - confidence: 置信度分数（0-1）
 * 
 * 【分类说明】
 * 1. fact：个人事实（"我在学习日语"）
 * 2. preference：偏好（"我喜欢深色模式"）
 * 3. decision：重要决策（"我决定用 TypeScript"）
 * 4. habit：工作习惯（"我早上工作效率最高"）
 * 5. communication-style：沟通风格（"我喜欢简洁的回答"）
 * 6. work-pattern：工作模式（"我下午写代码"）
 * 7. tool-preference：工具偏好（"我用 VS Code 编码"）
 * 8. expertise-area：专业领域（"我擅长 React 开发"）
 * 9. response-style：回复风格偏好（"我喜欢详细解释"）
 * 10. other：其他稳定信息
 * 
 * 【使用场景】
 * 每次 AI 回复后，UserProfileService 会调用这个模板提取记忆候选项。
 * 
 * 【样例输入】
 * ```typescript
 * {
 *   userMessage: "我是一名前端开发者，主要用 React 和 TypeScript，喜欢简洁的代码风格",
 *   assistantReply: "了解了！作为前端开发者，我会为你提供 React 和 TypeScript 相关的建议..."
 * }
 * ```
 * 
 * 【样例输出】
 * ```json
 * [
 *   {
 *     "text": "用户是前端开发者",
 *     "category": "expertise-area",
 *     "confidence": 0.95
 *   },
 *   {
 *     "text": "用户主要使用 React 和 TypeScript",
 *     "category": "tool-preference",
 *     "confidence": 0.9
 *   },
 *   {
 *     "text": "用户偏好简洁的代码风格",
 *     "category": "preference",
 *     "confidence": 0.85
 *   }
 * ]
 * ```
 * 
 * 【注意事项】
 * - 只提取稳定、长期的信息，不包括临时性内容
 * - confidence < 0.7 的项会被过滤掉
 * - 返回的必须是纯粹的 JSON，不能包含其他文本
 * ============================================================================
 */
export const template = `Extract potential long-term memory items from this conversation exchange. Focus on:
- Personal facts (e.g., "I'm studying Japanese")
- Preferences (e.g., "I prefer dark mode")
- Important decisions (e.g., "I've decided to use TypeScript")
- Work habits (e.g., "I work best in the morning")
- Any stable, evergreen information the user wants remembered

{{#if context}}
{{#each context}}
{{@key}}: {{this}}
{{/each}}
{{/if}}

User: {{userMessage}}
Assistant: {{assistantReply}}

Return a JSON array of memory candidate objects, each with:
- "text": the memory statement (concise, specific)
- "category": one of "fact", "preference", "decision", "habit", "communication-style", "work-pattern", "tool-preference", "expertise-area", "response-style", "other"
- "confidence": 0-1 score indicating how certain this should be remembered

Category guide:
- "fact": Personal facts (e.g., "I'm studying Japanese")
- "preference": Preferences (e.g., "I prefer dark mode")
- "decision": Important decisions (e.g., "I've decided to use TypeScript")
- "habit": Work habits (e.g., "I work best in the morning")
- "communication-style": Communication preferences (e.g., "I prefer concise responses")
- "work-pattern": Work patterns (e.g., "I work best in the morning")
- "tool-preference": Tool preferences (e.g., "I use VS Code for coding")
- "expertise-area": Areas of expertise (e.g., "I'm experienced in React")
- "response-style": Response style preferences (e.g., "I prefer detailed explanations")
- "other": Other stable information

Example: [{"text": "I prefer dark mode for all applications", "category": "preference", "confidence": 0.9}]

Return only the JSON array, nothing else.`;

export const expectsJson = true;
export const jsonConstraint = 'Return only the JSON array, nothing else.';
