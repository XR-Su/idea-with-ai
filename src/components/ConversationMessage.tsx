import { Sparkles } from 'lucide-react';
import { fullTime } from '../data';
import { thinkingModeLabel } from '../thinking-modes';
import type { Message } from '../types';
import { Markdown } from './Markdown';

export function ConversationMessage({ message: m, snapshot = false }: { message: Message; snapshot?: boolean }) {
  const time = snapshot ? fullTime(m.createdAt) : new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(m.createdAt));
  if (m.role === 'mode-change') return <div className="mode-change"><span>{m.content}</span><time dateTime={m.createdAt}>{time}</time></div>;
  return <article className={`message ${m.role}`}><div className={`avatar ${m.role}`}>{m.role === 'user' ? '我' : <Sparkles size={17} />}</div><div className="message-main"><div className="message-label">{m.role === 'user' ? '我' : `思考伙伴${m.thinkingMode ? ` · ${thinkingModeLabel(m.thinkingMode)}` : ''}`}<time dateTime={m.createdAt}>{time}</time></div>{m.role === 'user' ? <div className="user-text">{m.content}</div> : <Markdown text={m.content} />}</div></article>;
}
