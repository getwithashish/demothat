import { useState, useEffect, useRef } from 'react'
import { Wand, X, Loader2, ArrowRight } from 'tabler-icons-react'
import { useAIChat } from './useAIChat'
import { AIToolCallBadge } from './AIToolCallBadge'

interface AICommandBarProps {
  isOpen: boolean
  onClose: () => void
}

const QUICK_COMMANDS = [
  '⚡ Tidy up all dead stretches & silences',
  '🔍 Add zoom on most recent mouse click',
  '🎨 Apply modern studio frame padding and shadow',
  '✂️ Cut out the next 2 seconds from playhead',
  '💬 Transcribe recording and enable subtitles',
]

export function AICommandBar({ isOpen, onClose }: AICommandBarProps) {
  const { messages, isStreaming, sendPrompt } = useAIChat()
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50)
    } else {
      setInput('')
    }
  }, [isOpen])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const handleSend = (textToSend?: string) => {
    const text = textToSend || input
    if (!text.trim() || isStreaming) return
    sendPrompt(text)
    setInput('')
  }

  // Get the most recent assistant message to display in the command bar
  const lastAssistantMsg = messages
    .slice()
    .reverse()
    .find((m) => m.role === 'assistant')

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[15vh] backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-border/80 bg-panel shadow-2xl transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input Bar */}
        <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3.5 bg-ctl/30">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-tr from-indigo-500 to-purple-500 text-white shadow-sm">
            <Wand size={16} />
          </div>

          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder="Command Ed to edit... (e.g. 'Zoom on cursor', 'Tidy up silences')"
            className="flex-1 bg-transparent text-sm text-fg placeholder:text-muted outline-none"
          />

          <div className="flex items-center gap-2">
            {isStreaming ? (
              <Loader2 className="h-4 w-4 animate-spin text-accent" />
            ) : (
              <button
                type="button"
                onClick={() => handleSend()}
                disabled={!input.trim()}
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-white transition-opacity disabled:opacity-40"
              >
                <ArrowRight size={14} />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1 text-muted transition-colors hover:bg-ctl/50 hover:text-fg"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Live response / execution output */}
        {lastAssistantMsg && lastAssistantMsg.content && (
          <div className="border-b border-border/40 bg-ctl/10 p-4 text-xs">
            <div className="flex items-start gap-2 text-fg">
              <span className="font-semibold text-indigo-400">Ed:</span>
              <p className="whitespace-pre-wrap leading-relaxed">{lastAssistantMsg.content}</p>
            </div>

            {lastAssistantMsg.toolExecutions && lastAssistantMsg.toolExecutions.length > 0 && (
              <div className="mt-2 space-y-1">
                {lastAssistantMsg.toolExecutions.map((t) => (
                  <AIToolCallBadge key={t.id} tool={t} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Quick action suggestions */}
        <div className="p-3">
          <p className="px-2 pb-1.5 text-[11px] font-medium text-muted uppercase tracking-wider">Quick Actions</p>
          <div className="space-y-1">
            {QUICK_COMMANDS.map((cmd) => (
              <button
                key={cmd}
                type="button"
                disabled={isStreaming}
                onClick={() => handleSend(cmd)}
                className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs text-fg/80 transition-colors hover:bg-ctl/60 hover:text-fg active:bg-ctl"
              >
                <span>{cmd}</span>
                <span className="font-mono text-[11px] text-muted">↵</span>
              </button>
            ))}
          </div>
        </div>

        {/* Footer info */}
        <div className="flex items-center justify-between border-t border-border/40 bg-ctl/20 px-4 py-2 text-[11px] text-muted">
          <span>Esc to close</span>
          <span>Undo anytime with Cmd+Z</span>
        </div>
      </div>
    </div>
  )
}
