import type { ChatChunk, ChatMessage, ToolDefinition } from '../../../../shared/ai-types'

export interface ChatOptions {
  model?: string
  temperature?: number
  maxTokens?: number
}

export interface AIProvider {
  /** Unique provider key, e.g. 'managed-cloud', 'openai', 'ollama', 'anthropic'. */
  readonly id: string
  /** Human-readable identifier for internal settings. */
  readonly name: string
  /** Friendly label for the settings UI. */
  readonly displayName: string

  /**
   * Primary streaming chat invocation.
   * Yields text tokens and tool-call events as they arrive from the upstream model.
   */
  chat(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    options: ChatOptions,
    signal: AbortSignal,
  ): AsyncIterable<ChatChunk>

  /** Check if this provider has required credentials or network reachability. */
  isAvailable(): Promise<boolean>

  /** Lightweight pre-flight token estimate for credit/cost budgeting. */
  estimateTokens(messages: ChatMessage[]): number
}
