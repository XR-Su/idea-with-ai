import { useState } from 'react';
import { Eye, PencilLine } from 'lucide-react';
import { Markdown } from './Markdown';
export function PlanEditor({ title, content, onChange }: { title: string; content: string; onChange: (title: string, content: string) => void }) {
  const [preview, setPreview] = useState(false);
  return <>
    <label htmlFor="plan-title" className="field-label">方案标题</label><input id="plan-title" value={title} onChange={e => onChange(e.target.value, content)} placeholder="给方案一个简洁的标题" />
    <div className="editor-label"><label htmlFor="plan-content" className="field-label">方案正文 <span className="muted">Markdown</span></label><button type="button" className="text-button" aria-pressed={preview} onClick={() => setPreview(!preview)}>{preview ? <PencilLine size={14} /> : <Eye size={14} />}{preview ? '编辑' : '预览'}</button></div>
    {preview ? <div className="editor-preview"><Markdown text={content || '*暂无内容*'} /></div> : <textarea id="plan-content" className="plan-editor" value={content} onChange={e => onChange(title, e.target.value)} placeholder="## 目标\n\n你想完成什么？" />}
  </>;
}
