import type { ArchiveDraft, Backup, Idea, Message, PlanVersion, Settings, ThinkingMode } from './types';
import { isThinkingMode, thinkingModeLabel } from './thinking-modes';
export const DATA_KEY = 'idea-with-ai.ideas.v1';
export const SETTINGS_KEY = 'idea-with-ai.settings.v1';
export const defaultSettings: Settings = {
  provider: 'deepseek', rememberKeys: false, keys: { deepseek: '', minimax: '' },
  models: { deepseek: 'deepseek-flash', minimax: 'MiniMax-M3.1-Flash' },
};
export function uid() { return crypto.randomUUID(); }
export function newIdea(text = ''): Idea {
  const now = new Date().toISOString();
  return { id: uid(), title: text.trim().slice(0, 32) || '未命名灵感', createdAt: now, updatedAt: now, messages: [], input: text, mode: 'detailed', thinkingMode: 'default', versions: [] };
}
export function userMessage(content: string, silent = false): Message { return { id: uid(), role: 'user', content: content.trim(), createdAt: new Date().toISOString(), ...(silent ? { silent: true } : {}) }; }
export function changeThinkingMode(idea: Idea, thinkingMode: ThinkingMode): Idea {
  if (thinkingMode === idea.thinkingMode) return idea;
  const now = new Date().toISOString();
  const marker: Message = { id: uid(), role: 'mode-change', content: `思维模式已切换为${thinkingModeLabel(thinkingMode)}`, createdAt: now, thinkingMode };
  return { ...idea, thinkingMode, updatedAt: now, messages: [...idea.messages, marker] };
}
// Presentation changes do not make a discussion or archive draft stale.
export function sameDiscussion(messages: Message[], snapshot: Message[]): boolean {
  return messages.length === snapshot.length && messages.every((m, index) => {
    const saved = snapshot[index];
    return m.id === saved.id && m.role === saved.role && m.content === saved.content && m.createdAt === saved.createdAt && m.silent === saved.silent && m.thinkingMode === saved.thinkingMode;
  });
}
export function archiveDraftIsStale(idea: Idea): boolean {
  const draft = idea.archiveDraft;
  return !!draft && ((draft.thinkingMode ?? 'default') !== idea.thinkingMode || !sameDiscussion(idea.messages, draft.snapshot));
}
export function archive(idea: Idea, draft: ArchiveDraft): Idea {
  if (!draft.title.trim() || !draft.content.trim()) throw new Error('请填写方案标题和正文。');
  const now = new Date().toISOString();
  const version: PlanVersion = {
    id: uid(), number: Math.max(0, ...idea.versions.map(v => v.number)) + 1,
    title: draft.title.trim(), content: draft.content.trim(), createdAt: now, updatedAt: now,
    snapshot: draft.snapshot.map(m => ({ ...m })),
    ...(draft.thinkingMode ? { thinkingMode: draft.thinkingMode } : {}),
  };
  return { ...idea, versions: [...idea.versions, version], archiveDraft: undefined, updatedAt: now };
}
export function editVersion(idea: Idea, id: string, title: string, content: string): Idea {
  if (!title.trim() || !content.trim()) throw new Error('请填写方案标题和正文。');
  const now = new Date().toISOString();
  return { ...idea, updatedAt: now, versions: idea.versions.map(v => v.id === id ? { ...v, title: title.trim(), content: content.trim(), updatedAt: now } : v) };
}
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string';
const date = (v: unknown) => str(v) && Number.isFinite(Date.parse(v));
const unique = (items: { id: string }[]) => new Set(items.map(v => v.id)).size === items.length;
function validMessages(v: unknown): v is Message[] {
  return Array.isArray(v) && v.every(m => obj(m) && str(m.id) && !!m.id && ['user', 'assistant', 'mode-change'].includes(String(m.role)) && str(m.content) && date(m.createdAt)
    && (m.silent === undefined || (m.silent === true && m.role === 'user'))
    && (m.thinkingMode === undefined || (m.role !== 'user' && isThinkingMode(m.thinkingMode)))
    && (m.role !== 'mode-change' || isThinkingMode(m.thinkingMode))
    && (m.collapsed === undefined || (m.collapsed === true && m.role === 'assistant'))) && unique(v);
}
function validDraft(v: unknown): v is ArchiveDraft {
  return obj(v) && str(v.title) && str(v.content) && date(v.createdAt) && validMessages(v.snapshot) && (v.thinkingMode === undefined || isThinkingMode(v.thinkingMode));
}
function validVersion(v: unknown): v is PlanVersion {
  return obj(v) && str(v.id) && !!v.id && typeof v.number === 'number' && Number.isSafeInteger(v.number) && v.number > 0 && date(v.updatedAt) && validDraft(v);
}
function validVersions(v: unknown): v is PlanVersion[] {
  return Array.isArray(v) && v.every(validVersion) && unique(v) && v.every((version, n) => n === 0 || version.number > v[n - 1].number);
}
export function validateIdeas(value: unknown): Idea[] {
  if (!Array.isArray(value) || !value.every(i => obj(i) && str(i.id) && !!i.id && str(i.title) && date(i.createdAt) && date(i.updatedAt) && str(i.input) && (i.mode === undefined || (str(i.mode) && ['silent', 'concise', 'detailed'].includes(i.mode))) && (i.thinkingMode === undefined || isThinkingMode(i.thinkingMode)) && validMessages(i.messages) && validVersions(i.versions) && (i.archiveDraft === undefined || validDraft(i.archiveDraft))) || !unique(value)) {
    throw new Error('数据格式无效。原有数据未被覆盖，请使用有效的拾念备份。');
  }
  // Rebuild validated objects so imported extra fields never enter application state.
  return value.map(i => ({ id: i.id, title: i.title, createdAt: i.createdAt, updatedAt: i.updatedAt,
    input: i.input, mode: i.mode ?? 'detailed', thinkingMode: i.thinkingMode ?? 'default', messages: i.messages.map(cleanMessage), versions: i.versions.map((v: PlanVersion) => ({
      id: v.id, number: v.number, updatedAt: v.updatedAt, ...cleanDraft(v),
    })), ...(i.archiveDraft ? { archiveDraft: cleanDraft(i.archiveDraft) } : {}),
  }));
}
function cleanMessage(m: Message): Message {
  const base = { id: m.id, content: m.content, createdAt: m.createdAt };
  if (m.role === 'mode-change') return { ...base, role: m.role, thinkingMode: m.thinkingMode };
  if (m.role === 'assistant') return { ...base, role: m.role, ...(m.thinkingMode ? { thinkingMode: m.thinkingMode } : {}), ...(m.collapsed ? { collapsed: true } : {}) };
  return { ...base, role: m.role, ...(m.silent ? { silent: true } : {}) };
}
function cleanDraft(draft: ArchiveDraft): ArchiveDraft {
  return { title: draft.title, content: draft.content, createdAt: draft.createdAt, snapshot: draft.snapshot.map(cleanMessage), ...(draft.thinkingMode ? { thinkingMode: draft.thinkingMode } : {}) };
}
export function loadIdeas(): { ideas: Idea[]; raw: string | null; error: string } {
  let raw: string | null = null;
  try { raw = localStorage.getItem(DATA_KEY); return { ideas: raw ? validateIdeas(JSON.parse(raw)) : [], raw, error: '' }; }
  catch { return { ideas: [], raw, error: '无法读取本地数据，已暂停写入以保护原始内容。请下载原始数据备份，或恢复有效备份。' }; }
}
export function loadSettings(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (!obj(s)) return structuredClone(defaultSettings);
    const provider = s.provider === 'minimax' ? 'minimax' : 'deepseek';
    const rememberKeys = s.rememberKeys === true;
    return { provider, rememberKeys,
      keys: { deepseek: rememberKeys && obj(s.keys) && str(s.keys.deepseek) ? s.keys.deepseek : '', minimax: rememberKeys && obj(s.keys) && str(s.keys.minimax) ? s.keys.minimax : '' },
      models: { deepseek: obj(s.models) && str(s.models.deepseek) && s.models.deepseek.trim() ? s.models.deepseek : defaultSettings.models.deepseek, minimax: obj(s.models) && str(s.models.minimax) && s.models.minimax.trim() ? s.models.minimax : defaultSettings.models.minimax },
    };
  } catch { return structuredClone(defaultSettings); }
}
export function saveSettings(settings: Settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings, keys: settings.rememberKeys ? settings.keys : { deepseek: '', minimax: '' } }));
}
export function backup(ideas: Idea[]): Backup { return { format: 'idea-with-ai', version: 1, exportedAt: new Date().toISOString(), ideas }; }
export function parseBackup(text: string): Idea[] {
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error('文件不是有效的 JSON 备份。'); }
  if (!obj(data) || data.format !== 'idea-with-ai' || data.version !== 1 || !date(data.exportedAt)) throw new Error('请选择拾念导出的 JSON 备份文件（版本 1）。');
  return validateIdeas(data.ideas);
}
export function mergeBackup(existing: Idea[], imported: Idea[]): Idea[] {
  // Keep both if the same ID has changed independently; restoring never erases local history.
  const ids = new Map(existing.map(i => [i.id, i]));
  const result = [...existing];
  for (const idea of imported) {
    const local = ids.get(idea.id);
    if (!local) { result.push(idea); ids.set(idea.id, idea); }
    else if (JSON.stringify(validateIdeas([local])) !== JSON.stringify(validateIdeas([idea]))) result.push({ ...idea, id: uid(), title: `${idea.title}（恢复副本）` });
  }
  return result;
}
export function safeFilename(title: string) { return title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().slice(0, 80) || '灵感方案'; }
export function exportMarkdown(version: PlanVersion, includeChat: boolean): string {
  const title = version.title.replace(/[\r\n]+/g, ' ');
  const header = `# ${title}\n\n- 版本：V${version.number}\n- 归档时间：${version.createdAt}\n- 最后编辑：${version.updatedAt}\n- 思维模式：${thinkingModeLabel(version.thinkingMode ?? 'default')}\n\n---\n\n${version.content}\n`;
  if (!includeChat) return header;
  return header + '\n---\n\n## 归档时的会话快照\n\n' + version.snapshot.map(m => `### ${m.role === 'mode-change' ? '思维模式切换' : m.role === 'user' ? '我' : `AI · ${thinkingModeLabel(m.thinkingMode ?? 'default')}`} · ${m.createdAt}\n\n${m.content}\n`).join('\n');
}
export function download(text: string, filename: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function timeLabel(value: string) { return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(value)); }
export function fullTime(value: string) { return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
