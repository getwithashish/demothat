import type { ToolDefinition } from '../../../../shared/ai-types'

export const audioTools: ToolDefinition[] = [
  {
    name: 'set_audio_volume',
    description: 'Set the main master audio volume of the recording.',
    parameters: {
      type: 'object',
      properties: {
        volume: {
          type: 'number',
          description: 'Volume level from 0 (silent) to 1 (full).',
        },
      },
      required: ['volume'],
    },
    destructive: false,
  },
  {
    name: 'set_audio_muted',
    description: 'Mute or unmute the video audio track.',
    parameters: {
      type: 'object',
      properties: {
        muted: {
          type: 'boolean',
          description: 'True to mute, false to unmute.',
        },
      },
      required: ['muted'],
    },
    destructive: false,
  },
  {
    name: 'toggle_mouse_click_sounds',
    description: 'Enable or disable audible click sounds played on recorded mouse clicks.',
    parameters: {
      type: 'object',
      properties: {
        enabled: {
          type: 'boolean',
          description: 'Whether click sound effects are played.',
        },
        volume: {
          type: 'number',
          description: 'Volume of click sound effects from 0 to 1.',
        },
      },
      required: ['enabled'],
    },
    destructive: false,
  },
]
