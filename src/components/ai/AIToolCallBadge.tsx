import { Loader2, Check, AlertCircle, Clock } from 'tabler-icons-react'
import type { ToolCallState } from './useAIChat'

function friendlyToolLabel(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'add_zoom_region':
      return `Add Zoom (${args.zoomLevel ?? 2}× at ${typeof args.startTime === 'number' ? args.startTime.toFixed(1) + 's' : 'cursor'})`
    case 'add_cut_region':
      return `Cut out ${typeof args.duration === 'number' ? args.duration + 's' : 'segment'}`
    case 'add_speed_region':
      return `Speed up (${args.speed ?? 1.5}×)`
    case 'update_region':
      return `Update region ${args.id ?? ''}`
    case 'delete_region':
      return `Delete region ${args.id ?? ''}`
    case 'delete_selected':
      return 'Delete selected item'
    case 'set_playhead':
      return `Seek playhead to ${typeof args.time === 'number' ? args.time.toFixed(1) + 's' : 'time'}`
    case 'run_tidy_up':
      return 'Tidy up silences & inactive stretches'
    case 'set_aspect_ratio':
      return `Set aspect ratio to ${args.aspectRatio ?? '16:9'}`
    case 'set_frame_style':
      return 'Apply studio frame style'
    case 'set_background':
      return 'Change canvas background'
    case 'add_visual_effect':
      return `Add ${args.kind ?? 'visual'} effect`
    case 'delete_visual_effect':
      return 'Remove visual effect'
    case 'add_camera_motion':
      return `Add 3D camera move (${args.kind ?? 'pan'})`
    case 'set_cursor_style':
      return 'Update cursor style & effects'
    case 'set_audio_volume':
      return `Set master volume to ${Math.round(Number(args.volume ?? 1) * 100)}%`
    case 'toggle_mouse_click_sounds':
      return `${args.enabled ? 'Enable' : 'Disable'} click sounds`
    case 'run_transcription':
      return 'Transcribe audio to captions'
    case 'set_subtitles_enabled':
      return `${args.enabled ? 'Enable' : 'Disable'} captions`
    case 'update_subtitle_cue':
      return 'Edit caption cue'
    case 'remove_subtitle_cue':
      return 'Delete caption cue'
    case 'save_project':
      return 'Save project file'
    case 'export_video':
      return 'Prepare video export'
    default:
      return name.replace(/_/g, ' ')
  }
}

export function AIToolCallBadge({ tool }: { tool: ToolCallState }) {
  const label = friendlyToolLabel(tool.name, tool.args)

  return (
    <div className="my-1.5 flex items-center justify-between gap-2 rounded-md border border-border/60 bg-ctl/40 px-2.5 py-1.5 text-xs">
      <div className="flex items-center gap-2 overflow-hidden">
        {tool.status === 'running' && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />}
        {tool.status === 'success' && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
        {tool.status === 'error' && <AlertCircle className="h-3.5 w-3.5 shrink-0 text-danger" />}
        {tool.status === 'pending_approval' && <Clock className="h-3.5 w-3.5 shrink-0 text-amber-500" />}

        <span className="truncate font-mono font-medium text-fg">{label}</span>
      </div>

      <span
        className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${
          tool.status === 'running'
            ? 'bg-accent/15 text-accent'
            : tool.status === 'success'
              ? 'bg-emerald-500/15 text-emerald-500'
              : tool.status === 'error'
                ? 'bg-danger/15 text-danger'
                : 'bg-amber-500/15 text-amber-500'
        }`}
      >
        {tool.status === 'pending_approval' ? 'Waiting' : tool.status}
      </span>
    </div>
  )
}
