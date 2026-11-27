export type Provider = 'deepseek' | 'minimax';
export type ConversationMode = 'silent' | 'concise' | 'detailed';
export type Message = { id: string; role: 'user' | 'assistant'; content: string; createdAt: string; silent?: true };
export type PlanVersion = {
  id: string; number: number; title: string; content: string;
  createdAt: string; updatedAt: string; snapshot: Message[];
};
export type ArchiveDraft = { title: string; content: string; createdAt: string; snapshot: Message[] };
export type Idea = {
  id: string; title: string; createdAt: string; updatedAt: string;
  messages: Message[]; input: string; mode: ConversationMode; versions: PlanVersion[]; archiveDraft?: ArchiveDraft;
};
export type Settings = { provider: Provider; rememberKeys: boolean; keys: Record<Provider, string>; models: Record<Provider, string> };
export type AIAction = 'chat' | 'archive';
export type AIResult = { reply: string; title: string; markdown: string };
export type Backup = { format: 'idea-with-ai'; version: 1; exportedAt: string; ideas: Idea[] };
