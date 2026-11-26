import type { AIAction, AIResult } from './types';

function stripThinking(text: string): string {
  // Some providers mix <think> into content; never display private reasoning.
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (/<think>/i.test(cleaned)) throw new Error('AI 未返回完整的回答正文，内容已保留，请手动重试。');
  return cleaned;
}
function removeOuterFence(text: string): string {
  const match = text.match(/^```(?:json|markdown|md)?\s*\n?([\s\S]*?)\n?```\s*$/i);
  return match ? match[1].trim() : text;
}
function parseJson(text: string): unknown {
  try { return JSON.parse(text); } catch {
    // Recover literal newlines/tabs inside strings, without guessing missing fields,
    // closing incomplete objects or changing the actual reply/plan text.
    let quoted = false;
    let escaped = false;
    let normalized = '';
    for (const char of text) {
      if (quoted && !escaped && char === '\n') { normalized += '\\n'; continue; }
      if (quoted && !escaped && char === '\r') { normalized += '\\r'; continue; }
      if (quoted && !escaped && char === '\t') { normalized += '\\t'; continue; }
      normalized += char;
      if (escaped) { escaped = false; continue; }
      if (quoted && char === '\\') { escaped = true; continue; }
      if (char === '"') quoted = !quoted;
    }
    try { return JSON.parse(normalized); }
    catch { throw new Error('AI 的结构化内容不完整，内容已保留，请手动重试。'); }
  }
}
export function parseAIContent(raw: string, action: AIAction, fallbackTitle: string): AIResult {
  const text = stripThinking(raw.trim());
  if (!text) throw new Error('AI 没有返回回答正文，内容已保留，请手动重试。');
  const unfenced = removeOuterFence(text);
  if (/^[{\[]/.test(unfenced)) {
    // A code example is a legitimate chat answer. Only unwrap the legacy reply envelope.
    if (action === 'chat' && !/"reply"\s*:/.test(unfenced)) return { reply: text, title: '', markdown: '' };
    const value = parseJson(unfenced);
    if (action === 'chat' && value && typeof value === 'object' && !Array.isArray(value) && !Object.hasOwn(value, 'reply')) return { reply: text, title: '', markdown: '' };
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('AI 返回的内容类型无效，请手动重试。');
    const data = value as Record<string, unknown>;
    if (action === 'chat') {
      if (typeof data.reply !== 'string' || !data.reply.trim()) throw new Error('AI 没有返回有效的对话正文，内容已保留，请手动重试。');
      const reply = stripThinking(data.reply);
      if (!reply) throw new Error('AI 没有返回回答正文，内容已保留，请手动重试。');
      return { reply, title: '', markdown: '' };
    }
    if (typeof data.title !== 'string' || !data.title.trim() || typeof data.markdown !== 'string' || !data.markdown.trim()) throw new Error('AI 方案缺少标题或正文，尚未归档，请手动重试。');
    const markdown = stripThinking(data.markdown);
    if (!markdown) throw new Error('AI 方案正文为空，尚未归档，请手动重试。');
    return { reply: '', title: data.title.trim(), markdown };
  }
  if (action === 'chat') return { reply: text, title: '', markdown: '' };
  // MiniMax can return a native Markdown plan; a document does not need JSON escaping.
  const heading = unfenced.match(/^#\s+(.+?)[ \t]*#*[ \t]*$/m);
  const title = heading?.[1].trim() || fallbackTitle.trim() || '灵感行动方案';
  const markdown = heading ? unfenced.replace(heading[0], '').trim() : unfenced;
  if (!markdown || !/^#{1,6}\s+\S/m.test(markdown)) throw new Error('AI 尚未生成完整的方案正文，请手动重试。');
  return { reply: '', title, markdown };
}
