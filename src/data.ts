import type { ArchiveDraft, Backup, Idea, Message, PlanVersion, Settings } from './types';
export const DATA_KEY = 'idea-with-ai.ideas.v1';
export const SETTINGS_KEY = 'idea-with-ai.settings.v1';
export const defaultSettings: Settings = {
  provider: 'deepseek', rememberKeys: false, keys: { deepseek: '', minimax: '' },
  models: { deepseek: 'deepseek-flash', minimax: 'MiniMax-M3.1-Flash' },
};
export function uid() { return crypto.randomUUID(); }
export function newIdea(text = ''): Idea {
  const now = new Date().toISOString();
  return { id: uid(), title: text.trim().slice(0, 32) || '未命名灵感', createdAt: now, updatedAt: now, messages: [], input: text, mode: 'detailed', versions: [] };
}
export function userMessage(content: string, silent = false): Message { return { id: uid(), role: 'user', content: content.trim(), createdAt: new Date().toISOString(), ...(silent ? { silent: true } : {}) }; }
export function archive(idea: Idea, draft: ArchiveDraft): Idea {
  if (!draft.title.trim() || !draft.content.trim()) throw new Error('请填写方案标题和正文。');
  const now = new Date().toISOString();
  const version: PlanVersion = {
    id: uid(), number: Math.max(0, ...idea.versions.map(v => v.number)) + 1,
    title: draft.title.trim(), content: draft.content.trim(), createdAt: now, updatedAt: now,
    snapshot: draft.snapshot.map(m => ({ ...m })),
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
  return Array.isArray(v) && v.every(m => obj(m) && str(m.id) && !!m.id && ['user', 'assistant'].includes(String(m.role)) && str(m.content) && date(m.createdAt) && (m.silent === undefined || (m.silent === true && m.role === 'user'))) && unique(v);
}
function validDraft(v: unknown): v is ArchiveDraft {
  return obj(v) && str(v.title) && str(v.content) && date(v.createdAt) && validMessages(v.snapshot);
}
function validVersion(v: unknown): v is PlanVersion {
  return obj(v) && str(v.id) && !!v.id && typeof v.number === 'number' && Number.isSafeInteger(v.number) && v.number > 0 && date(v.updatedAt) && validDraft(v);
}
function validVersions(v: unknown): v is PlanVersion[] {
  return Array.isArray(v) && v.every(validVersion) && unique(v) && v.every((version, n) => n === 0 || version.number > v[n - 1].number);
}
export function validateIdeas(value: unknown): Idea[] {
  if (!Array.isArray(value) || !value.every(i => obj(i) && str(i.id) && !!i.id && str(i.title) && date(i.createdAt) && date(i.updatedAt) && str(i.input) && (i.mode === undefined || (str(i.mode) && ['silent', 'concise', 'detailed'].includes(i.mode))) && validMessages(i.messages) && validVersions(i.versions) && (i.archiveDraft === undefined || validDraft(i.archiveDraft))) || !unique(value)) {
    throw new Error('数据格式无效。原有数据未被覆盖，请使用有效的拾念备份。');
  }
  // Rebuild validated objects so imported extra fields never enter application state.
  return value.map(i => ({ id: i.id, title: i.title, createdAt: i.createdAt, updatedAt: i.updatedAt,
    input: i.input, mode: i.mode ?? 'detailed', messages: i.messages.map(cleanMessage), versions: i.versions.map((v: PlanVersion) => ({
      id: v.id, number: v.number, title: v.title, content: v.content, createdAt: v.createdAt, updatedAt: v.updatedAt, snapshot: v.snapshot.map(cleanMessage),
    })), ...(i.archiveDraft ? { archiveDraft: { title: i.archiveDraft.title, content: i.archiveDraft.content, createdAt: i.archiveDraft.createdAt, snapshot: i.archiveDraft.snapshot.map(cleanMessage) } } : {}),
  }));
}
function cleanMessage(m: Message): Message { return { id: m.id, role: m.role, content: m.content, createdAt: m.createdAt, ...(m.silent ? { silent: true } : {}) }; }
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
  const header = `# ${title}\n\n- 版本：V${version.number}\n- 归档时间：${version.createdAt}\n- 最后编辑：${version.updatedAt}\n\n---\n\n${version.content}\n`;
  if (!includeChat) return header;
  return header + '\n---\n\n## 归档时的会话快照\n\n' + version.snapshot.map(m => `### ${m.role === 'user' ? '我' : 'AI'} · ${m.createdAt}\n\n${m.content}\n`).join('\n');
}
export function download(text: string, filename: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function timeLabel(value: string) { return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(value)); }
export function fullTime(value: string) { return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
