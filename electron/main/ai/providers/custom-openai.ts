import http from 'node:http'
import https from 'node:https'
import Store from 'electron-store'
import log from 'electron-log/main'
import type { AIProvider, ChatOptions } from './types'
import type { ChatChunk, ChatMessage, ToolDefinition } from '../../../../shared/ai-types'

const store = new Store()

function transportFor(url: URL) {
  return url.protocol === 'https:' ? https : http
}

export class CustomOpenAIProvider implements AIProvider {
  readonly id = 'custom-openai'
  readonly name = 'custom-openai'
  readonly displayName = 'Custom OpenAI / Compatible'

  async isAvailable(): Promise<boolean> {
    const apiKey = (store.get('ai.customOpenai.apiKey') as string) || ''
    const baseUrl = (store.get('ai.customOpenai.baseUrl') as string) || ''
    // If baseUrl is a local network (e.g., localhost:11434), apiKey can be empty
    if (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')) {
      return true
    }
    return Boolean(apiKey && apiKey.trim().length > 0)
  }

  estimateTokens(messages: ChatMessage[]): number {
    let charCount = 0
    for (const msg of messages) {
      charCount += (msg.content?.length ?? 0) + 10
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          charCount += tc.function.name.length + tc.function.arguments.length
        }
      }
    }
    return Math.ceil(charCount / 4)
  }

  async *chat(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    options: ChatOptions,
    signal: AbortSignal,
  ): AsyncIterable<ChatChunk> {
    const rawApiKey = (store.get('ai.customOpenai.apiKey') as string) || ''
    const rawBaseUrl = (store.get('ai.customOpenai.baseUrl') as string) || 'https://api.openai.com/v1'
    const storedModel = (store.get('ai.customOpenai.model') as string) || 'gpt-4o-mini'

    const baseUrl = rawBaseUrl.trim().replace(/\/+$/, '')
    const apiKey = rawApiKey.trim()
    const model = options.model || storedModel

    const endpoint = new URL(`${baseUrl}/chat/completions`)

    // Format tools for standard OpenAI tool schema
    const formattedTools = tools.length > 0 ? tools : undefined

    const payload = JSON.stringify({
      model,
      messages,
      tools: formattedTools,
      stream: true,
      stream_options: { include_usage: true },
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 2048,
    })

    const transport = transportFor(endpoint)

    type ChunkQueueItem = { type: 'chunk'; value: ChatChunk } | { type: 'error'; error: Error } | { type: 'end' }

    const queue: ChunkQueueItem[] = []
    let notifyPending: (() => void) | null = null

    const pushItem = (item: ChunkQueueItem) => {
      queue.push(item)
      if (notifyPending) {
        const cb = notifyPending
        notifyPending = null
        cb()
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    }
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`
    }

    const req = transport.request(
      endpoint,
      {
        method: 'POST',
        headers,
        signal,
      },
      (res) => {
        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          let errBody = ''
          res.on('data', (c) => (errBody += c))
          res.on('end', () => {
            pushItem({
              type: 'error',
              error: new Error(`OpenAI Provider error ${res.statusCode}: ${errBody || res.statusMessage}`),
            })
          })
          return
        }

        let buffer = ''
        const activeToolCalls = new Map<number, { id: string; name: string; args: string }>()

        res.setEncoding('utf8')
        res.on('data', (chunk: string) => {
          buffer += chunk
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const rawLine of lines) {
            const line = rawLine.trim()
            if (!line.startsWith('data:')) continue
            const dataStr = line.slice(5).trim()
            if (dataStr === '[DONE]') {
              pushItem({
                type: 'chunk',
                value: {
                  type: 'done',
                  inputTokens: 0,
                  outputTokens: 0,
                },
              })
              continue
            }

            try {
              const parsed = JSON.parse(dataStr)
              if (parsed.usage) {
                pushItem({
                  type: 'chunk',
                  value: {
                    type: 'done',
                    inputTokens: parsed.usage.prompt_tokens ?? 0,
                    outputTokens: parsed.usage.completion_tokens ?? 0,
                  },
                })
              }

              const choice = parsed.choices?.[0]
              if (!choice) continue

              const delta = choice.delta
              if (delta?.content) {
                pushItem({
                  type: 'chunk',
                  value: { type: 'text', delta: delta.content },
                })
              }

              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index ?? 0
                  if (tc.id || tc.function?.name) {
                    const callId = tc.id || `call_${idx}_${Date.now()}`
                    const callName = tc.function?.name || ''
                    activeToolCalls.set(idx, { id: callId, name: callName, args: '' })
                    pushItem({
                      type: 'chunk',
                      value: {
                        type: 'tool_call_start',
                        id: callId,
                        name: callName,
                      },
                    })
                  }

                  if (tc.function?.arguments) {
                    const current = activeToolCalls.get(idx)
                    if (current) {
                      current.args += tc.function.arguments
                      pushItem({
                        type: 'chunk',
                        value: {
                          type: 'tool_call_delta',
                          id: current.id,
                          argumentDelta: tc.function.arguments,
                        },
                      })
                    }
                  }
                }
              }

              if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'stop') {
                for (const [, call] of activeToolCalls) {
                  let parsedArgs: Record<string, unknown> = {}
                  try {
                    parsedArgs = JSON.parse(call.args || '{}')
                  } catch {
                    parsedArgs = {}
                  }
                  pushItem({
                    type: 'chunk',
                    value: {
                      type: 'tool_call_end',
                      id: call.id,
                      name: call.name,
                      arguments: parsedArgs,
                    },
                  })
                }
                activeToolCalls.clear()
              }
            } catch {
              // Ignore malformed sse chunk line
            }
          }
        })

        res.on('end', () => {
          pushItem({ type: 'end' })
        })

        res.on('error', (err) => {
          pushItem({ type: 'error', error: err })
        })
      },
    )

    req.on('error', (err) => {
      pushItem({ type: 'error', error: err })
    })

    req.write(payload)
    req.end()

    while (true) {
      if (queue.length === 0) {
        await new Promise<void>((resolve) => {
          notifyPending = resolve
        })
      }

      while (queue.length > 0) {
        const item = queue.shift()!
        if (item.type === 'error') {
          log.warn('[CustomOpenAIProvider] error:', item.error)
          yield { type: 'error', message: item.error.message }
          return
        }
        if (item.type === 'end') {
          return
        }
        yield item.value
      }
    }
  }
}
