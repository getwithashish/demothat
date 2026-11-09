import { Wand, User, Loader2 } from 'tabler-icons-react'
import type { DisplayMessage } from './useAIChat'
import { AIToolCallBadge } from './AIToolCallBadge'

export function AIMessageBubble({ message, isStreamingLast }: { message: DisplayMessage; isStreamingLast?: boolean }) {
  const isUser = message.role === 'user'

  if (isUser) {
    return (
      <div className="flex justify-end my-2">
        <div className="flex max-w-[85%] items-start gap-2">
          <div className="rounded-2xl rounded-tr-sm bg-accent/20 px-3.5 py-2 text-xs text-fg">
            <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
          </div>
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent">
            <User size={14} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-start my-2">
      <div className="flex max-w-[90%] items-start gap-2">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-indigo-400">
          <Wand size={14} />
        </div>
        <div className="flex-1 overflow-hidden">
          {message.content ? (
            <div className="rounded-2xl rounded-tl-sm bg-panel border border-border/50 px-3.5 py-2.5 text-xs text-fg shadow-sm">
              <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
            </div>
          ) : isStreamingLast ? (
            <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm bg-panel border border-border/50 px-3 py-2 text-xs text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
              <span>Ed is thinking...</span>
            </div>
          ) : null}

          {/* Render any tools executed as part of this turn */}
          {message.toolExecutions && message.toolExecutions.length > 0 && (
            <div className="mt-1 space-y-1">
              {message.toolExecutions.map((tool) => (
                <AIToolCallBadge key={tool.id} tool={tool} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
