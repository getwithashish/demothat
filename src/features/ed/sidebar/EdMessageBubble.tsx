/**
 * Ed Message Bubble — renders a single chat message.
 *
 * User messages: right-aligned, accent bubble.
 * Ed text messages: left-aligned, avatar + text (no heavy bubble).
 * Ed action/tool messages: rendered by EdActionCard.
 *
 * Supports Markdown rendering, timestamps on hover, spring-in on appear.
 * Styled cleanly for both Light and Dark themes.
 */
import { motion } from 'motion/react'
import { User } from 'tabler-icons-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { DisplayMessage, ToolCallState } from '../../../components/ai/useAIChat'
import { EdAvatar } from './EdAvatar'
import { EdActionCard } from './EdActionCard'
import { useReducedMotion } from '../hooks/useReducedMotion'

interface EdMessageBubbleProps {
  message: DisplayMessage
  isStreamingLast?: boolean
  onApprove?: (id: string) => void
  onReject?: (id: string) => void
}

export function EdMessageBubble({ message, isStreamingLast, onApprove, onReject }: EdMessageBubbleProps) {
  const reduced = useReducedMotion()
  const isUser = message.role === 'user'
  const ts = message.id ? new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''

  if (isUser) {
    return (
      <motion.div
        className="group flex justify-end my-1.5"
        initial={reduced ? {} : { opacity: 0, x: 10, scale: 0.97 }}
        animate={{ opacity: 1, x: 0, scale: 1 }}
        transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <div className="flex max-w-[85%] items-start gap-2">
          <div className="flex flex-col items-end gap-1">
            <div className="rounded-2xl rounded-tr-sm bg-accent/15 px-3.5 py-2 text-[13px] text-fg leading-relaxed shadow-sm border border-accent/25">
              <p className="whitespace-pre-wrap">{message.content}</p>
            </div>
            <span className="text-[11px] text-muted/0 group-hover:text-muted/60 transition-colors px-1">{ts}</span>
          </div>
          <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ctl border border-line text-muted">
            <User size={13} />
          </div>
        </div>
      </motion.div>
    )
  }

  // Assistant message
  return (
    <motion.div
      className="group flex justify-start my-1.5"
      initial={reduced ? {} : { opacity: 0, x: -10, scale: 0.97 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <div className="flex max-w-[92%] items-start gap-2">
        <div className="mt-0.5 shrink-0">
          <EdAvatar size={24} streaming={isStreamingLast} />
        </div>
        <div className="flex-1 min-w-0">
          {/* Text content with Markdown support */}
          {message.content ? (
            <div className="rounded-2xl rounded-tl-sm bg-ctl/30 border border-line/60 px-3.5 py-2.5 text-[13px] text-fg shadow-sm leading-relaxed prose prose-sm max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  p: ({ children }) => <p className="mb-1 last:mb-0 leading-relaxed">{children}</p>,
                  code: ({ children }) => (
                    <code className="rounded bg-ctl px-1 py-0.5 font-mono text-[11px] text-accent border border-line/50">
                      {children}
                    </code>
                  ),
                  ul: ({ children }) => <ul className="list-disc list-inside mb-1 space-y-0.5">{children}</ul>,
                  ol: ({ children }) => <ol className="list-decimal list-inside mb-1 space-y-0.5">{children}</ol>,
                }}
              >
                {message.content}
              </ReactMarkdown>
            </div>
          ) : isStreamingLast ? (
            <ThinkingIndicator />
          ) : null}

          {/* Tool executions as action cards */}
          {message.toolExecutions && message.toolExecutions.length > 0 && (
            <div className="mt-1 space-y-1">
              {message.toolExecutions.map((tool: ToolCallState) => (
                <EdActionCard key={tool.id} tool={tool} onApprove={onApprove} onReject={onReject} />
              ))}
            </div>
          )}

          <span className="text-[11px] text-muted/0 group-hover:text-muted/60 transition-colors px-1">{ts}</span>
        </div>
      </div>
    </motion.div>
  )
}

function ThinkingIndicator() {
  return (
    <div className="inline-flex items-center gap-2 rounded-2xl rounded-tl-sm border border-line/60 bg-ctl/40 px-3 py-2 text-[12px] text-muted shadow-sm">
      <ThreeDots />
      <span>Ed is working on it…</span>
    </div>
  )
}

function ThreeDots() {
  return (
    <div className="flex items-center gap-0.5">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-muted/80"
          animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1, 0.8] }}
          transition={{
            repeat: Infinity,
            duration: 1.2,
            delay: i * 0.2,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  )
}
