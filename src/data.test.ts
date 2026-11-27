import { beforeEach, describe, expect, it } from 'vitest';
import { archive, archiveDraftIsStale, backup, changeThinkingMode, DATA_KEY, defaultSettings, editVersion, exportMarkdown, loadIdeas, loadSettings, mergeBackup, newIdea, parseBackup, saveSettings, SETTINGS_KEY, userMessage } from './data';
import type { ArchiveDraft } from './types';
beforeEach(() => localStorage.clear());
function draftFor(text: string): ArchiveDraft { return { title: '行动方案', content: text, createdAt: new Date().toISOString(), snapshot: [userMessage('先做一个原型')] }; }
describe('单一会话与版本', () => {
  it('归档追加版本且不修改持续会话，编辑 V1 不影响快照或 V2', () => {
    const idea = newIdea('原始灵感'); idea.messages = [userMessage('先做一个原型')];
    const first = archive(idea, { ...draftFor('## 目标\n完成原型'), snapshot: idea.messages });
    const secondMessage = userMessage('再加上导出');
    const ongoing = { ...first, messages: [...first.messages, secondMessage] };
    const second = archive(ongoing, { ...draftFor('## 目标\n完成导出'), snapshot: ongoing.messages });
    const edited = editVersion(second, first.versions[0].id, '修订方案', '编辑后的 V1');
    expect(edited.versions.map(v => v.number)).toEqual([1, 2]);
    expect(edited.messages).toEqual(ongoing.messages);
    expect(edited.versions[0].snapshot).toEqual(idea.messages);
    expect(edited.versions[1]).toEqual(second.versions[1]);
    expect(first.versions[0].content).toBe('## 目标\n完成原型');
    // Snapshot copies must not share message objects with mutable conversation state.
    expect(first.versions[0].snapshot[0]).not.toBe(idea.messages[0]);
  });
  it('空标题或正文无法归档或保存', () => {
    const i = newIdea(); expect(() => archive(i, draftFor(' '))).toThrow();
    expect(() => editVersion(i, 'invalid', ' ', 'test')).toThrow();
  });
});
describe('导出和恢复', () => {
  it('模式和静默内容随备份恢复，旧数据默认详细且不会产生恢复副本', () => {
    const i = newIdea('模式测试'); i.mode = 'silent'; i.messages = [userMessage('记录内容', true)];
    expect(parseBackup(JSON.stringify(backup([i])))).toEqual([i]);
    const legacy = { ...i, messages: [userMessage('旧内容')] } as Partial<typeof i>; delete legacy.mode;
    const restored = parseBackup(JSON.stringify(backup([legacy as typeof i])));
    expect(restored[0].mode).toBe('detailed'); expect(mergeBackup([legacy as typeof i], restored)).toHaveLength(1);
    expect(() => parseBackup(JSON.stringify(backup([{ ...i, mode: 'invalid' } as unknown as typeof i])))).toThrow();
  });
  it('完整备份往返保留草稿、版本、快照和输入；冲突保留两份', () => {
    const i = archive(newIdea('灵感'), draftFor('## 步骤\n- [ ] 执行'));
    i.input = '尚未发送'; i.archiveDraft = draftFor('还没确认');
    const restored = parseBackup(JSON.stringify(backup([i])));
    expect(restored).toEqual([i]);
    expect(mergeBackup([i], restored)).toHaveLength(1);
    const changed = { ...restored[0], title: '另一设备修改' };
    const merged = mergeBackup([i], [changed]);
    expect(merged).toHaveLength(2); expect(merged[1].id).not.toBe(i.id); expect(merged[0]).toEqual(i);
  });
  it('拒绝无效文件和重复版本号，损坏存储不会自动覆盖', () => {
    expect(() => parseBackup('{bad')).toThrow();
    expect(() => parseBackup(JSON.stringify({ version: 1, ideas: [] }))).toThrow();
    const i = archive(newIdea(), draftFor('方案'));
    i.versions.push({ ...i.versions[0], id: 'another' });
    expect(() => parseBackup(JSON.stringify(backup([i])))).toThrow();
    localStorage.setItem(DATA_KEY, 'broken');
    expect(loadIdeas().error).not.toBe(''); expect(localStorage.getItem(DATA_KEY)).toBe('broken');
  });
  it('只导出所选版本，并按需附带该版本的会话快照', () => {
    const i = archive(newIdea(), draftFor('V1 正文'));
    const next = archive(i, draftFor('V2 正文'));
    expect(exportMarkdown(next.versions[0], false)).toContain('V1 正文');
    expect(exportMarkdown(next.versions[0], false)).not.toContain('V2 正文');
    expect(exportMarkdown(next.versions[0], false)).not.toContain('先做一个原型');
    expect(exportMarkdown(next.versions[0], true)).toContain('先做一个原型');
  });
});
describe('密钥配置', () => {
  it('默认不持久保存密钥，关闭记住后移除两家密钥', () => {
    const s = structuredClone(defaultSettings); s.keys.deepseek = 'TEST_ONLY'; s.keys.minimax = 'OTHER_TEST';
    saveSettings(s); expect(localStorage.getItem(SETTINGS_KEY)).not.toContain('TEST_ONLY');
    s.rememberKeys = true; saveSettings(s); expect(loadSettings().keys).toEqual(s.keys);
    s.rememberKeys = false; saveSettings(s); expect(loadSettings().keys.deepseek).toBe(''); expect(loadSettings().keys.minimax).toBe('');
    expect(JSON.stringify(backup([newIdea()]))).not.toContain('TEST_ONLY');
  });
});

describe('思维模式与历史兼容', () => {
  it('切换保留旧消息并记录位置，重复选择不产生记录', () => {
    const i = newIdea('项目推进'); i.messages = [userMessage('原始情况')];
    const selected = changeThinkingMode(i, 'mao-selected-works');
    expect(i.thinkingMode).toBe('default'); expect(i.messages).toHaveLength(1);
    expect(selected.messages[0]).toEqual(i.messages[0]);
    expect(selected.messages[1]).toMatchObject({ role: 'mode-change', thinkingMode: 'mao-selected-works', content: '思维模式已切换为教员' });
    expect(changeThinkingMode(selected, 'mao-selected-works')).toBe(selected);
  });
  it('旧备份恢复为默认模式，与迁移后的数据合并不产生副本', () => {
    const i = newIdea('旧记录'); const legacy = { ...i } as Partial<typeof i>; delete legacy.thinkingMode;
    const restored = parseBackup(JSON.stringify(backup([legacy as typeof i])));
    expect(restored[0].thinkingMode).toBe('default');
    expect(mergeBackup([legacy as typeof i], restored)).toHaveLength(1);
  });
  it('模式、切换记录、历史回答及归档模式随备份和 Markdown 保存', () => {
    const selected = changeThinkingMode(newIdea('模式备份'), 'mao-selected-works');
    selected.messages.push(userMessage('如何推进'), { id: 'reply-id', role: 'assistant', content: '先调查实际障碍。', createdAt: selected.createdAt, thinkingMode: 'mao-selected-works', collapsed: true });
    const draft = { ...draftFor('阶段方案'), snapshot: selected.messages, thinkingMode: selected.thinkingMode };
    const archived = archive(selected, draft); archived.archiveDraft = draft;
    expect(parseBackup(JSON.stringify(backup([archived])))).toEqual([archived]);
    const markdown = exportMarkdown(archived.versions[0], true);
    expect(markdown).toContain('思维模式：教员'); expect(markdown).toContain('思维模式切换'); expect(markdown).toContain('AI · 教员');
    const changed = changeThinkingMode(archived, 'default');
    expect(changed.versions[0]).toEqual(archived.versions[0]);
  });
  it('切换或新增讨论使草稿过期，切回原模式也必须重新生成', () => {
    const i = newIdea(); i.messages = [userMessage('情况')];
    i.archiveDraft = { ...draftFor('原方案'), snapshot: i.messages };
    expect(archiveDraftIsStale(i)).toBe(false);
    expect(archiveDraftIsStale({ ...i, thinkingMode: 'mao-selected-works' })).toBe(true);
    const switched = changeThinkingMode(i, 'mao-selected-works');
    expect(archiveDraftIsStale(switched)).toBe(true);
    expect(archiveDraftIsStale(changeThinkingMode(switched, 'default'))).toBe(true);
    expect(archiveDraftIsStale({ ...i, messages: [userMessage('另一条讨论')] })).toBe(true);
  });
  it('拒绝未知模式和缺少模式的切换标记，防止导入后错误解释历史', () => {
    const i = newIdea();
    const invalid = [
      { ...i, thinkingMode: 'unknown' },
      { ...i, messages: [{ ...userMessage('切换'), role: 'mode-change' }] },
      { ...i, messages: [{ ...userMessage('回答'), role: 'assistant', thinkingMode: 'unknown' }] },
      { ...i, archiveDraft: { ...draftFor('正文'), thinkingMode: 'unknown' } },
      { ...archive(i, draftFor('正文')), versions: [{ ...archive(i, draftFor('正文')).versions[0], thinkingMode: 'unknown' }] },
    ];
    for (const value of invalid) expect(() => parseBackup(JSON.stringify(backup([value as typeof i])))).toThrow('数据格式无效');
  });
});

it('折叠状态随备份和旧数据恢复，拒绝用户消息和非法折叠字段', () => {
  const i = newIdea('折叠备份'); i.messages = [{ id: 'ai', role: 'assistant', content: '完整回复', createdAt: i.createdAt, collapsed: true }];
  const saved = archive(i, { title: '方案', content: '正文', createdAt: i.createdAt, snapshot: i.messages });
  expect(parseBackup(JSON.stringify(backup([saved])))).toEqual([saved]);
  expect(() => parseBackup(JSON.stringify(backup([{ ...i, messages: [{ ...i.messages[0], collapsed: false }] } as unknown as typeof i])))).toThrow();
  expect(() => parseBackup(JSON.stringify(backup([{ ...i, messages: [{ ...i.messages[0], role: 'user' }] } as typeof i])))).toThrow();
});
