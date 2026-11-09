import http from 'node:http'
import https from 'node:https'
import log from 'electron-log/main'
import type { AIProvider, ChatOptions } from './types'
import type { ChatChunk, ChatMessage, ToolDefinition } from '../../../../shared/ai-types'
import { getApiBaseUrl } from '../../lib/api-config'
import { getStoredToken } from '../../features/license-client'

function transportFor(url: URL) {
  return url.protocol === 'https:' ? https : http
}

export class ManagedCloudProvider implements AIProvider {
  readonly id = 'managed-cloud'
  readonly name = 'demothat-cloud'
  readonly displayName = 'DemoThat Cloud (Ed)'

  async isAvailable(): Promise<boolean> {
    const token = getStoredToken()
    return Boolean(token && token.length > 0)
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
    const token = getStoredToken()
    const baseUrl = getApiBaseUrl()

    if (!baseUrl) {
      throw new Error('API Base URL is not configured.')
    }

    const endpoint = new URL('/v1/ai/chat', `${baseUrl.replace(/\/+$/, '')}/`)
    const payload = JSON.stringify({
      messages,
      tools,
      model: options.model ?? 'ed-v1',
      stream: true,
      temperature: options.temperature ?? 0.7,
    })

    const transport = transportFor(endpoint)

    // Setup an internal queue to bridge Node stream chunks into an async generator
    const queue: Array<{ chunk?: ChatChunk; error?: Error; done?: boolean }> = []
    let notify: (() => void) | null = null

    const push = (item: { chunk?: ChatChunk; error?: Error; done?: boolean }) => {
      queue.push(item)
      if (notify) {
        const fn = notify
        notify = null
        fn()
      }
    }

    const req = transport.request(
      {
        method: 'POST',
        hostname: endpoint.hostname,
        port: endpoint.port,
        path: `${endpoint.pathname}${endpoint.search}`,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(payload)),
          Accept: 'text/event-stream',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          let errBody = ''
          res.on('data', (d) => (errBody += d.toString()))
          res.on('end', () => {
            push({ error: new Error(`Cloud AI returned HTTP ${res.statusCode}: ${errBody || res.statusMessage}`) })
          })
          return
        }

        let buffer = ''

        res.on('data', (chunkBuffer: Buffer) => {
          buffer += chunkBuffer.toString('utf8')
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? '' // Retain incomplete line

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed.startsWith('data:')) continue
            const jsonStr = trimmed.slice(5).trim()
            if (jsonStr === '[DONE]') {
              push({ done: true })
              return
            }
            try {
              const parsed = JSON.parse(jsonStr) as ChatChunk
              push({ chunk: parsed })
            } catch (err) {
              log.warn('[ManagedCloudProvider] Could not parse SSE line:', jsonStr, err)
            }
          }
        })

        res.on('end', () => {
          push({ done: true })
        })

        res.on('error', (err) => {
          push({ error: err })
        })
      },
    )

    req.on('error', (err) => {
      push({ error: err })
    })

    const abortHandler = () => {
      req.destroy()
      push({ error: new Error('Request was cancelled by user.') })
    }

    signal.addEventListener('abort', abortHandler, { once: true })

    req.write(payload)
    req.end()

    try {
      while (true) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            notify = resolve
          })
        }
        while (queue.length > 0) {
          const item = queue.shift()!
          if (item.error) throw item.error
          if (item.done) return
          if (item.chunk) yield item.chunk
        }
      }
    } finally {
      signal.removeEventListener('abort', abortHandler)
      req.destroy()
    }
  }
}
