import type { ThinkingMode } from './thinking-modes';
export type { ThinkingMode } from './thinking-modes';
export type Provider = 'deepseek' | 'minimax';
export type ConversationMode = 'silent' | 'concise' | 'detailed';
export type Message = { id: string; content: string; createdAt: string } & (
  | { role: 'user'; silent?: true; thinkingMode?: never }
  | { role: 'assistant'; silent?: never; thinkingMode?: ThinkingMode }
  | { role: 'mode-change'; silent?: never; thinkingMode: ThinkingMode }
);
export type PlanVersion = {
  id: string; number: number; title: string; content: string;
  createdAt: string; updatedAt: string; snapshot: Message[]; thinkingMode?: ThinkingMode;
};
export type ArchiveDraft = { title: string; content: string; createdAt: string; snapshot: Message[]; thinkingMode?: ThinkingMode };
export type Idea = {
  id: string; title: string; createdAt: string; updatedAt: string;
  messages: Message[]; input: string; mode: ConversationMode; thinkingMode: ThinkingMode; versions: PlanVersion[]; archiveDraft?: ArchiveDraft;
};
export type Settings = { provider: Provider; rememberKeys: boolean; keys: Record<Provider, string>; models: Record<Provider, string> };
export type AIAction = 'chat' | 'archive';
export type AIResult = { reply: string; title: string; markdown: string };
export type Backup = { format: 'idea-with-ai'; version: 1; exportedAt: string; ideas: Idea[] };
