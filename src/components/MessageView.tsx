import { useId } from 'react';
import { ChevronDown, ChevronUp, Sparkles, Trash2 } from 'lucide-react';
import type { Message } from '../types';
import { Markdown } from './Markdown';

export function replyPreview(content: string): string {
  const plain = content.replace(/\s+/g, ' ').trim();
  const characters = Array.from(plain);
  return characters.slice(0, 120).join('') + (characters.length > 120 ? '…' : '');
}

export function MessageView({ message, time, onToggle, onDelete, storageBlocked, deleteDisabled }: {
  message: Message; time: string; onToggle: () => void; onDelete?: () => void;
  storageBlocked: boolean; deleteDisabled: boolean;
}) {
  const contentId = useId();
  const assistant = message.role === 'assistant';
  return <article className={`message ${message.role}`}>
    <div className={`avatar ${message.role}`}>{assistant ? <Sparkles size={17} /> : '我'}</div>
    <div className="message-main">
      <div className="message-label"><span>{assistant ? '思考伙伴' : '我'}</span><time>{time}</time>
        {assistant && <div className="message-actions">
          <button aria-label={message.collapsed ? '展开 AI 回复' : '折叠 AI 回复'} aria-expanded={!message.collapsed} aria-controls={contentId} disabled={storageBlocked} onClick={onToggle}>
            {message.collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}{message.collapsed ? '展开' : '折叠'}
          </button>
          {onDelete && <button className="message-delete" aria-label="删除 AI 回复" disabled={deleteDisabled || storageBlocked} onClick={onDelete}><Trash2 size={14} />删除</button>}
        </div>}
      </div>
      {assistant && message.collapsed && <p className="reply-preview">{replyPreview(message.content)}</p>}
      <div id={contentId} hidden={assistant && message.collapsed}>
        {assistant ? !message.collapsed && <Markdown text={message.content} /> : <div className="user-text">{message.content}</div>}
      </div>
    </div>
  </article>;
}
