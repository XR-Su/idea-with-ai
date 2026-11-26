import { useState } from 'react';
import { ExternalLink, KeyRound, ShieldCheck } from 'lucide-react';
import { Modal } from './Modal';
import { defaultSettings } from '../data';
import { providers } from '../ai';
import type { Provider, Settings } from '../types';
export function SettingsDialog({ settings, onSave, onClose }: { settings: Settings; onSave: (s: Settings) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<Settings>(() => structuredClone(settings));
  const [error, setError] = useState('');
  const p = draft.provider;
  return <Modal title="AI 设置" onClose={onClose}>
    <p className="muted">选择你的思考伙伴，用自己的 API 密钥开始讨论。</p>
    <form onSubmit={e => { e.preventDefault(); if (!draft.models[p].trim()) { setError('请填写模型名称。'); return; } onSave(draft); }}>
      <div className="provider-options" role="group" aria-label="AI 服务商">{(Object.keys(providers) as Provider[]).map(provider => <button key={provider} type="button" aria-pressed={p === provider} className={`provider-option ${p === provider ? 'chosen' : ''}`} onClick={() => setDraft({ ...draft, provider })}><span className={`provider-dot ${provider}`} />{providers[provider].name}<span className="provider-check">{p === provider ? '✓' : ''}</span></button>)}</div>
      <label className="field-label" htmlFor="api-key"><KeyRound size={15} /> API 密钥</label>
      <input id="api-key" type="password" autoComplete="off" placeholder={`填写 ${providers[p].name} API Key`} value={draft.keys[p]} onChange={e => setDraft({ ...draft, keys: { ...draft.keys, [p]: e.target.value } })} />
      <a className="text-link external-link" href={providers[p].console} target="_blank" rel="noreferrer">前往 {providers[p].name} 开放平台 <ExternalLink size={13} /></a>
      <label className="field-label" htmlFor="model-name">模型名称</label><input id="model-name" required value={draft.models[p]} onChange={e => setDraft({ ...draft, models: { ...draft.models, [p]: e.target.value } })} />
      <p className="field-help">默认沿用 note-with-ai：{defaultSettings.models[p]}。可按账户可用模型修改。</p>
      <label className="checkbox-row"><input type="checkbox" checked={draft.rememberKeys} onChange={e => setDraft({ ...draft, rememberKeys: e.target.checked })} />在当前浏览器记住密钥</label>
      <div className="privacy-note"><ShieldCheck size={18} /><p>会话和方案保存在当前浏览器。发起 AI 请求时，当前会话和最新方案会发送给所选服务商。密钥默认仅保留到页面关闭；选择记住后会明文保存在本地，不包含在备份中。</p></div>
      {error && <p role="alert" className="error-text">{error}</p>}
      <footer className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>取消</button><button className="button primary" type="submit">保存设置</button></footer>
    </form>
  </Modal>;
}
