import { useState, useRef, useEffect } from 'react'
import { Wand, Send, Square, Pin, PinnedOff, Trash, ShieldCheck } from 'tabler-icons-react'
import { useAIChat } from './useAIChat'
import { AIMessageBubble } from './AIMessageBubble'
import { AIApprovalCard } from './AIApprovalCard'
import { Button } from '../ui/button'
import { useEditorStore } from '../../store/editorStore'

const QUICK_SUGGESTIONS = [
  { label: '⚡ Tidy up silences', prompt: 'Tidy up all silent and dead air stretches by speeding them up' },
  { label: '🔍 Zoom on click', prompt: 'Add a zoom region centered on my most recent mouse click' },
  {
    label: '🎨 Modern studio style',
    prompt: 'Set modern studio frame style with 8% padding, rounded corners, and deep shadow',
  },
  { label: '💬 Transcribe audio', prompt: 'Transcribe the audio in this recording to generate captions' },
]

export function AIPanel() {
  const {
    messages,
    isStreaming,
    pendingApproval,
    autoApproveAI,
    setAutoApproveAI,
    sendPrompt,
    approveTool,
    cancelStream,
    clearChat,
  } = useAIChat()

  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const aiPinned = useEditorStore((state) => state.aiPinned)
  const setAiPinned = useEditorStore((state) => state.setAiPinned)
  const balance = useEditorStore((state) => state.balance)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, pendingApproval])

  const handleSend = () => {
    if (!input.trim() || isStreaming) return
    sendPrompt(input)
    setInput('')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex h-full flex-col bg-panel text-fg select-none">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-tr from-indigo-500 to-purple-500 text-white shadow-sm">
            <Wand size={16} />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h2 className="text-sm font-semibold tracking-tight text-fg">Ed</h2>
              <span className="rounded-full bg-indigo-500/15 px-1.5 py-0.2 text-[11px] font-semibold text-indigo-400">
                AI Editor
              </span>
            </div>
            {typeof balance === 'number' && (
              <p className="text-[11px] text-muted font-mono">{balance.toLocaleString()} credits</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setAiPinned(!aiPinned)}
            title={aiPinned ? 'Unpin AI Sidebar' : 'Pin AI Sidebar side-by-side'}
            className={`rounded-md p-1.5 transition-colors ${
              aiPinned ? 'bg-accent/20 text-accent' : 'text-muted hover:bg-ctl/40 hover:text-fg'
            }`}
          >
            {aiPinned ? <PinnedOff size={15} /> : <Pin size={15} />}
          </button>
          <button
            type="button"
            onClick={clearChat}
            title="Clear conversation"
            className="rounded-md p-1.5 text-muted transition-colors hover:bg-ctl/40 hover:text-danger"
          >
            <Trash size={15} />
          </button>
        </div>
      </div>

      {/* Auto-Approve Toggle Strip */}
      <div className="border-b border-border/40 bg-ctl/20 px-3.5 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <ShieldCheck size={14} className={autoApproveAI ? 'text-emerald-500' : 'text-muted'} />
            <span className="text-xs font-medium text-fg">Auto-approve actions</span>
          </div>
          <input
            type="checkbox"
            checked={autoApproveAI}
            onChange={(e) => setAutoApproveAI(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border accent-accent cursor-pointer"
          />
        </div>
        <p className="text-[11px] text-muted mt-0.5">
          {autoApproveAI
            ? 'Ed applies edits immediately. (Undo anytime with Cmd+Z)'
            : 'Ed will ask confirmation before executing destructive deletions.'}
        </p>
      </div>

      {/* Messages Thread */}
      <div className="flex-1 overflow-y-auto px-3.5 py-2">
        {messages.map((msg, i) => (
          <AIMessageBubble key={msg.id} message={msg} isStreamingLast={isStreaming && i === messages.length - 1} />
        ))}

        {pendingApproval && (
          <AIApprovalCard
            toolCallId={pendingApproval.toolCallId}
            name={pendingApproval.name}
            args={pendingApproval.args}
            summary={pendingApproval.summary}
            onApprove={(id) => approveTool(id, true)}
            onReject={(id) => approveTool(id, false)}
          />
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick Suggestion Chips */}
      <div className="border-t border-border/30 px-3 py-2">
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {QUICK_SUGGESTIONS.map((item) => (
            <button
              key={item.label}
              type="button"
              disabled={isStreaming}
              onClick={() => sendPrompt(item.prompt)}
              className="shrink-0 rounded-full border border-border/60 bg-ctl/40 px-2.5 py-1 text-[11px] font-medium text-fg/90 transition-all hover:border-accent/50 hover:bg-accent/10 active:scale-95 disabled:opacity-50"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Input Box */}
      <div className="border-t border-border/50 p-3">
        <div className="relative rounded-xl border border-border/70 bg-ctl/50 focus-within:border-accent/80 focus-within:ring-1 focus-within:ring-accent/50 transition-all shadow-sm">
          <textarea
            ref={textareaRef}
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Ed anything or command an edit... (Enter to send)"
            className="w-full resize-none bg-transparent px-3 py-2 text-xs text-fg placeholder:text-muted outline-none"
          />

          <div className="flex items-center justify-between px-2.5 pb-2">
            <span className="text-[11px] text-muted">Cmd+K for quick command</span>
            {isStreaming ? (
              <Button
                variant="outline"
                size="sm"
                onClick={cancelStream}
                className="h-6 gap-1 border-danger/40 px-2 text-[11px] text-danger hover:bg-danger/10"
              >
                <Square size={11} />
                Stop
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={handleSend}
                disabled={!input.trim()}
                className="h-6 w-6 rounded-lg p-0"
              >
                <Send size={12} />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
