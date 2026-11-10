/**
 * Tool meta helpers — icon and friendly label for each known tool call.
 */
import {
  Scissors,
  ZoomIn,
  Clock,
  Palette,
  FileText,
  Volume,
  Camera,
  Wand,
  Bolt,
  Trash,
  MapPin,
  Star,
  type Icon,
} from 'tabler-icons-react'

export function friendlyToolLabel(name: string, args: Record<string, unknown>): string {
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
      return `Seek to ${typeof args.time === 'number' ? args.time.toFixed(1) + 's' : 'position'}`
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
    case 'delete_camera_motion':
      return 'Remove camera motion'
    case 'set_cursor_style':
      return 'Update cursor style & effects'
    case 'set_audio_volume':
      return `Set master volume to ${Math.round(Number(args.volume ?? 1) * 100)}%`
    case 'set_audio_muted':
      return args.muted ? 'Mute audio' : 'Unmute audio'
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
    case 'get_video_frame_at':
      return 'Capture frame'
    default:
      return name.replace(/_/g, ' ')
  }
}

export function getToolIcon(name: string): Icon {
  const map: Record<string, Icon> = {
    add_zoom_region: ZoomIn,
    add_cut_region: Scissors,
    add_speed_region: Clock,
    update_region: Wand,
    delete_region: Trash,
    delete_selected: Trash,
    set_playhead: MapPin,
    run_tidy_up: Bolt,
    set_aspect_ratio: Star,
    set_frame_style: Star,
    set_background: Palette,
    add_visual_effect: Star,
    delete_visual_effect: Trash,
    add_camera_motion: Camera,
    delete_camera_motion: Camera,
    set_cursor_style: Wand,
    set_audio_volume: Volume,
    set_audio_muted: Volume,
    toggle_mouse_click_sounds: Volume,
    run_transcription: FileText,
    set_subtitles_enabled: FileText,
    update_subtitle_cue: FileText,
    remove_subtitle_cue: FileText,
    save_project: Wand,
    export_video: Wand,
    get_video_frame_at: Camera,
  }
  return map[name] ?? Wand
}
