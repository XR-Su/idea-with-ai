import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const cancel = (event: Event) => { event.preventDefault(); close.current(); };
    dialog.addEventListener('cancel', cancel);
    return () => { dialog.removeEventListener('cancel', cancel); dialog.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <dialog ref={ref} className={`modal ${wide ? 'wide' : ''}`} aria-labelledby="modal-title" onClick={e => { if (e.target === ref.current) { const r = ref.current.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose(); } }}>
    <header className="modal-header"><h2 id="modal-title">{title}</h2><button className="icon-button" onClick={onClose} aria-label="关闭弹窗"><X size={20} /></button></header>
    <div className="modal-body">{children}</div>
  </dialog>;
}
