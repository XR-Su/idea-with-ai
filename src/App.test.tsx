import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';
import * as ai from './ai';
import * as data from './data';
import { archive, DATA_KEY, defaultSettings, newIdea, saveSettings, userMessage } from './data';
import type { AIResult, Idea } from './types';
const reply: AIResult = { reply: '你最希望解决什么问题？', title: '', markdown: '' };
const plan: AIResult = { reply: '', title: '第一版行动方案', markdown: '## 目标\n完成一个原型。\n\n## 执行步骤\n- [ ] 验证核心流程。' };
beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function(this: HTMLDialogElement) { this.removeAttribute('open'); } });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function stored(): Idea[] { return JSON.parse(localStorage.getItem(DATA_KEY)!); }
function configure() { saveSettings({ ...structuredClone(defaultSettings), rememberKeys: true, keys: { deepseek: 'test-only', minimax: '' } }); }
function openIdea(title: string) { fireEvent.click(within(screen.getByRole('navigation', { name: '会话列表' })).getByRole('button', { name: new RegExp(title) })); }
function send(text: string) {
  fireEvent.change(screen.getByRole('textbox', { name: '会话输入' }), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
}
function withVersions(): Idea {
  const idea = newIdea('测试灵感'); idea.messages = [userMessage('最初的讨论')];
  const v1 = archive(idea, { title: '方案一', content: 'V1 方案正文', createdAt: idea.createdAt, snapshot: idea.messages });
  v1.messages.push(userMessage('第二阶段讨论'));
  return archive(v1, { title: '方案二', content: 'V2 方案正文', createdAt: idea.createdAt, snapshot: v1.messages });
}
it('静默输入无需配置 AI，可连续保存；切回后主动回应包含全部内容', async () => {
  const request = vi.spyOn(ai, 'requestAI').mockResolvedValue(reply);
  render(<App />); fireEvent.click(screen.getByRole('button', { name: /新建灵感/ }));
  expect((screen.getByRole('radio', { name: '详细' }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole('radio', { name: '静默' })); send('先记录目标');
  fireEvent.change(screen.getByRole('textbox', { name: '会话输入' }), { target: { value: '再记录约束' } });
  fireEvent.keyDown(screen.getByRole('textbox', { name: '会话输入' }), { key: 'Enter', ctrlKey: true });
  expect(stored()[0].messages.map(m => m.content)).toEqual(['先记录目标', '再记录约束']);
  expect(stored()[0].input).toBe(''); expect(request).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.queryByRole('button', { name: /AI 回应|AI 回复/ })).toBeNull();
  cleanup(); configure(); render(<App />); openIdea(stored()[0].title);
  expect((screen.getByRole('radio', { name: '静默' }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole('radio', { name: '简洁' })); expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '让 AI 回应' })); await screen.findByText(reply.reply);
  expect(request.mock.calls[0][0].mode).toBe('concise');
  expect(request.mock.calls[0][0].messages.map(m => m.content)).toEqual(['先记录目标', '再记录约束']);
  expect(stored()[0].messages).toHaveLength(3);
});
it('每个会话独立记住模式，切回详细后发送新消息包含静默内容', async () => {
  configure(); const one = newIdea('静默会话'); const two = newIdea('详细会话');
  localStorage.setItem(DATA_KEY, JSON.stringify([one, two]));
  const request = vi.spyOn(ai, 'requestAI').mockResolvedValue(reply);
  render(<App />); openIdea(one.title); fireEvent.click(screen.getByRole('radio', { name: '静默' })); send('积累的想法');
  openIdea(two.title); expect((screen.getByRole('radio', { name: '详细' }) as HTMLInputElement).checked).toBe(true);
  openIdea(one.title); expect((screen.getByRole('radio', { name: '静默' }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole('radio', { name: '详细' })); expect(request).not.toHaveBeenCalled(); send('现在请帮我分析');
  await screen.findByText(reply.reply);
  expect(request.mock.calls[0][0].messages.map(m => m.content)).toEqual(['积累的想法', '现在请帮我分析']);
});
it('AI 请求期间禁用模式切换，取消后可以进入静默并隐藏聊天重试', () => {
  configure(); vi.spyOn(ai, 'requestAI').mockImplementation(() => new Promise(() => {}));
  render(<App />); fireEvent.click(screen.getByRole('button', { name: /新建灵感/ })); send('请帮我分析');
  expect(screen.getByRole('radio', { name: '静默' }).closest('fieldset')?.disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(screen.getByRole('radio', { name: '静默' }).closest('fieldset')?.disabled).toBe(false);
  fireEvent.click(screen.getByRole('radio', { name: '静默' }));
  expect(screen.queryByRole('button', { name: '继续 / 重试 AI 回复' })).toBeNull(); expect(stored()[0].mode).toBe('silent');
});
it('静默期间主动生成方案仍可调用 AI，失败后保留方案重试入口', async () => {
  configure(); const i = newIdea('静默方案'); i.mode = 'silent'; i.messages = [userMessage('只记录想法', true)];
  localStorage.setItem(DATA_KEY, JSON.stringify([i]));
  const request = vi.spyOn(ai, 'requestAI').mockRejectedValueOnce(new Error('方案生成失败')).mockResolvedValue(plan);
  render(<App />); openIdea(i.title); fireEvent.click(screen.getByRole('button', { name: '生成归档草稿' }));
  await screen.findByText('方案生成失败'); fireEvent.click(screen.getByRole('button', { name: '重试生成方案' }));
  await screen.findByRole('dialog'); expect(request.mock.calls.map(call => call[2])).toEqual(['archive', 'archive']);
  expect(stored()[0].archiveDraft?.content).toBe(plan.markdown); expect(stored()[0].mode).toBe('silent');
});
it('无需配置 AI 即可捕获灵感并自动保存未发送输入', () => {
  const request = vi.spyOn(ai, 'requestAI'); render(<StrictMode><App /></StrictMode>);
  fireEvent.change(screen.getByRole('textbox', { name: '新灵感内容' }), { target: { value: '做一个种花提醒工具' } });
  fireEvent.click(screen.getByRole('button', { name: '先记下来' }));
  expect(stored()[0].input).toBe('做一个种花提醒工具'); expect(stored()[0].messages).toHaveLength(0); expect(request).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('textbox', { name: '会话输入' }), { target: { value: '稍后补充的想法' } });
  expect(stored()[0].input).toBe('稍后补充的想法');
});
it('AI 失败和重试只保留一条用户消息，回复成功后追加 AI 消息', async () => {
  configure(); const request = vi.spyOn(ai, 'requestAI').mockRejectedValueOnce(new Error('模拟网络失败')).mockResolvedValue(reply);
  render(<App />); fireEvent.click(screen.getByRole('button', { name: /新建灵感/ })); send('给植物定期浇水');
  await screen.findByText('模拟网络失败'); expect(stored()[0].messages).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '继续 / 重试 AI 回复' }));
  await screen.findByText(reply.reply); expect(stored()[0].messages.map(m => m.role)).toEqual(['user', 'assistant']); expect(request).toHaveBeenCalledTimes(2);
});
it('重新打开只有未回复消息的会话后可以继续请求，不重复发送原文', async () => {
  configure(); const i = newIdea('未回复灵感'); i.messages = [userMessage('等待回复的内容')]; localStorage.setItem(DATA_KEY, JSON.stringify([i]));
  const request = vi.spyOn(ai, 'requestAI').mockResolvedValue(reply); render(<App />); openIdea(i.title);
  fireEvent.click(screen.getByRole('button', { name: '继续 / 重试 AI 回复' })); await screen.findByText(reply.reply);
  expect(stored()[0].messages.filter(m => m.role === 'user')).toHaveLength(1); expect(request).toHaveBeenCalledTimes(1);
});
it('AI 生成仅保存草稿，关闭后可继续编辑，确认才创建 V1', async () => {
  configure(); const i = newIdea('需要归档的想法'); i.messages = [userMessage('记录灵感')]; localStorage.setItem(DATA_KEY, JSON.stringify([i]));
  vi.spyOn(ai, 'requestAI').mockResolvedValue(plan); render(<App />); openIdea(i.title);
  fireEvent.click(screen.getByRole('button', { name: '生成归档草稿' })); await screen.findByRole('dialog');
  expect(stored()[0].versions).toHaveLength(0); expect(stored()[0].archiveDraft?.content).toBe(plan.markdown);
  fireEvent.change(screen.getByRole('textbox', { name: /方案正文/ }), { target: { value: '我修改后的草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '稍后继续' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '继续编辑草稿' }));
  expect((screen.getByRole('textbox', { name: /方案正文/ }) as HTMLTextAreaElement).value).toBe('我修改后的草稿');
  fireEvent.click(screen.getByRole('button', { name: '确认归档' }));
  expect(stored()[0].versions).toHaveLength(1); expect(stored()[0].versions[0].content).toBe('我修改后的草稿'); expect(stored()[0].messages).toEqual(i.messages); expect(stored()[0].archiveDraft).toBeUndefined();
});
it('打开 V1、查看快照、编辑方案后继续当前时间线，下一次归档为 V3', async () => {
  configure(); const i = withVersions(); localStorage.setItem(DATA_KEY, JSON.stringify([i]));
  const request = vi.spyOn(ai, 'requestAI').mockResolvedValueOnce(reply).mockResolvedValueOnce(plan);
  render(<App />); openIdea(i.title); fireEvent.click(screen.getByRole('button', { name: /方案版本/ }));
  fireEvent.change(screen.getByRole('combobox', { name: '选择方案版本' }), { target: { value: i.versions[0].id } });
  fireEvent.click(screen.getByRole('button', { name: '讨论快照' }));
  const modal = screen.getByRole('dialog'); expect(within(modal).getByText('最初的讨论')).toBeDefined(); expect(within(modal).queryByText('第二阶段讨论')).toBeNull(); expect(within(modal).queryByRole('textbox')).toBeNull();
  fireEvent.click(within(modal).getByRole('button', { name: '关闭弹窗' }));
  fireEvent.click(screen.getByRole('button', { name: '编辑方案' }));
  fireEvent.change(screen.getByRole('textbox', { name: /方案正文/ }), { target: { value: '修订 V1 正文' } });
  fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
  expect(stored()[0].versions[0].snapshot).toEqual(i.versions[0].snapshot); expect(stored()[0].versions[1]).toEqual(i.versions[1]);
  fireEvent.click(screen.getByRole('button', { name: '继续当前会话' })); send('第三阶段讨论'); await screen.findByText(reply.reply);
  expect(request.mock.calls[0][0].messages.map(m => m.content)).toEqual(['最初的讨论', '第二阶段讨论', '第三阶段讨论']);
  fireEvent.click(screen.getByRole('button', { name: '生成归档草稿' })); await screen.findByRole('dialog'); fireEvent.click(screen.getByRole('button', { name: '确认归档' }));
  expect(stored()[0].versions.map(v => v.number)).toEqual([1, 2, 3]); expect(stored()[0].versions[2].snapshot).toHaveLength(4); expect(stored()[0].versions[0].content).toBe('修订 V1 正文');
});
it('草稿生成后新增讨论，必须更新草稿后才能归档', () => {
  const i = newIdea('过期草稿'); const initial = userMessage('旧讨论'); i.messages = [initial, userMessage('新讨论')]; i.archiveDraft = { title: '旧草稿', content: '旧内容', createdAt: i.createdAt, snapshot: [initial] };
  localStorage.setItem(DATA_KEY, JSON.stringify([i])); render(<App />); openIdea(i.title);
  fireEvent.click(screen.getByRole('button', { name: '继续编辑草稿' }));
  expect((screen.getByRole('button', { name: '确认归档' }) as HTMLButtonElement).disabled).toBe(true); expect(screen.getByText(/讨论内容已变化/)).toBeDefined(); expect(stored()[0].versions).toHaveLength(0);
});
it('切换会话会取消旧请求，迟到回复不能污染任何会话', async () => {
  configure(); const one = newIdea('会话一'); const two = newIdea('会话二'); localStorage.setItem(DATA_KEY, JSON.stringify([one, two]));
  let resolve!: (r: AIResult) => void; const request = vi.spyOn(ai, 'requestAI').mockImplementation(() => new Promise(r => { resolve = r; }));
  render(<App />); openIdea(one.title); send('第一条消息'); openIdea(two.title);
  expect(request.mock.calls[0][3]?.signal?.aborted).toBe(true);
  resolve(reply); await waitFor(() => expect(screen.queryByText(reply.reply)).toBeNull());
  expect(stored().find(i => i.id === one.id)?.messages).toHaveLength(1); expect(stored().find(i => i.id === two.id)?.messages).toHaveLength(0);
});
it('独立导出所选 V1，可选附带 V1 快照', () => {
  const i = withVersions(); localStorage.setItem(DATA_KEY, JSON.stringify([i])); const downloader = vi.spyOn(data, 'download').mockImplementation(() => {});
  render(<App />); openIdea(i.title); fireEvent.click(screen.getByRole('button', { name: /方案版本/ })); fireEvent.change(screen.getByRole('combobox', { name: '选择方案版本' }), { target: { value: i.versions[0].id } });
  fireEvent.click(screen.getByRole('button', { name: '导出 Markdown' })); expect(downloader.mock.calls[0][0]).toContain('V1 方案正文'); expect(downloader.mock.calls[0][0]).not.toContain('最初的讨论');
  fireEvent.click(screen.getByRole('checkbox', { name: '附带讨论' })); fireEvent.click(screen.getByRole('button', { name: '导出 Markdown' })); expect(downloader.mock.calls[1][0]).toContain('最初的讨论'); expect(downloader.mock.calls[1][0]).not.toContain('第二阶段讨论');
});
it('损坏本地存储时暂停写入，保留原始数据', () => {
  localStorage.setItem(DATA_KEY, '{broken'); render(<App />);
  expect(screen.getByText('本地保存已暂停')).toBeDefined(); expect((screen.getByRole('button', { name: /新建灵感/ }) as HTMLButtonElement).disabled).toBe(true); expect(localStorage.getItem(DATA_KEY)).toBe('{broken');
});
it('检测其它页面写入后停止保存，防止覆盖新数据', () => {
  const i = newIdea('测试灵感'); localStorage.setItem(DATA_KEY, JSON.stringify([i])); render(<App />); openIdea(i.title);
  const external = JSON.stringify([{ ...i, title: '其它页面的新标题' }]); localStorage.setItem(DATA_KEY, external);
  fireEvent.change(screen.getByRole('textbox', { name: '会话输入' }), { target: { value: '旧页面输入' } });
  expect(screen.getByText('本地保存已暂停')).toBeDefined(); expect(localStorage.getItem(DATA_KEY)).toBe(external);
});
it('删除需要确认，取消保留全部版本，确认移除会话及版本', () => {
  const i = withVersions(); localStorage.setItem(DATA_KEY, JSON.stringify([i])); render(<App />); openIdea(i.title);
  fireEvent.click(screen.getByRole('button', { name: '删除灵感' })); fireEvent.click(screen.getByRole('button', { name: '保留灵感' })); expect(stored()[0].versions).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: '删除灵感' })); fireEvent.click(screen.getByRole('button', { name: '确认删除' })); expect(stored()).toHaveLength(0);
});

it('普通 Markdown 对话经过真实解析后可展示，再按两字段回复生成方案草稿', async () => {
  configure();
  const fetcher = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '我们先确定最小功能。\n\n- 记录灵感\n- 导出方案' } }] })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ title: '最小功能方案', markdown: '## 目标\n验证捕获与导出。' }) } }] })));
  vi.stubGlobal('fetch', fetcher); render(<App />); fireEvent.click(screen.getByRole('button', { name: /新建灵感/ })); send('做一个灵感工具');
  await screen.findByText('我们先确定最小功能。');
  expect(screen.queryByRole('alert')).toBeNull(); expect(stored()[0].messages.map(m => m.role)).toEqual(['user', 'assistant']);
  fireEvent.click(screen.getByRole('button', { name: '生成归档草稿' })); await screen.findByRole('dialog');
  expect(stored()[0].archiveDraft?.title).toBe('最小功能方案'); expect(stored()[0].versions).toHaveLength(0); expect(fetcher).toHaveBeenCalledTimes(2);
});
it('会话顶部可收起并通过居中的标题展开，重新打开会话默认展开', () => {
  const idea = newIdea('固定顶部的会话');
  idea.messages = [userMessage('保留对话内容')];
  localStorage.setItem(DATA_KEY, JSON.stringify([idea]));
  render(<App />); openIdea(idea.title);
  fireEvent.change(screen.getByRole('textbox', { name: '会话输入' }), { target: { value: '尚未发送的内容' } });
  fireEvent.click(screen.getByRole('button', { name: '收起' }));
  expect(screen.queryByRole('group', { name: '会话与方案' })).toBeNull();
  expect(screen.getByText('灵感会话')).toBeTruthy();
  const title = screen.getByRole('button', { name: idea.title });
  expect(title.getAttribute('aria-expanded')).toBe('false');
  expect(screen.getByText('保留对话内容')).toBeTruthy();
  expect((screen.getByRole('textbox', { name: '会话输入' }) as HTMLTextAreaElement).value).toBe('尚未发送的内容');
  fireEvent.click(title);
  expect(screen.getByRole('group', { name: '会话与方案' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '收起' }));
  openIdea(idea.title);
  expect(screen.getByRole('group', { name: '会话与方案' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '收起' }).getAttribute('aria-expanded')).toBe('true');
});

function answeredIdea(): Idea {
  const idea = newIdea('回复操作测试');
  idea.messages = [userMessage('原始提问'), { id: 'assistant-one', role: 'assistant', content: '回复开头。' + '详细分析。'.repeat(40) + '回复末尾。', createdAt: idea.createdAt }];
  return idea;
}
it('AI 回复独立折叠，切换和刷新后保留，并可展开完整正文', () => {
  const i = answeredIdea(); const other = newIdea('另一个会话');
  i.messages.push({ id: 'assistant-two', role: 'assistant', content: '第二条回复', createdAt: i.createdAt });
  localStorage.setItem(DATA_KEY, JSON.stringify([i, other])); render(<App />); openIdea(i.title);
  fireEvent.click(screen.getAllByRole('button', { name: '折叠 AI 回复' })[0]);
  expect(screen.queryByText(/回复末尾/)).toBeNull(); expect(screen.getByText('第二条回复')).toBeDefined();
  expect(screen.getByRole('button', { name: '展开 AI 回复' }).getAttribute('aria-expanded')).toBe('false');
  expect(stored()[0].updatedAt).toBe(i.updatedAt);
  openIdea(other.title); openIdea(i.title); expect(screen.getByRole('button', { name: '展开 AI 回复' })).toBeDefined();
  cleanup(); render(<App />); openIdea(i.title); expect(screen.queryByText(/回复末尾/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '展开 AI 回复' })); expect(screen.getByText(/回复末尾/)).toBeDefined();
  expect(stored()[0].messages[1].collapsed).toBeUndefined();
});
it('删除需确认，保留提问和后续消息，下一次请求排除被删回复', async () => {
  configure(); const i = answeredIdea(); i.messages.push(userMessage('后续提问'));
  const archived = archive(i, { ...plan, content: '保留的归档正文', createdAt: i.createdAt, snapshot: i.messages });
  localStorage.setItem(DATA_KEY, JSON.stringify([archived]));
  const request = vi.spyOn(ai, 'requestAI').mockResolvedValue(reply); render(<App />); openIdea(i.title);
  fireEvent.click(screen.getByRole('button', { name: '删除 AI 回复' }));
  expect(screen.getByRole('dialog').textContent).toContain('回复开头'); expect(stored()[0].messages).toHaveLength(3);
  fireEvent.click(screen.getByRole('button', { name: '保留回复' })); expect(stored()[0].messages).toHaveLength(3);
  fireEvent.click(screen.getByRole('button', { name: '删除 AI 回复' })); fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
  expect(stored()[0].messages.map(m => m.content)).toEqual(['原始提问', '后续提问']);
  expect(stored()[0].versions).toEqual(archived.versions);
  fireEvent.click(screen.getByRole('button', { name: '继续 / 重试 AI 回复' })); await screen.findByText(reply.reply);
  expect(request.mock.calls[0][0].messages.map(m => m.content)).toEqual(['原始提问', '后续提问']);
});
it('删除末尾回复后可重试原提问，AI 请求中禁止删除但仍可折叠', async () => {
  configure(); const i = answeredIdea(); localStorage.setItem(DATA_KEY, JSON.stringify([i]));
  const request = vi.spyOn(ai, 'requestAI').mockImplementation(() => new Promise(() => {}));
  render(<App />); openIdea(i.title); send('新的提问');
  expect((screen.getByRole('button', { name: '删除 AI 回复' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '折叠 AI 回复' })); expect(screen.getByRole('button', { name: '展开 AI 回复' })).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect((screen.getByRole('button', { name: '删除 AI 回复' }) as HTMLButtonElement).disabled).toBe(false);
  cleanup(); localStorage.setItem(DATA_KEY, JSON.stringify([i])); request.mockResolvedValue(reply); render(<App />); openIdea(i.title);
  fireEvent.click(screen.getByRole('button', { name: '删除 AI 回复' })); fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
  fireEvent.click(screen.getByRole('button', { name: '继续 / 重试 AI 回复' })); await screen.findByText(reply.reply);
  expect(stored()[0].messages.filter(m => m.role === 'user')).toHaveLength(1);
  expect(request.mock.calls.at(-1)![0].messages.map(m => m.content)).toEqual(['原始提问']);
});
it('历史回复只允许折叠，独立保存状态且不改变导出正文和归档时间', () => {
  const i = answeredIdea(); const saved = archive(i, { title: '历史方案', content: '方案正文', createdAt: i.createdAt, snapshot: i.messages });
  localStorage.setItem(DATA_KEY, JSON.stringify([saved])); render(<App />); openIdea(i.title);
  fireEvent.click(screen.getByRole('button', { name: /方案版本/ })); fireEvent.click(screen.getByRole('button', { name: '讨论快照' }));
  const dialog = within(screen.getByRole('dialog')); expect(dialog.queryByRole('button', { name: '删除 AI 回复' })).toBeNull();
  fireEvent.click(dialog.getByRole('button', { name: '折叠 AI 回复' }));
  expect(stored()[0].messages[1].collapsed).toBeUndefined(); expect(stored()[0].versions[0].snapshot[1].collapsed).toBe(true);
  expect(stored()[0].versions[0].updatedAt).toBe(saved.versions[0].updatedAt);
  expect(data.exportMarkdown(stored()[0].versions[0], true)).toBe(data.exportMarkdown(saved.versions[0], true));
  cleanup(); render(<App />); openIdea(i.title); fireEvent.click(screen.getByRole('button', { name: /方案版本/ })); fireEvent.click(screen.getByRole('button', { name: '讨论快照' }));
  expect(within(screen.getByRole('dialog')).getByRole('button', { name: '展开 AI 回复' })).toBeDefined();
});
it('折叠不使草稿失效，删除并添加相同数量的消息后必须重新生成草稿', async () => {
  const i = answeredIdea(); i.archiveDraft = { title: '待归档', content: '草稿正文', createdAt: i.createdAt, snapshot: i.messages.map(m => ({ ...m })) };
  localStorage.setItem(DATA_KEY, JSON.stringify([i])); render(<App />); openIdea(i.title);
  fireEvent.click(screen.getByRole('button', { name: '折叠 AI 回复' })); fireEvent.click(screen.getByRole('button', { name: '继续编辑草稿' }));
  expect((screen.getByRole('button', { name: '确认归档' }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '稍后继续' })); fireEvent.click(screen.getByRole('button', { name: '删除 AI 回复' })); fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
  fireEvent.click(screen.getByRole('radio', { name: '静默' })); send('替换后的讨论');
  expect(stored()[0].messages).toHaveLength(i.archiveDraft.snapshot.length);
  fireEvent.click(screen.getByRole('button', { name: '继续编辑草稿' }));
  expect((screen.getByRole('button', { name: '确认归档' }) as HTMLButtonElement).disabled).toBe(true);
  configure(); cleanup(); const request = vi.spyOn(ai, 'requestAI').mockResolvedValue(plan); render(<App />); openIdea(i.title);
  fireEvent.click(screen.getByRole('button', { name: '继续编辑草稿' })); fireEvent.click(screen.getByRole('button', { name: '按最新讨论重新生成' }));
  await screen.findByRole('button', { name: '确认归档' });
  expect(request.mock.calls[0][0].messages.map(m => m.content)).toEqual(['原始提问', '替换后的讨论']);
  fireEvent.click(screen.getByRole('button', { name: '确认归档' })); expect(stored()[0].versions).toHaveLength(1);
});
it('删除确认时遇到其它页面修改数据，不覆盖数据且保留回复', () => {
  const i = answeredIdea(); localStorage.setItem(DATA_KEY, JSON.stringify([i])); render(<App />); openIdea(i.title);
  fireEvent.click(screen.getByRole('button', { name: '删除 AI 回复' }));
  const changed = JSON.stringify([{ ...i, title: '其它页面的新标题' }]); localStorage.setItem(DATA_KEY, changed);
  fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
  expect(localStorage.getItem(DATA_KEY)).toBe(changed); expect(screen.getByRole('dialog')).toBeDefined(); expect(screen.getByText(/回复末尾/)).toBeDefined();
  expect((screen.getByRole('button', { name: '确认删除' }) as HTMLButtonElement).disabled).toBe(true);
});
