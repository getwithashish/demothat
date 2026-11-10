/**
 * Ed Command Palette — Surface B
 *
 * Built on cmdk Command.Dialog + Motion for animations.
 *
 * Features:
 * - Spring entrance/exit (scale + y + opacity)
 * - Fuzzy search with grouped results
 * - Sliding active-row highlight via Motion layoutId
 * - "Command Ed: <typed text>" always available
 * - Official Ed mascot icon
 * - Context-aware labels (live playhead in action labels)
 * - Keyboard: ↑↓ navigate, ↵ run, Tab autocomplete, Esc close
 * - Footer: navigation hints + platform undo hint
 * - Fully styled for both Dark and Light themes
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { Command } from 'cmdk'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight } from 'tabler-icons-react'
import { useAIChat } from '../../../components/ai/useAIChat'
import { useEdContext } from '../hooks/useEdContext'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { ED_ACTIONS, resolvePrompt, type EdActionGroup, type EdAction } from '../actions/registry'
import { cn } from '../../../lib/utils'

interface EdCommandPaletteProps {
  isOpen: boolean
  onClose: () => void
}

const GROUP_LABELS: Record<EdActionGroup, string> = {
  suggested: 'Suggested',
  edit: 'Edit',
  emphasis: 'Emphasis',
  style: 'Style',
  captions: 'Captions',
  recent: 'Recent',
}

const GROUP_ORDER: EdActionGroup[] = ['suggested', 'edit', 'emphasis', 'style', 'captions']

const PLACEHOLDER_EXAMPLES = [
  'Zoom on cursor…',
  'Tidy up silences…',
  'Speed up the first 5 seconds…',
  'Transcribe audio…',
  'Modern studio style…',
]

function isMac() {
  return typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)
}

export function EdCommandPalette({ isOpen, onClose }: EdCommandPaletteProps) {
  const { sendPrompt, isStreaming } = useAIChat()
  const ctx = useEdContext()
  const reduced = useReducedMotion()
  const [inputValue, setInputValue] = useState('')
  const [placeholderIdx, setPlaceholderIdx] = useState(0)
  const [activeHighlight, setActiveHighlight] = useState<string | null>(null)
  const prevFocusRef = useRef<HTMLElement | null>(null)

  // Rotate placeholder examples
  useEffect(() => {
    if (!isOpen) return
    const id = setInterval(() => setPlaceholderIdx((i) => (i + 1) % PLACEHOLDER_EXAMPLES.length), 2800)
    return () => clearInterval(id)
  }, [isOpen])

  // Save and restore focus
  useEffect(() => {
    if (isOpen) {
      prevFocusRef.current = document.activeElement as HTMLElement
    } else {
      setInputValue('')
      setActiveHighlight(null)
      setTimeout(() => prevFocusRef.current?.focus(), 50)
    }
  }, [isOpen])

  const run = useCallback(
    (promptText: string, keepOpen = false) => {
      if (!promptText.trim() || isStreaming) return
      sendPrompt(promptText)
      if (!keepOpen) onClose()
    },
    [sendPrompt, onClose, isStreaming],
  )

  // Group actions by their group field
  const grouped = GROUP_ORDER.map((g) => ({
    group: g,
    label: GROUP_LABELS[g],
    actions: ED_ACTIONS.filter((a: EdAction) => a.group === g && a.id !== 'wand-custom'),
  })).filter((g) => g.actions.length > 0)

  const springProps = reduced ? { duration: 0.1 } : { type: 'spring' as const, stiffness: 400, damping: 30 }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-[200] bg-scrim/80 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0.1 : 0.15 }}
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Dialog container */}
          <motion.div
            className="fixed inset-0 z-[201] flex items-start justify-center pt-[14vh] px-4 pointer-events-none"
            initial={{ opacity: 0, scale: reduced ? 1 : 0.96, y: reduced ? 0 : -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: reduced ? 1 : 0.97, y: reduced ? 0 : -4 }}
            transition={springProps}
          >
            <div
              className="pointer-events-auto relative w-full max-w-[560px] overflow-hidden rounded-[14px] border border-line bg-panel shadow-2xl"
              style={{ boxShadow: 'var(--sa-popover-shadow), 0 0 0 1px var(--sa-line)' }}
              onClick={(e) => e.stopPropagation()}
            >
              <Command
                label="Ed command palette"
                shouldFilter={true}
                loop
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    onClose()
                  }
                }}
                className="w-full bg-panel text-fg"
              >
                {/* Search input */}
                <div className="flex items-center gap-3 border-b border-line px-4 py-3 bg-ctl/30">
                  {/* Ed mascot avatar */}
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line/60 bg-ctl/70 p-0.5">
                    <img src="./demothat-mascot-ed-neutral.svg" alt="Ed" className="h-full w-full object-contain" />
                  </div>

                  <Command.Input
                    value={inputValue}
                    onValueChange={setInputValue}
                    placeholder={PLACEHOLDER_EXAMPLES[placeholderIdx]}
                    className="flex-1 bg-transparent text-[14px] font-medium text-fg placeholder:text-muted outline-none leading-none"
                    autoFocus
                  />

                  <div className="flex items-center gap-2 shrink-0">
                    {inputValue && (
                      <span className="rounded-md border border-line bg-ctl px-1.5 py-0.5 text-[11px] font-mono text-muted">
                        ↵
                      </span>
                    )}
                    <span className="rounded-md border border-line bg-ctl px-1.5 py-0.5 text-[11px] font-mono text-muted">
                      Esc
                    </span>
                  </div>
                </div>

                {/* Results list */}
                <Command.List
                  className="max-h-[380px] overflow-y-auto overscroll-contain no-scrollbar py-1.5"
                  role="listbox"
                >
                  <Command.Empty>
                    <div className="py-6 text-center">
                      <p className="text-sm text-muted">No matching actions</p>
                      {inputValue && (
                        <button
                          type="button"
                          className="mt-3 flex items-center gap-2 mx-auto rounded-lg bg-accent/15 px-3 py-1.5 text-sm text-accent hover:bg-accent/25 transition-colors"
                          onClick={() => run(inputValue)}
                        >
                          <img src="./demothat-mascot-ed-neutral.svg" alt="Ed" className="h-4 w-4 object-contain" />
                          Command Ed: &ldquo;{inputValue}&rdquo;
                        </button>
                      )}
                    </div>
                  </Command.Empty>

                  {/* Free-text Command Ed — always visible when typing */}
                  {inputValue.trim() && (
                    <Command.Group>
                      <PaletteItem
                        id="ask-ed-free"
                        icon={
                          <img src="./demothat-mascot-ed-neutral.svg" alt="Ed" className="h-4 w-4 object-contain" />
                        }
                        label={`Command Ed: "${inputValue}"`}
                        isActive={activeHighlight === 'ask-ed-free'}
                        onHighlight={() => setActiveHighlight('ask-ed-free')}
                        onSelect={() => run(inputValue)}
                        badge="Enter"
                      />
                    </Command.Group>
                  )}

                  {grouped.map(({ group, label, actions }) => (
                    <Command.Group key={group}>
                      <div
                        aria-hidden
                        className="mb-1 mt-2.5 px-3.5 text-[11px] font-semibold uppercase tracking-wider text-muted first:mt-1"
                      >
                        {label}
                      </div>
                      {actions.map((action: EdAction) => {
                        const displayLabel = action.contextLabel ? action.contextLabel(ctx) : action.title
                        const ActionIcon = action.icon
                        return (
                          <PaletteItem
                            key={action.id}
                            id={action.id}
                            icon={<ActionIcon size={16} className="text-muted" />}
                            label={displayLabel}
                            description={action.description}
                            isActive={activeHighlight === action.id}
                            onHighlight={() => setActiveHighlight(action.id)}
                            onSelect={() => run(resolvePrompt(action, ctx))}
                            shortcut={action.shortcut}
                          />
                        )
                      })}
                    </Command.Group>
                  ))}

                  {/* Custom Command Ed (at bottom when no input) */}
                  {!inputValue.trim() && (
                    <Command.Group>
                      <div
                        aria-hidden
                        className="mb-1 mt-2.5 px-3.5 text-[11px] font-semibold uppercase tracking-wider text-muted"
                      >
                        Custom
                      </div>
                      <PaletteItem
                        id="ask-ed-custom"
                        icon={
                          <img src="./demothat-mascot-ed-neutral.svg" alt="Ed" className="h-4 w-4 object-contain" />
                        }
                        label="Command Ed…"
                        description="Type a custom instruction in plain language"
                        isActive={activeHighlight === 'ask-ed-custom'}
                        onHighlight={() => setActiveHighlight('ask-ed-custom')}
                        onSelect={() => {
                          onClose()
                        }}
                      />
                    </Command.Group>
                  )}
                </Command.List>

                {/* Footer */}
                <div className="flex items-center justify-between border-t border-line/60 bg-ctl/30 px-4 py-2">
                  <span className="text-[11px] text-muted">
                    <span className="font-mono">↑↓</span> navigate <span className="font-mono">·</span>{' '}
                    <span className="font-mono">↵</span> run <span className="font-mono">·</span>{' '}
                    <span className="font-mono">esc</span> close
                  </span>
                  <span className="text-[11px] text-muted">
                    Undo with{' '}
                    <span className="rounded border border-line bg-ctl px-1 py-0.5 font-mono text-[11px]">
                      {isMac() ? '⌘Z' : 'Ctrl+Z'}
                    </span>
                  </span>
                </div>
              </Command>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

interface PaletteItemProps {
  id: string
  icon: React.ReactNode
  label: string
  description?: string
  isActive: boolean
  onHighlight: () => void
  onSelect: () => void
  shortcut?: string
  badge?: string
}

function PaletteItem({
  id,
  icon,
  label,
  description,
  isActive,
  onHighlight,
  onSelect,
  shortcut,
  badge,
}: PaletteItemProps) {
  return (
    <Command.Item
      value={id + ' ' + label}
      onSelect={onSelect}
      onMouseEnter={onHighlight}
      onFocus={onHighlight}
      className={cn(
        'relative mx-1.5 flex cursor-pointer select-none items-center gap-3 rounded-lg px-3 py-2 text-sm text-fg outline-none',
        'data-[selected=true]:bg-accent/10 data-[selected=true]:text-fg data-[selected=true]:shadow-sm',
        'hover:bg-ctl/60 transition-colors',
      )}
    >
      {/* Sliding background highlight */}
      {isActive && (
        <motion.div
          layoutId="palette-highlight"
          className="absolute inset-0 rounded-lg bg-ctl/80 border border-line/50"
          transition={{ type: 'spring', stiffness: 500, damping: 40 }}
          aria-hidden
        />
      )}

      <span className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line/60 bg-ctl/70">
        {icon}
      </span>

      <div className="relative z-10 min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-fg">{label}</p>
        {description && <p className="truncate text-[11px] text-muted leading-relaxed">{description}</p>}
      </div>

      <div className="relative z-10 shrink-0 flex items-center gap-1.5">
        {shortcut && (
          <span className="rounded border border-line bg-ctl px-1.5 py-0.5 font-mono text-[11px] text-muted">
            {shortcut}
          </span>
        )}
        {badge && (
          <span className="rounded border border-line bg-ctl px-1.5 py-0.5 font-mono text-[11px] text-muted">
            {badge}
          </span>
        )}
        <ArrowRight size={13} className="text-muted/60" />
      </div>
    </Command.Item>
  )
}
