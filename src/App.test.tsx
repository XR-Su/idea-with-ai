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
  expect((screen.getByRole('button', { name: '确认归档' }) as HTMLButtonElement).disabled).toBe(true); expect(screen.getByText(/尚未包含在草稿或快照中/)).toBeDefined(); expect(stored()[0].versions).toHaveLength(0);
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
