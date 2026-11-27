import { fullTime } from '../data';
import type { Message } from '../types';
import { MessageView } from './MessageView';

export function ConversationMessage({ message: m, snapshot = false, storageBlocked = false, deleteDisabled = false, onToggle, onDelete }: {
  message: Message; snapshot?: boolean; storageBlocked?: boolean; deleteDisabled?: boolean; onToggle: () => void; onDelete?: () => void;
}) {
  const time = snapshot ? fullTime(m.createdAt) : new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(m.createdAt));
  return <MessageView message={m} time={time} storageBlocked={storageBlocked} deleteDisabled={deleteDisabled} onToggle={onToggle} onDelete={snapshot ? undefined : onDelete} />;
}
