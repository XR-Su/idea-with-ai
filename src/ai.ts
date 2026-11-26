import type { AIAction, AIResult, Idea, Settings } from './types';
export const providers = {
  deepseek: { name: 'DeepSeek', url: 'https://api.deepseek.com/chat/completions', console: 'https://platform.deepseek.com/api_keys' },
  minimax: { name: 'MiniMax', url: 'https://api.minimax.cn/v1/chat/completions', console: 'https://platform.minimaxi.com' },
};
const SYSTEM = `你是一个帮助用户把灵感变成可执行方案的思考伙伴。默认用自然、简洁的中文回答。
想法模糊时，先理解用户要创造什么或解决什么，以及动机、约束、目标用户和成功标准；每次只追问一到三个当前最关键的问题。问题清晰时直接给出分析、建议和下一步，不强迫用户完成固定问卷。用户可以要求直接给方案。
区分用户确认的事实、你提出的建议和待确认假设，绝不把建议写成已确认决定。不捏造需求、数据、调查结果或已经完成的工作。你只能讨论与制定计划，不声称替用户执行了操作。
所有会话沿唯一时间线持续进行。latest_plan 是最近归档版本当前编辑后的正文，作为相关背景；conversation 是唯一的当前会话。历史快照不是新的对话，不进行版本分叉。优先采用最新的用户修正。
用户独自决定何时归档。不要自动归档，不暗示聊天回复已经保存成方案版本。
你的输出必须是一个合法 JSON 对象，三个字符串字段始终存在：{"reply":"","title":"","markdown":""}。不要输出思考过程或 JSON 之外的文本。
action=chat：reply 为自然的对话回复，可用 Markdown；title 和 markdown 为空字符串。
action=archive：reply 为空；title 为简洁中文方案标题；markdown 为完整可执行方案的 Markdown 正文（从二级标题开始，避免重复一级标题）。包括：目标、问题背景、关键决策、分阶段执行步骤（检查项）、验收标准、待确认事项。任务写清楚动作与产出，依赖和风险只在相关时列出。信息少则缩短方案，缺失项标为待确认，不能擅自补成事实。只根据当前对话与最新方案生成草稿。`;
export type RequestOptions = { signal?: AbortSignal; endpoint?: string; timeoutMs?: number };
export async function requestAI(idea: Idea, settings: Settings, action: AIAction, options: RequestOptions = {}): Promise<AIResult> {
  const key = settings.keys[settings.provider].trim();
  if (!key) throw new Error('请先在 AI 设置中填写当前服务商的 API 密钥。');
  const latest = idea.versions.at(-1);
  const context = JSON.stringify({ action, idea_title: idea.title,
    latest_plan: latest ? { version: latest.number, title: latest.title, markdown: latest.content } : null,
    conversation: idea.messages.map(m => ({ role: m.role, content: m.content })),
  });
  if (context.length > 120_000) throw new Error('当前会话超过单次请求长度限制。内容已保留，可先导出备份，再新建会话延续想法。');
  const controller = new AbortController();
  const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) controller.abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? 90_000);
  const cancelError = () => new Error(timedOut ? 'AI 请求超时，内容已保留。请稍后手动重试。' : '已取消请求，内容已保留。');
  const endpoint = options.endpoint ?? providers[settings.provider].url;
  try {
    let response: Response;
    try {
      response = await fetch(endpoint, { method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: settings.models[settings.provider].trim(), messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: context }], stream: false,
          ...(settings.provider === 'deepseek' ? { thinking: { type: 'disabled' }, response_format: { type: 'json_object' }, max_tokens: 6000 }
            : { reasoning_effort: 'low', reasoning_split: true, max_completion_tokens: 6000 }),
        }),
      });
    } catch {
      if (controller.signal.aborted) throw cancelError();
      throw new Error('无法连接 AI 服务。请检查网络或服务商的浏览器跨域支持；内容已保留。');
    }
    if (!response.ok) {
      const errors: Record<number, string> = { 400: '模型或请求参数被拒绝，请检查设置中的模型名称。', 401: 'API 密钥无效，请检查当前服务商的密钥。', 402: 'AI 账户余额不足。', 403: '没有调用权限，请检查账户和模型权限。', 422: '请求参数不被当前模型支持。', 429: '请求过于频繁，请稍后手动重试。' };
      throw new Error(errors[response.status] || `AI 服务暂时不可用（${response.status}），请稍后重试。`);
    }
    const data = await response.json();
    if (!data || typeof data !== 'object') throw new Error('AI 返回格式无效，请手动重试。');
    if (data.base_resp?.status_code) throw new Error('AI 服务拒绝请求，请检查密钥、余额与权限。');
    const choice = data.choices?.[0];
    if (choice?.finish_reason === 'length') throw new Error('AI 输出被截断，未保存不完整结果。请重试或减少单次内容。');
    const content = choice?.message?.content;
    if (typeof content !== 'string') throw new Error('AI 返回格式无效，请手动重试。');
    const result: unknown = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
    if (!result || typeof result !== 'object') throw new Error('AI 返回格式无效，请手动重试。');
    const r = result as Record<string, unknown>;
    if (['reply', 'title', 'markdown'].some(k => typeof r[k] !== 'string') || (action === 'chat' && !(r.reply as string).trim()) || (action === 'archive' && (!(r.title as string).trim() || !(r.markdown as string).trim()))) throw new Error('AI 返回格式无效，请手动重试。');
    if (controller.signal.aborted) throw cancelError();
    return { reply: r.reply as string, title: r.title as string, markdown: r.markdown as string };
  } catch (error) {
    if (controller.signal.aborted) throw cancelError();
    if (error instanceof SyntaxError) throw new Error('AI 返回内容不是有效的 JSON，请手动重试。');
    throw error;
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', cancel); }
}
