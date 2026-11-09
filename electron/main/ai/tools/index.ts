import type { ToolDefinition } from '../../../../shared/ai-types'
import { timelineTools } from './timeline-tools'
import { frameTools } from './frame-tools'
import { cameraTools } from './camera-tools'
import { cursorTools } from './cursor-tools'
import { audioTools } from './audio-tools'
import { captionTools } from './caption-tools'
import { projectTools } from './project-tools'

export const ALL_AI_TOOLS: ToolDefinition[] = [
  ...timelineTools,
  ...frameTools,
  ...cameraTools,
  ...cursorTools,
  ...audioTools,
  ...captionTools,
  ...projectTools,
]

export const TOOL_MAP = new Map<string, ToolDefinition>(ALL_AI_TOOLS.map((t) => [t.name, t]))

export function getToolDefinition(name: string): ToolDefinition | undefined {
  return TOOL_MAP.get(name)
}

export function isToolDestructive(name: string): boolean {
  return TOOL_MAP.get(name)?.destructive ?? false
}
