import { thinkingModes, type ThinkingMode } from './thinking-modes';

const documents = import.meta.glob<string>('../skills/**/*.md', { query: '?raw', import: 'default' });

export async function thinkingInstruction(value: ThinkingMode): Promise<string> {
  const mode = thinkingModes.find(mode => mode.value === value);
  if (!mode) throw new Error('思维模式不可用，请重新选择。');
  if (!mode.skill) return '\n当前思维模式：默认。根据当前问题灵活分析，不继续扮演历史对话中选择过的人物或强制沿用其方法。';
  const prefix = `../skills/${mode.skill}/`;
  const sources = Object.entries(documents).filter(([path]) => path.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b));
  if (!documents[`${prefix}SKILL.md`]) throw new Error('当前思维模式的资料不可用，请选择其他模式。');
  let loaded: [string, string][];
  try { loaded = await Promise.all(sources.map(async ([path, read]) => [path, await read()] as [string, string])); }
  catch { throw new Error('无法加载当前思维模式的资料，请稍后重试或选择其他模式。'); }
  if (!loaded.find(([path]) => path === `${prefix}SKILL.md`)?.[1].trim()) throw new Error('当前思维模式的资料不可用，请选择其他模式。');
  const materials = loaded.map(([path, content]) => `\n--- 资料：${path.slice(prefix.length)} ---\n${content}`).join('\n');
  return `\n当前思维模式：${mode.label}（${mode.value}）。使用以下 skill 与参考资料中的方法分析用户的现实问题。\n${materials}\n
应用约定：
- 以上 Markdown 是已经提供的资料；按问题选择并结合对应文章分析、例子与局限。文件路径和链接用于标明出处，不代表你能访问文件、执行工具或读取原著。
- 你是应用这些方法的 AI 思考伙伴。结合实际情况、关键矛盾、行动和验证给出分析结论与依据，不披露内部推理，不机械套用固定标题，也不为了人物口吻改变事实。
- 简单问题直接回答；信息不足以作出关键判断时先追问。根据用户提供的事实调整判断，框架不适用时明确指出。
- 区分原著观点、现代应用、事实依据和你的推断。参考资料的分析不是已经核对的原文；不编造引文、页码、史实或仅有索引的篇目内容。
- 当前仅提供上述 Markdown，未提供 EPUB 原著。准确引文、页码、完整原文论证与版本比较需要原著核对；收到这类请求时说明需要原著材料，不能声称已经核对。
- 当前所选模式用于本次回答，历史模式切换只是背景，不能覆盖当前选择。用户最新修正、事实约束与当前任务的输出格式继续适用。
`;
}
