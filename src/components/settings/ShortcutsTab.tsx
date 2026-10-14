import React from 'react'
import { Section } from '../ui/section'
import { PanelHeader } from '../editor/PanelHeader'

const ShortcutItem = ({ keys, description }: { keys: string[]; description: string }) => {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <p className="text-ui text-fg">{description}</p>
      <div className="flex shrink-0 items-center gap-1">
        {keys.map((key, index) => (
          <React.Fragment key={key}>
            <kbd className="rounded-ctl border border-line bg-ctl px-1.5 py-0.5 font-mono text-sm text-muted">
              {key}
            </kbd>
            {index < keys.length - 1 && <span className="text-sm text-muted">+</span>}
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

export function ShortcutsTab() {
  const shortcutCategories = [
    {
      title: 'Playback',
      shortcuts: [
        { keys: ['Space'], description: 'Play / Pause' },
        { keys: ['J'], description: 'Previous Frame' },
        { keys: ['K'], description: 'Next Frame' },
        { keys: ['←'], description: 'Seek Backward 1s' },
        { keys: ['→'], description: 'Seek Forward 1s' },
      ],
    },
    {
      title: 'Editing',
      shortcuts: [
        { keys: ['Cmd/Ctrl', 'Z'], description: 'Undo' },
        { keys: ['Cmd/Ctrl', 'Y'], description: 'Redo' },
        { keys: ['Cmd/Ctrl', 'Shift', 'Z'], description: 'Redo' },
        { keys: ['Delete'], description: 'Delete Region' },
        { keys: ['Backspace'], description: 'Delete Region' },
      ],
    },
    {
      title: 'Zoom',
      shortcuts: [
        { keys: ['Cmd/Ctrl', '+'], description: 'Zoom In (interface)' },
        { keys: ['Cmd/Ctrl', '−'], description: 'Zoom Out (interface)' },
        { keys: ['Cmd/Ctrl', '0'], description: 'Reset Interface Zoom' },
        { keys: ['Cmd/Ctrl', 'Shift', '+'], description: 'Zoom In (timeline)' },
        { keys: ['Cmd/Ctrl', 'Shift', '−'], description: 'Zoom Out (timeline)' },
        { keys: ['Cmd/Ctrl', 'Shift', '0'], description: 'Reset Timeline Zoom' },
      ],
    },
    {
      title: 'General',
      shortcuts: [
        { keys: ['F'], description: 'Toggle Fullscreen' },
        { keys: ['Esc'], description: 'Exit Fullscreen / Deselect' },
      ],
    },
  ]

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Keyboard shortcuts" subtitle="Every binding the editor listens for" />
      <div className="min-h-0 flex-1 overflow-y-auto stable-scrollbar">
        {shortcutCategories.map((category, index) => (
          <Section key={category.title} first={index === 0} label={category.title}>
            <div className="divide-y divide-line">
              {category.shortcuts.map((shortcut) => (
                <ShortcutItem key={shortcut.description} keys={shortcut.keys} description={shortcut.description} />
              ))}
            </div>
          </Section>
        ))}
      </div>
    </div>
  )
}
