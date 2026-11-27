import { afterEach, describe, expect, it, vi } from 'vitest';
import { providers, requestAI } from './ai';
import { archive, changeThinkingMode, defaultSettings, editVersion, newIdea, userMessage } from './data';
import type { AIAction, Provider } from './types';
const result = { reply: '最希望解决哪个问题？', title: '行动方案', markdown: '## 目标\n完成一个原型。' };
const settings = (provider: Provider = 'deepseek') => ({ ...structuredClone(defaultSettings), provider, keys: { deepseek: 'test-key', minimax: 'test-key' } });
const idea = () => ({ ...newIdea('测试灵感'), messages: [userMessage('做一个原型')] });
function respond(content = JSON.stringify(result), status = 200, finishReason = 'stop') {
  const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ choices: [{ finish_reason: finishReason, message: { content } }] }), { status }));
  vi.stubGlobal('fetch', fetcher); return fetcher;
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('模型请求与上下文', () => {
  it.each(['deepseek', 'minimax'] as const)('%s 的简洁模式使用短回复引导，详细模式与方案保持原提示', async provider => {
    const i = idea(); i.mode = 'concise'; const fetcher = respond();
    await requestAI(i, settings(provider), 'chat');
    const concise = JSON.parse(fetcher.mock.calls[0][1].body).messages[0].content;
    expect(concise).toContain('通常只回复 1–3 句'); expect(concise).toContain('用户最新输入明确要求展开');
    i.mode = 'detailed'; await requestAI(i, settings(provider), 'chat');
    expect(JSON.parse(fetcher.mock.calls[1][1].body).messages[0].content).not.toContain('当前为简洁模式');
    i.mode = 'silent'; await requestAI(i, settings(provider), 'archive');
    const archivePrompt = JSON.parse(fetcher.mock.calls[2][1].body).messages[0].content;
    expect(archivePrompt).toContain('生成方案草稿'); expect(archivePrompt).not.toContain('当前为简洁模式');
  });
  it('静默聊天在请求层也不会调用服务', async () => {
    const i = idea(); i.mode = 'silent'; const fetcher = respond();
    await expect(requestAI(i, settings(), 'chat')).rejects.toThrow('静默模式'); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['deepseek', 'minimax'] as const)('使用 %s 独立参数和密钥', async provider => {
    const fetcher = respond(); await expect(requestAI(idea(), settings(provider), 'chat')).resolves.toEqual({ reply: result.reply, title: '', markdown: '' });
    const [url, init] = fetcher.mock.calls[0]; const body = JSON.parse(init.body);
    expect(url).toBe(providers[provider].url); expect(init.headers.Authorization).toBe('Bearer test-key');
    expect(body.model).toBe(defaultSettings.models[provider]); expect(body.stream).toBe(false);
    if (provider === 'deepseek') { expect(body.thinking.type).toBe('disabled'); expect(body.response_format).toBeUndefined(); }
    else { expect(body.reasoning_split).toBe(true); expect(body.response_format).toBeUndefined(); expect(body.thinking).toBeUndefined(); }
    expect(init.body).not.toContain('test-key');
  });
  it('始终发送完整当前时间线及最新方案，排除旧快照和其它灵感', async () => {
    const i = idea();
    const first = archive(i, { title: 'V1', content: 'old plan', createdAt: i.createdAt, snapshot: [userMessage('PRIVATE OLD SNAPSHOT')] });
    const second = archive(first, { title: 'V2', content: 'latest plan', createdAt: i.createdAt, snapshot: first.messages });
    const edited = editVersion(second, second.versions[0].id, '修改 V1', 'PRIVATE EDITED V1');
    edited.messages.push(userMessage('继续当前时间线'));
    const fetcher = respond(); await requestAI(edited, settings(), 'chat');
    const body = JSON.parse(fetcher.mock.calls[0][1].body); const payload = JSON.parse(body.messages[1].content);
    expect(payload.conversation.map((m: { content: string }) => m.content)).toEqual(['做一个原型', '继续当前时间线']);
    expect(payload.latest_plan).toEqual({ version: 2, title: 'V2', markdown: 'latest plan' });
    expect(fetcher.mock.calls[0][1].body).not.toContain('PRIVATE');
  });
  it('未发送输入不进入归档上下文', async () => {
    const i = idea(); i.input = 'PRIVATE UNSENT INPUT'; const fetcher = respond();
    await requestAI(i, settings(), 'archive'); expect(fetcher.mock.calls[0][1].body).not.toContain('PRIVATE UNSENT INPUT');
  });
  it('没有密钥时不发送请求', async () => {
    const fetcher = respond(); await expect(requestAI(idea(), defaultSettings, 'chat')).rejects.toThrow('密钥'); expect(fetcher).not.toHaveBeenCalled();
  });
});
describe('失败、取消与输出验证', () => {
  it.each([[401, '密钥'], [402, '余额'], [429, '频繁'], [500, '不可用']] as const)('HTTP %s 清晰报错且不自动重试', async (status, message) => {
    const fetcher = respond('', status); await expect(requestAI(idea(), settings(), 'chat')).rejects.toThrow(message); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([['{"reply":', 'chat'], [JSON.stringify({ ...result, reply: '' }), 'chat'], [JSON.stringify({ ...result, markdown: '' }), 'archive'], [JSON.stringify({ ...result, reply: 5 }), 'chat']] as const)('拒绝无效结果 %s', async (content, action: AIAction) => {
    respond(content); await expect(requestAI(idea(), settings(), action)).rejects.toThrow(/无效|不完整|没有返回|缺少/);
  });
  it('不保存截断结果', async () => { respond(JSON.stringify(result), 200, 'length'); await expect(requestAI(idea(), settings(), 'archive')).rejects.toThrow('截断'); });
  it('提供网络和 CORS 提示', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed'))); await expect(requestAI(idea(), settings(), 'chat')).rejects.toThrow(/网络|跨域/);
  });
  it('读取响应体时取消请求', async () => {
    const external = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => ({ ok: true, json: () => new Promise((_resolve, reject) => { init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))); external.abort(); }) })));
    await expect(requestAI(idea(), settings(), 'chat', { signal: external.signal })).rejects.toThrow('已取消');
  });
  it('90 秒超时中止请求', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
    vi.stubGlobal('fetch', fetcher); const pending = expect(requestAI(idea(), settings(), 'chat')).rejects.toThrow('超时');
    await vi.advanceTimersByTimeAsync(90_000); await pending; expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('有效回复不应因包装格式丢失', () => {
  it('chat 的有效 reply 不需要归档专用字段', async () => {
    respond(JSON.stringify({ reply: '先确定目标用户，再验证最小功能。' }));
    await expect(requestAI(idea(), settings(), 'chat')).resolves.toEqual({ reply: '先确定目标用户，再验证最小功能。', title: '', markdown: '' });
  });
  it('chat 可以接收原生 Markdown，不要求 JSON 包装', async () => {
    respond('我们先从两个问题开始：\n\n1. 谁会使用它？\n2. 它解决什么问题？');
    await expect(requestAI(idea(), settings(), 'chat')).resolves.toMatchObject({ reply: '我们先从两个问题开始：\n\n1. 谁会使用它？\n2. 它解决什么问题？' });
  });
  it('archive 的有效方案不需要对话专用 reply 字段', async () => {
    respond(JSON.stringify({ title: '小程序方案', markdown: '## 目标\n完成可使用的原型。' }));
    await expect(requestAI(idea(), settings(), 'archive')).resolves.toEqual({ reply: '', title: '小程序方案', markdown: '## 目标\n完成可使用的原型。' });
  });
});

it('DeepSeek 对话不启用 JSON 模式，归档启用两字段 JSON 模式', async () => {
  const fetcher = respond(); await requestAI(idea(), settings(), 'chat');
  const chat = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(chat.response_format).toBeUndefined(); expect(chat.messages[0].content).toContain('不要用 JSON 包装');
  await requestAI(idea(), settings(), 'archive');
  const planRequest = JSON.parse(fetcher.mock.calls[1][1].body);
  expect(planRequest.response_format).toEqual({ type: 'json_object' }); expect(planRequest.messages[0].content).toContain('无需 reply 字段');
});
it('MiniMax 接收完整 Markdown 方案，不依赖 JSON 模式', async () => {
  const fetcher = respond('# 产品原型方案\n\n## 目标\n验证最小流程。\n\n## 步骤\n- [ ] 开始实现');
  await expect(requestAI(idea(), settings('minimax'), 'archive')).resolves.toEqual({ reply: '', title: '产品原型方案', markdown: '## 目标\n验证最小流程。\n\n## 步骤\n- [ ] 开始实现' });
  const body = JSON.parse(fetcher.mock.calls[0][1].body); expect(body.response_format).toBeUndefined(); expect(body.messages[0].content).toContain('第一行为 #');
});
it('修复 JSON 字符串中未转义的换行，保持内容原样且不重复请求', async () => {
  const fetcher = respond('{"reply":"先验证目标。\n\n再写一个原型。"}');
  await expect(requestAI(idea(), settings(), 'chat')).resolves.toEqual({ reply: '先验证目标。\n\n再写一个原型。', title: '', markdown: '' });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each(['', '   ', '<think>private reasoning</think>', '<think>unfinished private reasoning'])('不显示空回复或推理内容 %s', async content => {
  respond(content); await expect(requestAI(idea(), settings(), 'chat')).rejects.toThrow(/正文/);
});
it('忽略已完成的思考段，只展示回答正文', async () => {
  respond('<think>PRIVATE INTERNAL REASONING</think>\n这是回答正文。');
  await expect(requestAI(idea(), settings('minimax'), 'chat')).resolves.toEqual({ reply: '这是回答正文。', title: '', markdown: '' });
});
it('完整代码示例不会被当成内部 JSON 回复误报', async () => {
  const code = '```json\n{"hello":"world"}\n```'; respond(code);
  await expect(requestAI(idea(), settings(), 'chat')).resolves.toMatchObject({ reply: code });
});
it('兼容只包含标题与正文的归档回复，即使无关字段类型不同', async () => {
  respond(JSON.stringify({ title: '行动方案', markdown: '## 目标\n制作原型。', reply: null }));
  await expect(requestAI(idea(), settings(), 'archive')).resolves.toEqual({ reply: '', title: '行动方案', markdown: '## 目标\n制作原型。' });
});
it('Markdown 空标题后没有正文时不能归档', async () => {
  respond('# 一个方案标题'); await expect(requestAI(idea(), settings('minimax'), 'archive')).rejects.toThrow('方案正文');
});

describe('所选 skill 实际进入请求', () => {
  it.each(['deepseek', 'minimax'] as const)('%s 的教员对话与归档都包含 skill、所有参考资料和应用边界', async provider => {
    const i = changeThinkingMode(idea(), 'mao-selected-works'); i.mode = 'concise';
    const fetcher = respond();
    for (const action of ['chat', 'archive'] as const) await requestAI(i, settings(provider), action);
    for (const [index, call] of fetcher.mock.calls.entries()) {
      const body = JSON.parse(call[1].body); const system = body.messages[0].content;
      expect(system).toContain('当前思维模式：教员');
      for (const file of ['SKILL.md', 'patterns.md', 'cheatsheet.md', 'glossary.md', 'chapters/ch01-volume-one.md', 'chapters/ch02-volume-two.md', 'chapters/ch03-volume-three.md', 'chapters/ch04-volume-four.md']) expect(system).toContain(`资料：${file}`);
      expect(system).toContain('矛盾的主要方面'); expect(system).toContain('框架不适用时明确指出'); expect(system).toContain('未提供 EPUB 原著');
      const context = JSON.parse(body.messages[1].content);
      expect(context.thinking_mode).toBe('mao-selected-works');
      expect(context.conversation.at(-1)).toMatchObject({ role: 'mode-change', thinking_mode: 'mao-selected-works' });
      if (index === 0) expect(system).toContain('通常只回复 1–3 句');
      else { expect(system).toContain('验收标准'); expect(system).not.toContain('当前为简洁模式'); }
    }
  });
  it('切回默认不再发送教员资料，历史记录与当时模式仍保留', async () => {
    const teacher = changeThinkingMode(idea(), 'mao-selected-works');
    teacher.messages.push({ id: 'reply-id', role: 'assistant', content: '先调查', createdAt: teacher.createdAt, thinkingMode: 'mao-selected-works' });
    const i = changeThinkingMode(teacher, 'default'); const fetcher = respond();
    await requestAI(i, settings(), 'chat');
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.messages[0].content).toContain('当前思维模式：默认');
    expect(body.messages[0].content).not.toContain('资料：'); expect(body.messages[0].content).toContain('不覆盖本次选择');
    const payload = JSON.parse(body.messages[1].content);
    expect(payload.thinking_mode).toBe('default'); expect(payload.conversation[2].thinking_mode).toBe('mao-selected-works');
    expect(payload.conversation.map((m: { content: string }) => m.content)).toEqual(i.messages.map(m => m.content));
  });
  it('请求长度计算包含模式资料，过长时不调用服务', async () => {
    const i = idea(); i.messages = [userMessage('问'.repeat(110_000))]; const fetcher = respond();
    await requestAI(i, settings(), 'chat');
    await expect(requestAI(changeThinkingMode(i, 'mao-selected-works'), settings(), 'chat')).rejects.toThrow('模式资料超过');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('资料加载前或加载期间取消，均不发送付费模型请求', async () => {
    const i = changeThinkingMode(idea(), 'mao-selected-works'); const fetcher = respond();
    const before = new AbortController(); before.abort();
    await expect(requestAI(i, settings(), 'chat', { signal: before.signal })).rejects.toThrow('已取消');
    const during = new AbortController(); const pending = requestAI(i, settings(), 'chat', { signal: during.signal }); during.abort();
    await expect(pending).rejects.toThrow('已取消'); expect(fetcher).not.toHaveBeenCalled();
  });
});
