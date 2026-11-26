import { beforeEach, describe, expect, it } from 'vitest';
import { archive, backup, DATA_KEY, defaultSettings, editVersion, exportMarkdown, loadIdeas, loadSettings, mergeBackup, newIdea, parseBackup, saveSettings, SETTINGS_KEY, userMessage } from './data';
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
