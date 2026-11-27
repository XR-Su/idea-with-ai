// Add maintained modes here; their Markdown files live in skills/<skill>/.
export const thinkingModes = [
  { value: 'default', label: '默认', hint: '根据你的问题灵活分析，帮助明确下一步。', skill: null },
  { value: 'mao-selected-works', label: '教员', hint: '结合实际情况、关键矛盾、行动与验证分析问题。', skill: 'mao-selected-works' },
] as const;

export type ThinkingMode = typeof thinkingModes[number]['value'];
export function isThinkingMode(value: unknown): value is ThinkingMode {
  return thinkingModes.some(mode => mode.value === value);
}
export function thinkingModeLabel(value: ThinkingMode) {
  return thinkingModes.find(mode => mode.value === value)!.label;
}
