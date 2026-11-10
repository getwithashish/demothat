/**
 * Ed Action Registry — single source of truth for all Ed actions.
 * Used by: sidebar suggestion cards, slash commands, and the Ctrl+K command palette.
 *
 * To add a new action:
 * 1. Add an entry to ED_ACTIONS with a unique id, group, icon key, and run() fn.
 * 2. The entry will automatically appear in the palette, sidebar suggestions (if
 *    group is in SUGGESTION_GROUPS), and slash commands.
 */

import {
  Wand,
  Scissors,
  ZoomIn,
  FileText,
  Palette,
  Clock,
  Microphone,
  Camera,
  Volume,
  Bolt,
  Star,
  type Icon,
} from 'tabler-icons-react'

export type EdActionGroup = 'suggested' | 'edit' | 'emphasis' | 'style' | 'captions' | 'recent'

export interface EdAction {
  id: string
  title: string
  description: string
  /** Short label shown in context-aware palette entries */
  contextLabel?: (ctx: EdContext) => string
  icon: Icon
  group: EdActionGroup
  keywords: string[]
  shortcut?: string
  /** Send this prompt to Ed when the action is run */
  prompt: string | ((ctx: EdContext) => string)
}

export interface EdContext {
  currentTime: number
  selectedRegionId?: string | null
}

export const ED_ACTIONS: EdAction[] = [
  // ── Suggested ──────────────────────────────────────────────────────────
  {
    id: 'tidy-silences',
    title: 'Tidy up silences',
    description: 'Speed up dead air and long pauses automatically',
    icon: Bolt,
    group: 'suggested',
    keywords: ['tidy', 'silence', 'dead air', 'pause', 'speed'],
    prompt: 'Tidy up all silent and dead air stretches by speeding them up',
  },
  {
    id: 'zoom-on-click',
    title: 'Zoom on click',
    description: 'Add a zoom centered on the most recent mouse click',
    contextLabel: (ctx) => `Zoom on click near ${ctx.currentTime.toFixed(1)}s`,
    icon: ZoomIn,
    group: 'suggested',
    keywords: ['zoom', 'click', 'mouse', 'focus'],
    prompt: (ctx) => `Add a zoom region centered on my most recent mouse click near ${ctx.currentTime.toFixed(1)}s`,
  },
  {
    id: 'studio-style',
    title: 'Modern studio style',
    description: 'Frame padding, rounded corners, and deep shadow',
    icon: Palette,
    group: 'suggested',
    keywords: ['style', 'studio', 'frame', 'shadow', 'modern', 'padding'],
    prompt: 'Set modern studio frame style with 8% padding, rounded corners, and deep shadow',
  },
  {
    id: 'transcribe',
    title: 'Transcribe audio',
    description: 'Generate captions from your recording audio',
    icon: FileText,
    group: 'suggested',
    keywords: ['transcribe', 'captions', 'subtitles', 'audio', 'text'],
    prompt: 'Transcribe the audio in this recording to generate captions',
  },

  // ── Edit ───────────────────────────────────────────────────────────────
  {
    id: 'cut-from-playhead',
    title: 'Cut next 2 seconds',
    description: 'Remove 2 seconds of footage from the playhead',
    contextLabel: (ctx) => `Cut 2s from ${ctx.currentTime.toFixed(1)}s`,
    icon: Scissors,
    group: 'edit',
    keywords: ['cut', 'remove', 'delete', 'trim', 'playhead'],
    prompt: (ctx) => `Cut out the next 2 seconds starting from ${ctx.currentTime.toFixed(1)}s`,
  },
  {
    id: 'speed-up',
    title: 'Speed up selection',
    description: 'Make the selected or current region play faster',
    icon: Clock,
    group: 'edit',
    keywords: ['speed', 'faster', 'timelapse', 'region'],
    prompt: 'Speed up the current region by 1.5×',
  },
  {
    id: 'remove-dead-air',
    title: 'Remove dead stretches',
    description: 'Cut or compress long silent/inactive sections',
    icon: Bolt,
    group: 'edit',
    keywords: ['dead', 'silent', 'remove', 'cut', 'compress', 'inactive'],
    prompt: 'Remove or compress all silent and inactive sections from the recording',
  },

  // ── Emphasis ───────────────────────────────────────────────────────────
  {
    id: 'zoom-on-cursor',
    title: 'Zoom on cursor',
    description: 'Follow and zoom into where the cursor moves',
    contextLabel: (ctx) => `Zoom on cursor at ${ctx.currentTime.toFixed(1)}s`,
    icon: ZoomIn,
    group: 'emphasis',
    keywords: ['zoom', 'cursor', 'track', 'follow'],
    prompt: (ctx) => `Add a zoom region following the cursor position near ${ctx.currentTime.toFixed(1)}s`,
  },
  {
    id: 'camera-motion',
    title: 'Add camera motion',
    description: 'Cinematic pan or tilt across the frame',
    icon: Camera,
    group: 'emphasis',
    keywords: ['camera', 'motion', 'pan', 'tilt', '3d'],
    prompt: 'Add a smooth camera motion effect',
  },

  // ── Style ──────────────────────────────────────────────────────────────
  {
    id: 'change-background',
    title: 'Change background',
    description: 'Set a solid, gradient, or wallpaper background',
    icon: Palette,
    group: 'style',
    keywords: ['background', 'wallpaper', 'gradient', 'color'],
    prompt: 'Change the canvas background to a modern gradient',
  },
  {
    id: 'frame-shadow',
    title: 'Frame shadow',
    description: 'Add depth with a cinematic drop shadow under the recording',
    icon: Star,
    group: 'style',
    keywords: ['shadow', 'frame', 'depth', 'cinematic'],
    prompt: 'Add a deep cinematic shadow below the recording frame',
  },

  // ── Captions ───────────────────────────────────────────────────────────
  {
    id: 'enable-subtitles',
    title: 'Enable subtitles',
    description: 'Turn on the subtitle overlay in the preview',
    icon: FileText,
    group: 'captions',
    keywords: ['subtitles', 'captions', 'enable', 'show'],
    prompt: 'Enable subtitle captions overlay in the recording',
  },
  {
    id: 'set-volume',
    title: 'Adjust audio volume',
    description: 'Increase, decrease, or mute the master volume',
    icon: Volume,
    group: 'captions',
    keywords: ['volume', 'audio', 'mute', 'loud', 'quiet'],
    prompt: 'Set the master audio volume to 80%',
  },
  {
    id: 'microphone',
    title: 'Microphone settings',
    description: 'Manage microphone audio track',
    icon: Microphone,
    group: 'captions',
    keywords: ['microphone', 'mic', 'audio', 'track'],
    prompt: 'Adjust the microphone audio settings',
  },
  {
    id: 'wand-custom',
    title: 'Custom edit…',
    description: 'Describe any edit in plain language',
    icon: Wand,
    group: 'suggested',
    keywords: ['custom', 'edit', 'ask', 'describe'],
    prompt: '',
  },
]

export const SUGGESTION_GROUPS: EdActionGroup[] = ['suggested', 'emphasis', 'style', 'captions']

export function getActionById(id: string): EdAction | undefined {
  return ED_ACTIONS.find((a) => a.id === id)
}

export function getActionsByGroup(group: EdActionGroup): EdAction[] {
  return ED_ACTIONS.filter((a) => a.group === group)
}

export function resolvePrompt(action: EdAction, ctx: EdContext): string {
  if (typeof action.prompt === 'function') return action.prompt(ctx)
  return action.prompt
}
