// Shared types for the AI-native assistant layer across main, renderer, and API.

import type { TranscriptDocument } from './transcript'
import type { SubtitleCue } from './subtitles'

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ToolCallFunction {
  name: string
  arguments: string
}

export interface ToolCall {
  id: string
  type: 'function'
  function: ToolCallFunction
}

export interface ChatMessage {
  role: MessageRole
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
  /** True for actions that permanently delete or irreversibly alter user data. */
  destructive: boolean
}

export type ChatChunk =
  | { type: 'text'; delta: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_call_delta'; id: string; argumentDelta: string }
  | { type: 'tool_call_end'; id: string; name: string; arguments: Record<string, unknown> }
  | { type: 'tool_result'; id: string; name: string; result: unknown; error?: string }
  | { type: 'approval_required'; id: string; name: string; arguments: Record<string, unknown>; summary: string }
  | { type: 'done'; inputTokens: number; outputTokens: number; charge?: number; refund?: number }
  | { type: 'error'; message: string; code?: string }

export interface AIProjectContext {
  duration: number
  currentTime: number
  selectedRegionId: string | null
  selectedRegionType: string | null
  selectedRegionDetails: Record<string, unknown> | null
  aspectRatio: string
  frameStyles?: Record<string, unknown>
  cursorStyles?: Record<string, unknown>
  timelineSummary: {
    zoomRegionsCount: number
    cutRegionsCount: number
    speedRegionsCount: number
    videoClipsCount: number
    audioClipsCount: number
    subtitleCuesCount: number
    cameraMotionsCount: number
    visualEffectsCount: number
    compositionLayoutsCount: number
  }
  zoomRegions: Array<{
    id: string
    startTime: number
    duration: number
    zoomLevel: number
    targetX: number
    targetY: number
    mode?: string
  }>
  cutRegions: Array<{
    id: string
    startTime: number
    duration: number
    trimType?: string
  }>
  speedRegions: Array<{
    id: string
    startTime: number
    duration: number
    speed: number
  }>
  transcript: TranscriptDocument | null
  subtitleCues: SubtitleCue[]
  recentClicks: Array<{
    timestamp: number
    x: number
    y: number
    button?: string
  }>
  currentFrameBase64?: string
}

export interface AIChatRequest {
  messages: ChatMessage[]
  context: AIProjectContext
  autoApprove?: boolean
  providerId?: string
  model?: string
}

export interface AICapabilities {
  enabled: boolean
  creditsPerMillionInputTokens: number
  creditsPerMillionOutputTokens: number
  models: string[]
  maxContextTokens?: number
}

export interface AIApprovalDecision {
  toolCallId: string
  approved: boolean
}
