import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUp, Archive, Check, ChevronDown, ChevronUp, Circle, Clock3, Download, FileText, FolderOpen, History, Leaf, Lightbulb, LoaderCircle, Menu, MessageCircle, MoreHorizontal, PencilLine, Plus, Search, Settings2, ShieldCheck, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { archive, archiveDraftIsStale, backup, changeThinkingMode, DATA_KEY, download, editVersion, exportMarkdown, fullTime, loadIdeas, loadSettings, mergeBackup, newIdea, parseBackup, safeFilename, saveSettings, timeLabel, uid, userMessage } from './data';
import { providers, requestAI } from './ai';
import { Markdown } from './components/Markdown';
import { Modal } from './components/Modal';
import { SettingsDialog } from './components/SettingsDialog';
import { PlanEditor } from './components/PlanEditor';
import { ConversationMessage } from './components/ConversationMessage';
import { thinkingModes, thinkingModeLabel } from './thinking-modes';
import type { AIAction, ConversationMode, Idea, PlanVersion, Settings, ThinkingMode } from './types';

type Dialog = 'settings' | 'backup' | 'rename' | 'delete' | 'archive' | 'edit' | 'snapshot' | null;
const conversationModes: { value: ConversationMode; label: string; hint: string }[] = [
  { value: 'silent', label: '静默', hint: '只记录你的想法，AI 暂不回应。' },
  { value: 'concise', label: '简洁', hint: 'AI 通常用 1–3 句给出关键引导，需要时可要求展开。' },
  { value: 'detailed', label: '详细', hint: 'AI 帮你展开想法，由你决定方向和归档时机。' },
];
const starters = [
  { icon: Lightbulb, label: '我想创造一个东西', text: '我想做一个 ' },
  { icon: Circle, label: '有个问题想解决', text: '我遇到了一个问题：' },
  { icon: Leaf, label: '还只是一个念头', text: '我有一个还没想清楚的想法：' },
];
export default function App() {
  const [initial] = useState(loadIdeas);
  const [ideas, setIdeas] = useState<Idea[]>(initial.ideas);
  const ideasRef = useRef(ideas); ideasRef.current = ideas;
  const rawRef = useRef(initial.raw);
  const [storageError, setStorageError] = useState(initial.error);
  const blockedRef = useRef(!!initial.error);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const [modeSettingsExpanded, setModeSettingsExpanded] = useState(true);
  const [tab, setTab] = useState<'chat' | 'plans'>('chat');
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'discussing' | 'archived'>('all');
  const [mobileNav, setMobileNav] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 680);
  const sidebarRef = useRef<HTMLElement>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [homeInput, setHomeInput] = useState('');
  const [rename, setRename] = useState('');
  const [editing, setEditing] = useState({ title: '', content: '' });
  const [includeChat, setIncludeChat] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<{ action: AIAction; ideaId: string } | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const [retry, setRetry] = useState<{ action: AIAction; ideaId: string } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const homeComposer = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const active = ideas.find(i => i.id === activeId);
  const messageCount = active?.messages.filter(m => m.role !== 'mode-change').length ?? 0;
  const lastMessage = active && [...active.messages].reverse().find(m => m.role !== 'mode-change');
  const version = active?.versions.find(v => v.id === selectedVersion) ?? active?.versions.at(-1);
  const archivedCount = ideas.filter(i => i.versions.length).length;
  const totalVersions = ideas.reduce((n, i) => n + i.versions.length, 0);
  const ready = !!settings.keys[settings.provider].trim();
  const unsummarized = active && (active.messages.length !== (active.versions.at(-1)?.snapshot.length ?? 0));

  function flash(text: string) { setNotice(text); }
  function commit(next: Idea[], force = false): boolean {
    if (blockedRef.current && !force) { setError('本地存储已暂停，请先备份或恢复数据。'); return false; }
    const raw = JSON.stringify(next);
    try {
      if (!force && localStorage.getItem(DATA_KEY) !== rawRef.current) {
        blockedRef.current = true; setStorageError('另一个页面修改了数据，已暂停写入。请先备份当前内容，再刷新读取最新数据。'); return false;
      }
      localStorage.setItem(DATA_KEY, raw); rawRef.current = raw;
      ideasRef.current = next; setIdeas(next);
      if (force) { blockedRef.current = false; setStorageError(''); }
      return true;
    } catch {
      // Preserve this attempted change in memory so a JSON download can recover it.
      ideasRef.current = next; setIdeas(next); blockedRef.current = true;
      setStorageError('本地存储不可用或空间不足。最新内容保留在当前页面，请立即下载备份；刷新页面可能丢失未保存内容。');
      return false;
    }
  }
  function update(id: string, updater: (i: Idea) => Idea) { return commit(ideasRef.current.map(i => i.id === id ? updater(i) : i)); }
  function cancelRequest(showNotice = true) {
    requestRef.current?.abort(); requestRef.current = null; setBusy(null);
    if (showNotice) { if (busy) setRetry(busy); setError('已取消请求，内容已保留。'); }
  }
  function select(id: string | null) {
    cancelRequest(false); setHeaderCollapsed(false); setActiveId(id); setTab('chat'); setSelectedVersion(null); setMobileNav(false); setError(''); setDialog(null);
  }
  function create(text = '', chat = false) {
    if (blockedRef.current) { setError('请先处理本地存储问题。'); return; }
    const idea = newIdea(text);
    if (chat && text.trim()) { idea.messages.push(userMessage(text)); idea.input = ''; }
    if (!commit([idea, ...ideasRef.current])) return;
    select(idea.id); setHomeInput('');
    if (chat && text.trim()) void runAI(idea, 'chat');
    else flash(text.trim() ? '灵感已记下，随时可以继续讨论' : '新会话已创建');
  }
  async function runAI(idea: Idea, action: AIAction) {
    if (blockedRef.current || (action === 'chat' && idea.mode === 'silent')) return;
    if (!settings.keys[settings.provider].trim()) { setRetry({ action, ideaId: idea.id }); setDialog('settings'); setError('内容已保存，配置 AI 后可继续。'); return; }
    cancelRequest(false); const controller = new AbortController(); requestRef.current = controller;
    setBusy({ action, ideaId: idea.id }); setError(''); setRetry(null);
    try {
      const result = await requestAI(idea, settings, action, { signal: controller.signal });
      if (requestRef.current !== controller || controller.signal.aborted) return;
      if (!ideasRef.current.some(i => i.id === idea.id)) return;
      if (action === 'chat') {
        update(idea.id, i => ({ ...i, updatedAt: new Date().toISOString(), messages: [...i.messages, { id: uid(), role: 'assistant', content: result.reply, createdAt: new Date().toISOString(), thinkingMode: idea.thinkingMode }] }));
      } else {
        const saved = update(idea.id, i => ({ ...i, archiveDraft: { title: result.title, content: result.markdown, createdAt: new Date().toISOString(), snapshot: idea.messages.map(m => ({ ...m })), thinkingMode: idea.thinkingMode } }));
        if (saved) setDialog('archive');
      }
    } catch (e) {
      if (requestRef.current !== controller) return;
      setError(e instanceof Error ? e.message : '请求失败，请稍后重试。'); setRetry({ action, ideaId: idea.id });
    } finally {
      if (requestRef.current === controller) { requestRef.current = null; setBusy(null); }
    }
  }
  function send() {
    if (!active || busy || blockedRef.current || !active.input.trim()) return;
    const next = { ...active, title: active.title === '未命名灵感' && !messageCount ? active.input.trim().slice(0, 32) : active.title, messages: [...active.messages, userMessage(active.input, active.mode === 'silent')], input: '', updatedAt: new Date().toISOString() };
    if (!update(active.id, () => next)) return;
    if (next.mode !== 'silent') void runAI(next, 'chat');
  }
  function changeMode(mode: ConversationMode) {
    if (!active || busy || blockedRef.current || mode === active.mode) return;
    if (!update(active.id, i => ({ ...i, mode }))) return;
    if (retry?.ideaId === active.id && retry.action === 'chat') { setRetry(null); setError(''); }
  }
  function selectThinkingMode(mode: ThinkingMode) {
    if (!active || busy || blockedRef.current || mode === active.thinkingMode) return;
    if (!update(active.id, i => changeThinkingMode(i, mode))) return;
    setError('');
  }
  function requestArchive() {
    if (!active || busy || blockedRef.current) return;
    if (active.archiveDraft) { setDialog('archive'); return; }
    if (!messageCount) { setError('先聊一聊你的想法，再生成方案。'); return; }
    void runAI(active, 'archive');
  }
  function confirmArchive() {
    if (!active?.archiveDraft) return;
    if (archiveDraftIsStale(active)) { setError('讨论或思维模式已变化，请先按最新讨论和模式重新生成，再确认归档。'); return; }
    try {
      const next = archive(active, active.archiveDraft);
      if (!update(active.id, () => next)) return;
      setSelectedVersion(next.versions.at(-1)!.id); setTab('plans'); setDialog(null); flash(`已归档为 V${next.versions.at(-1)!.number}`);
    } catch (e) { setError((e as Error).message); }
  }
  function saveEdited() {
    if (!active || !version) return;
    try { if (update(active.id, i => editVersion(i, version.id, editing.title, editing.content))) { setDialog(null); flash(`V${version.number} 已保存，讨论快照未改变`); } }
    catch (e) { setError((e as Error).message); }
  }
  function exportVersion(v: PlanVersion) {
    download(exportMarkdown(v, includeChat), `${safeFilename(v.title)}-V${v.number}.md`, 'text/markdown'); flash(`已导出 V${v.number} 的 Markdown`);
  }
  function downloadBackup() { download(JSON.stringify(backup(ideasRef.current), null, 2), `拾念备份-${new Date().toISOString().slice(0, 10)}.json`); }
  async function importFile(file?: File) {
    if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('备份文件超过 20 MB，请使用较小的备份。');
      const imported = parseBackup(await file.text());
      if (blockedRef.current && !window.confirm('恢复将替换当前浏览器中的原始数据。请确认已经下载当前内容或原始数据备份。')) return;
      const next = mergeBackup(ideasRef.current, imported);
      if (commit(next, blockedRef.current)) { flash(`已恢复 ${imported.length} 条灵感；冲突记录保留为副本`); setDialog(null); }
    } catch (e) { setError(e instanceof Error ? e.message : '无法读取备份。'); }
    finally { if (fileInput.current) fileInput.current.value = ''; }
  }
  useEffect(() => {
    const storage = (event: StorageEvent) => {
      if ((event.key === DATA_KEY || event.key === null) && event.newValue !== rawRef.current) {
        blockedRef.current = true; setStorageError('另一个页面修改或清除了本地数据，已暂停写入。请先备份当前内容，再刷新页面。');
        requestRef.current?.abort(); requestRef.current = null; setBusy(null);
      }
    };
    window.addEventListener('storage', storage);
    return () => { window.removeEventListener('storage', storage); requestRef.current?.abort(); };
  }, []);
  useEffect(() => {
    const resize = () => { const mobile = window.innerWidth <= 680; setIsMobile(mobile); if (!mobile) setMobileNav(false); };
    window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    if (!mobileNav || !isMobile) return;
    const previous = document.activeElement as HTMLElement | null;
    const sidebar = sidebarRef.current!;
    const controls = () => Array.from(sidebar.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),a[href]'));
    controls()[0]?.focus();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setMobileNav(false); }
      if (e.key === 'Tab') { const items = controls(); const first = items[0]; const last = items.at(-1); if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } }
    };
    document.addEventListener('keydown', handleKey);
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', handleKey); document.body.style.overflow = overflow; previous?.focus(); };
  }, [mobileNav, isMobile]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [activeId, active?.messages.length, busy]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 3500); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => { if (blockedRef.current || (dialog === 'edit' && version && (editing.title !== version.title || editing.content !== version.content))) { e.preventDefault(); } };
    window.addEventListener('beforeunload', leave); return () => window.removeEventListener('beforeunload', leave);
  }, [dialog, version, editing]);
  function closeDialog() {
    if (dialog === 'edit' && version && (editing.title !== version.title || editing.content !== version.content) && !window.confirm('放弃尚未保存的方案修改？')) return;
    setDialog(null); setError('');
  }
  const visible = [...ideas].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).filter(i => {
    const matchesFilter = filter === 'all' || (filter === 'archived' ? !!i.versions.length : !i.versions.length || i.messages.length !== i.versions.at(-1)?.snapshot.length);
    const q = query.trim().toLocaleLowerCase();
    return matchesFilter && (!q || [i.title, i.input, ...i.messages.map(m => m.content), ...i.versions.flatMap(v => [v.title, v.content])].some(text => text.toLocaleLowerCase().includes(q)));
  });

  return <div className="app-shell">
    {mobileNav && <button className="nav-backdrop" aria-label="关闭会话列表" onClick={() => setMobileNav(false)} />}
    <aside ref={sidebarRef} className={`sidebar ${mobileNav ? 'open' : ''}`} aria-label="灵感导航" inert={isMobile && !mobileNav}>
      <button className="icon-button mobile-nav-close" aria-label="关闭会话列表" onClick={() => setMobileNav(false)}><X size={19} /></button>
      <button className="brand" onClick={() => select(null)}><span className="brand-mark"><Sparkles size={23} strokeWidth={1.6} /></span><span>拾念<small>IDEA WITH AI</small></span></button>
      <button className="button new-idea" disabled={!!storageError} onClick={() => create()}><Plus size={18} />新建灵感<span className="small-key">＋</span></button>
      <button className={`nav-item ${!activeId ? 'active' : ''}`} onClick={() => select(null)}><FolderOpen size={17} />灵感工作台<ArrowRight size={14} /></button>
      <div className="sidebar-divider" />
      <div className="section-label"><span>我的灵感</span><span>{ideas.length}</span></div>
      <div className="search-box"><Search size={15} /><input aria-label="搜索灵感" placeholder="搜索想法、会话或方案" value={query} onChange={e => setQuery(e.target.value)} />{query && <button aria-label="清除搜索" className="icon-button tiny" onClick={() => setQuery('')}><X size={13} /></button>}</div>
      <div className="filters" aria-label="灵感筛选">{(['all', 'discussing', 'archived'] as const).map(f => <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f} className={filter === f ? 'chosen' : ''}>{f === 'all' ? '全部' : f === 'discussing' ? '讨论中' : '已归档'}</button>)}</div>
      <nav className="idea-list" aria-label="会话列表">{visible.map(i => <button className={`idea-item ${activeId === i.id ? 'selected' : ''}`} key={i.id} onClick={() => select(i.id)}><span className={`idea-icon ${i.versions.length ? 'archived' : ''}`}>{i.versions.length ? <FileText size={16} /> : <MessageCircle size={16} />}</span><span className="idea-item-text"><strong>{i.title}</strong><small>{timeLabel(i.updatedAt)}<span>·</span>{i.versions.length ? `${i.versions.length} 个版本` : i.messages.some(m => m.role !== 'mode-change') ? '讨论中' : '待展开'}</small></span></button>)}{!visible.length && <div className="list-empty">{query ? '没有找到相关灵感' : filter === 'archived' ? '还没有归档的方案' : '灵感从一个念头开始'}</div>}</nav>
      <div className="sidebar-bottom"><button className="nav-item" onClick={() => { setDialog('backup'); setMobileNav(false); setError(''); }}><Download size={17} />备份与恢复</button><button className="nav-item" onClick={() => { setDialog('settings'); setMobileNav(false); setError(''); }}><Settings2 size={17} />AI 设置<span className={`connection-dot ${ready ? 'ready' : ''}`} /></button><div className="local-label"><ShieldCheck size={13} />数据保存在当前浏览器</div></div>
    </aside>
    <main className="main-area" inert={isMobile && mobileNav}>
      <div className="sticky-workspace-header">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="打开会话列表" onClick={() => setMobileNav(true)}><Menu size={21} /></button><span className="desktop-crumb">我的空间</span><span className="crumb-divider">/</span><span>{active ? '灵感会话' : '灵感工作台'}</span></div>{active && headerCollapsed && <button className="topbar-conversation-title" aria-expanded={false} aria-controls="conversation-header-details" title={active.title} onClick={() => setHeaderCollapsed(false)}><span>{active.title}</span><ChevronDown size={14} /></button>}<button className="model-status" onClick={() => setDialog('settings')}><span className={`connection-dot ${ready ? 'ready' : ''}`} /><span>{providers[settings.provider].name}</span><ChevronDown size={13} /></button></header>
      {storageError && <div role="alert" className="storage-alert"><strong>本地保存已暂停</strong><span>{storageError}</span><button onClick={downloadBackup}>备份当前内容</button><button onClick={() => setDialog('backup')}>恢复数据</button></div>}
      {active && <div id="conversation-header-details" className="workspace-header-details" hidden={headerCollapsed}>
        <header className="idea-heading"><div><div className="eyebrow">IDEA / {timeLabel(active.createdAt)}</div><h1>{active.title}</h1><div className="idea-meta"><span className="status-pill">{active.versions.length ? unsummarized ? '有新的讨论' : `已归档 · V${active.versions.at(-1)!.number}` : messageCount ? '讨论中' : '待展开'}</span><span>{messageCount} 条消息</span><span>自动保存在本地</span></div></div><div className="heading-actions"><button className="header-collapse" aria-expanded={true} aria-controls="conversation-header-details" onClick={() => setHeaderCollapsed(true)}><ChevronUp size={16} />收起</button><button className="icon-button" aria-label="重命名灵感" title="重命名" disabled={!!busy || !!storageError} onClick={() => { setRename(active.title); setDialog('rename'); }}><PencilLine size={18} /></button><button className="icon-button" aria-label="删除灵感" title="删除灵感" disabled={!!busy || !!storageError} onClick={() => setDialog('delete')}><MoreHorizontal size={21} /></button></div></header>
        <div className="workspace-toolbar"><div className="workspace-tabs" role="group" aria-label="会话与方案"><button className={tab === 'chat' ? 'active' : ''} aria-pressed={tab === 'chat'} onClick={() => setTab('chat')}><MessageCircle size={16} />持续会话</button><button className={tab === 'plans' ? 'active' : ''} aria-pressed={tab === 'plans'} onClick={() => setTab('plans')}><Archive size={16} />方案版本<span>{active.versions.length}</span></button></div><button className="button primary archive-button" disabled={!!busy || !!storageError || (!messageCount && !active.archiveDraft)} onClick={requestArchive}><Archive size={16} />{active.archiveDraft ? '继续编辑草稿' : '生成归档草稿'}</button></div>
      </div>}
      </div>
      {!active ? <div className="home-page">
        <div className="workspace-heading"><span className="eyebrow"><span className="green-line" /> A LITTLE SPACE FOR BIG IDEAS</span><span className="workspace-date">让想法慢慢生长 <Leaf size={15} /></span></div>
        <section className="hero"><div className="hero-symbol"><Sparkles size={33} strokeWidth={1.3} /></div><h1>每一个念头，<br />都值得<span>被认真对待。</span></h1><p>先接住一闪而过的灵感，再和 AI 一起，<br className="mobile-break" />把它梳理成可以开始的下一步。</p></section>
        <section className="capture-card" aria-label="捕获灵感"><div className="capture-label"><span><PencilLine size={16} />此刻，你在想什么？</span><span className="subtle-label">不用想完整，先写下来</span></div><textarea ref={homeComposer} aria-label="新灵感内容" placeholder="一个想做的东西、一个想解决的问题，或者一个还模糊的念头…" value={homeInput} disabled={!!storageError} onChange={e => setHomeInput(e.target.value)} onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !e.nativeEvent.isComposing && homeInput.trim()) { e.preventDefault(); create(homeInput, true); } }} /><div className="capture-footer"><span><span className="dot" /> 先保存，随时继续</span><div><button className="button secondary" disabled={!homeInput.trim() || !!storageError} onClick={() => create(homeInput)}>先记下来</button><button className="button primary" disabled={!homeInput.trim() || !!storageError} onClick={() => create(homeInput, true)}><Sparkles size={16} />与 AI 一起梳理<ArrowRight size={16} /></button></div></div></section>
        <div className="starter-row">{starters.map(s => <button key={s.label} onClick={() => { setHomeInput(s.text); homeComposer.current?.focus(); }} disabled={!!storageError}><s.icon size={16} />{s.label}<ArrowRight size={13} /></button>)}</div>
        <section className="workspace-summary" aria-label="工作台概览"><div><span className="summary-icon"><Lightbulb size={19} /></span><strong>{ideas.length}</strong><span>捕获的灵感</span></div><div><span className="summary-icon"><Archive size={19} /></span><strong>{archivedCount}</strong><span>已形成方案</span></div><div><span className="summary-icon"><History size={19} /></span><strong>{totalVersions}</strong><span>保存的版本</span></div></section>
        <section className="home-lower"><div className="lower-title"><h2>{ideas.length ? '最近的灵感' : '从念头，到下一步'}</h2><span>{ideas.length ? '每一次讨论，都让想法更清晰' : '按自己的节奏，慢慢展开'}</span></div>{ideas.length ? <div className="recent-grid">{[...ideas].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3).map(i => <button key={i.id} className="recent-card" onClick={() => select(i.id)}><span className="recent-card-top"><span className="status-pill">{i.versions.length ? `已归档 · V${i.versions.at(-1)!.number}` : i.messages.some(m => m.role !== 'mode-change') ? '讨论中' : '待展开'}</span><ArrowRight size={17} /></span><h3>{i.title}</h3><p>{i.versions.at(-1)?.content.replace(/[#*\[\]]/g, '').slice(0, 90) || i.messages.find(m => m.role === 'user')?.content || i.input || '打开这个灵感，开始新的讨论。'}</p><small>{timeLabel(i.updatedAt)}更新</small></button>)}</div> : <div className="process-row">{[{ n: '01', title: '接住灵感', text: '一句话也可以，先留下那个念头。', icon: PencilLine }, { n: '02', title: '一起想清楚', text: 'AI 帮你追问、分析，找到下一步。', icon: MessageCircle }, { n: '03', title: '留下行动方案', text: '由你决定归档，每次进展留一个版本。', icon: FileText }].map(s => <div className="process-card" key={s.n}><span className="process-number">{s.n}</span><s.icon size={18} /><h3>{s.title}</h3><p>{s.text}</p></div>)}</div>}</section>
        <footer className="home-footer"><Leaf size={14} />想法不必一开始就完美。</footer>
      </div> : <div className="idea-workspace">
        {tab === 'chat' ? <div className="chat-layout"><section className="conversation"><div className="message-scroll">
          <div className="conversation-start"><span><Sparkles size={16} /></span><p>这里是你的思考空间</p><small>不着急得到答案，先从你的想法开始。</small></div>
          {active.messages.map(m => <ConversationMessage key={m.id} message={m} />)}
          {busy?.ideaId === active.id && <div className="thinking"><LoaderCircle size={17} className="spin" /><span>{busy.action === 'archive' ? '正在整理你的可执行方案…' : '正在认真想一想…'}</span><button className="text-button" onClick={() => cancelRequest()}>取消</button></div>}
          {((retry?.ideaId === active.id && retry.action === 'archive') || (active.mode !== 'silent' && (retry?.ideaId === active.id || lastMessage?.role === 'user'))) && !busy && <button className="button secondary retry-button" disabled={!!storageError} onClick={() => void runAI(active, retry?.ideaId === active.id ? retry.action : 'chat')}><ArrowRight size={15} />{retry?.ideaId === active.id && retry.action === 'archive' ? '重试生成方案' : lastMessage?.silent && retry?.ideaId !== active.id ? '让 AI 回应' : '继续 / 重试 AI 回复'}</button>}
          {!messageCount && <div className="chat-welcome"><p>你想创造什么，或者解决什么问题？</p><span>一个粗略的念头也足够开始。</span></div>}
          </div>
          <div ref={bottom} className="composer-area">
            <section id="conversation-mode-settings" className="mode-settings" aria-label="对话模式设置" hidden={!modeSettingsExpanded}>
              <div className="mode-controls">
                <div className="mode-control">
                  <label htmlFor="thinking-mode">思维模式</label>
                  <div className="mode-select">
                    <select id="thinking-mode" value={active.thinkingMode} disabled={!!busy || !!storageError} aria-describedby="thinking-mode-hint" onChange={e => selectThinkingMode(e.target.value as ThinkingMode)}>
                      {thinkingModes.map(mode => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
                    </select>
                    <ChevronDown size={15} aria-hidden="true" />
                  </div>
                </div>
                <div className="mode-control">
                  <label htmlFor="conversation-mode">回应模式</label>
                  <div className="mode-select">
                    <select id="conversation-mode" value={active.mode} disabled={!!busy || !!storageError} aria-describedby="conversation-mode-hint" onChange={e => changeMode(e.target.value as ConversationMode)}>
                      {conversationModes.map(mode => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
                    </select>
                    <ChevronDown size={15} aria-hidden="true" />
                  </div>
                </div>
              </div>
              <div className="mode-hints">
                <p id="thinking-mode-hint"><strong>思维：</strong><span>{thinkingModes.find(mode => mode.value === active.thinkingMode)?.hint}</span></p>
                <p id="conversation-mode-hint"><strong>回应：</strong><span>{conversationModes.find(mode => mode.value === active.mode)?.hint}</span></p>
              </div>
            </section>
            <div className="composer">
              <textarea aria-label="会话输入" placeholder={active.mode === 'silent' ? '尽管写下来，AI 暂不回应…' : '继续说说你的想法…'} value={active.input} disabled={!!busy || !!storageError} onChange={e => update(active.id, i => ({ ...i, input: e.target.value }))} onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
              <div className="composer-footer">
                <span>{active.input.trim() ? '输入内容已在本地保存' : '⌘ / Ctrl + Enter 发送'}</span>
                <div className="composer-actions">
                  <button className="mode-toggle" aria-label={`${modeSettingsExpanded ? '收起' : '展开'}模式设置，当前${thinkingModeLabel(active.thinkingMode)} · ${conversationModes.find(mode => mode.value === active.mode)?.label}`} title={modeSettingsExpanded ? '收起模式设置' : '展开模式设置'} aria-expanded={modeSettingsExpanded} aria-controls="conversation-mode-settings" onClick={() => setModeSettingsExpanded(expanded => !expanded)}>
                    <Settings2 size={13} aria-hidden="true" /><span>{thinkingModeLabel(active.thinkingMode)} · {conversationModes.find(mode => mode.value === active.mode)?.label}</span>{modeSettingsExpanded ? <ChevronUp size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
                  </button>
                  <button aria-label="发送消息" className="send-button" onClick={send} disabled={!active.input.trim() || !!busy || !!storageError}><ArrowUp size={20} /></button>
                </div>
              </div>
            </div>
          </div>
        </section><aside className="context-panel"><div className="context-heading"><Leaf size={16} /><span>让想法向前一步</span></div><p>讨论会持续向前。归档保存阶段成果，不会结束会话。</p><div className="context-divider" /><h3>方案版本 <span>{active.versions.length}</span></h3>{active.versions.length ? [...active.versions].reverse().map(v => <button className="context-version" key={v.id} onClick={() => { setSelectedVersion(v.id); setTab('plans'); }}><span>V{v.number}</span><div><strong>{v.title}</strong><small>{timeLabel(v.createdAt)}</small></div><ArrowRight size={14} /></button>) : <div className="context-empty"><FileText size={27} strokeWidth={1.2} /><span>聊到一个阶段，<br />就留下一个方案版本。</span></div>}<div className="context-tip"><History size={15} /><p>旧版本可查看和编辑；所有新讨论都接在当前会话之后。</p></div></aside></div> : <section className="plans-page">{version ? <>
          <div className="version-bar"><label className="version-selector"><History size={17} /><select aria-label="选择方案版本" value={version.id} onChange={e => setSelectedVersion(e.target.value)}>{[...active.versions].reverse().map(v => <option value={v.id} key={v.id}>V{v.number} · {v.title}</option>)}</select></label><button className="text-button" onClick={() => setTab('chat')}><ArrowLeft size={14} />继续当前会话</button></div>
          <article className="plan-document"><div className="document-eyebrow"><span className="status-pill">V{version.number}</span><span>可执行方案</span><span>思维模式 · {thinkingModeLabel(version.thinkingMode ?? 'default')}</span></div><h2>{version.title}</h2><div className="document-meta"><span><Clock3 size={13} />归档于 {fullTime(version.createdAt)}</span>{version.updatedAt !== version.createdAt && <span>编辑于 {fullTime(version.updatedAt)}</span>}</div><div className="document-actions"><button className="button secondary" disabled={!!busy || !!storageError} onClick={() => { setEditing({ title: version.title, content: version.content }); setDialog('edit'); }}><PencilLine size={15} />编辑方案</button><button className="button secondary" onClick={() => setDialog('snapshot')}><History size={15} />讨论快照</button><button className="button secondary" onClick={() => exportVersion(version)}><ArrowDownToLine size={15} />导出 Markdown</button><label className="checkbox-row"><input type="checkbox" checked={includeChat} onChange={e => setIncludeChat(e.target.checked)} />附带讨论</label></div><div className="document-body"><Markdown text={version.content} /></div><div className="document-footnote"><ShieldCheck size={14} />编辑此版本不会改变归档时的讨论快照。新讨论始终沿当前会话继续。</div></article>
        </> : <div className="empty-plans"><div className="empty-icon"><Archive size={30} /></div><h2>给想法留一个阶段成果</h2><p>当你准备好了，生成一份方案草稿。<br />检查、修改，再由你确认归档为 V1。</p><button className="button primary" disabled={!messageCount || !!busy || !!storageError} onClick={requestArchive}><Sparkles size={16} />生成归档草稿</button><button className="text-button" onClick={() => setTab('chat')}>返回会话，继续想一想<ArrowRight size={14} /></button></div>}</section>}
      </div>}
      {error && !dialog && <div role="alert" className="error-banner"><span>{error}</span><button aria-label="关闭提示" className="icon-button" onClick={() => setError('')}><X size={16} /></button></div>}
    </main>
    {notice && <div className="toast" role="status"><Check size={17} />{notice}</div>}
    <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={e => void importFile(e.target.files?.[0])} />
    {dialog === 'settings' && <SettingsDialog settings={settings} onClose={closeDialog} onSave={s => { try { saveSettings(s); setSettings(s); setDialog(null); flash('AI 设置已保存'); } catch { setSettings(s); setDialog(null); setError('设置保留在当前页面，但无法写入浏览器存储。请检查存储权限。'); } }} />}
    {dialog === 'backup' && <Modal title="备份与恢复" onClose={closeDialog}><p className="muted">把全部灵感、持续会话、方案版本和草稿打包保存。可手动带到另一个设备或浏览器。</p><div className="backup-card"><div className="backup-icon"><Download size={23} /></div><div><h3>完整 JSON 备份</h3><p>{ideas.length} 条灵感 · {totalVersions} 个方案版本<br />不包含 API 密钥。</p></div><button className="button primary" onClick={downloadBackup}>下载备份</button></div><div className="backup-card"><div className="backup-icon"><Upload size={23} /></div><div><h3>从备份恢复</h3><p>合并导入，已有内容保留。<br />有差异的同名记录保存为副本。</p></div><button className="button secondary" onClick={() => fileInput.current?.click()}>选择文件</button></div>{initial.raw && initial.error && storageError && <div className="recovery-section"><h3>原始数据恢复</h3><p>原始本地数据无法解析，先下载以便恢复。</p><button className="button secondary" onClick={() => download(initial.raw!, '拾念-原始数据.json')}>下载原始数据</button><button className="text-button danger-text" onClick={() => { if (window.confirm('确定清空无法读取的本地数据？请先下载原始数据备份。')) { if (commit([], true)) setDialog(null); } }}>清空并重新开始</button></div>}{(error || storageError) && <p className="error-text" role="alert">{error || storageError}</p>}<div className="privacy-note"><ShieldCheck size={18} /><p>Markdown 导出在每个方案版本中提供。JSON 用于完整恢复；清除网站数据会删除本地记录，建议定期备份。</p></div></Modal>}
    {dialog === 'rename' && active && <Modal title="重命名灵感" onClose={closeDialog}><form onSubmit={e => { e.preventDefault(); if (!rename.trim()) return; if (update(active.id, i => ({ ...i, title: rename.trim(), updatedAt: new Date().toISOString() }))) { setDialog(null); flash('标题已更新'); } }}><label htmlFor="idea-title" className="field-label">灵感标题</label><input id="idea-title" autoFocus required maxLength={120} value={rename} onChange={e => setRename(e.target.value)} /><footer className="modal-actions"><button type="button" className="button secondary" onClick={closeDialog}>取消</button><button type="submit" className="button primary">保存标题</button></footer></form></Modal>}
    {dialog === 'delete' && active && <Modal title="删除这个灵感？" onClose={closeDialog}><p>“{active.title}”的完整会话、草稿及 {active.versions.length} 个版本将从当前浏览器删除。建议先下载备份。</p><footer className="modal-actions"><button className="button secondary" autoFocus onClick={closeDialog}>保留灵感</button><button className="button danger" onClick={() => { if (commit(ideasRef.current.filter(i => i.id !== active.id))) { select(null); flash('灵感已删除'); } }}><Trash2 size={15} />确认删除</button></footer></Modal>}
    {dialog === 'archive' && active?.archiveDraft && <Modal title={`归档草稿 · 即将保存为 V${(active.versions.at(-1)?.number ?? 0) + 1}`} wide onClose={closeDialog}><p className="muted">先检查内容，再确认归档。草稿自动保存，关闭后可以继续编辑。生成模式：{thinkingModeLabel(active.archiveDraft.thinkingMode ?? 'default')}。</p>{archiveDraftIsStale(active) && <div className="stale-draft"><p>这份草稿生成后，讨论或思维模式发生了变化，尚未包含在草稿或快照中。</p><button className="button secondary" disabled={!!storageError} onClick={() => { setDialog(null); void runAI(active, 'archive'); }}>按最新讨论和模式重新生成</button></div>}<PlanEditor title={active.archiveDraft.title} content={active.archiveDraft.content} onChange={(title, content) => update(active.id, i => ({ ...i, archiveDraft: { ...i.archiveDraft!, title, content } }))} />{error && <p role="alert" className="error-text">{error}</p>}<footer className="modal-actions"><button className="text-button danger-text" disabled={!!storageError} onClick={() => { if (window.confirm('丢弃当前方案草稿？会话和已归档版本会保留。')) { update(active.id, i => ({ ...i, archiveDraft: undefined })); setDialog(null); } }}>丢弃草稿</button><div className="action-spacer" /><button className="button secondary" onClick={closeDialog}>稍后继续</button><button className="button primary" disabled={!active.archiveDraft.title.trim() || !active.archiveDraft.content.trim() || archiveDraftIsStale(active) || !!storageError} onClick={confirmArchive}><Archive size={15} />确认归档</button></footer></Modal>}
    {dialog === 'edit' && version && <Modal title={`编辑 V${version.number}`} wide onClose={closeDialog}><p className="muted">保存后仍为 V{version.number}。归档时间与讨论快照保留不变。</p><PlanEditor title={editing.title} content={editing.content} onChange={(title, content) => setEditing({ title, content })} />{error && <p role="alert" className="error-text">{error}</p>}<footer className="modal-actions"><button className="button secondary" onClick={closeDialog}>取消</button><button className="button primary" disabled={!editing.title.trim() || !editing.content.trim() || !!storageError} onClick={saveEdited}>保存修改</button></footer></Modal>}
    {dialog === 'snapshot' && version && <Modal title={`V${version.number} · 归档时的讨论快照`} wide onClose={closeDialog}><p className="snapshot-notice"><History size={16} />这是只读的历史记录。新讨论会继续接在当前会话之后。</p><div className="snapshot-messages">{version.snapshot.length ? version.snapshot.map(m => <ConversationMessage key={m.id} message={m} snapshot />) : <p className="muted">此版本没有会话快照。</p>}</div></Modal>}
  </div>;
}
