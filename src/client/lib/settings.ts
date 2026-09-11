import type { ChatSettings } from '../../shared/types.js'

const KEY = 'orchat.settings'
export const DEFAULT_SETTINGS: ChatSettings = { model: 'anthropic/claude-sonnet-4.5', tools: [] }

export function loadSettings(): ChatSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return DEFAULT_SETTINGS
  }
}
export const saveSettings = (s: ChatSettings) => localStorage.setItem(KEY, JSON.stringify(s))
