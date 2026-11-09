import type { ToolDefinition } from '../../../../shared/ai-types'

export const captionTools: ToolDefinition[] = [
  {
    name: 'run_transcription',
    description: 'Start AI audio transcription of the recording to produce searchable text and subtitle cues.',
    parameters: {
      type: 'object',
      properties: {
        language: {
          type: 'string',
          description: 'Optional ISO language code hint (e.g. "en", "es").',
        },
      },
    },
    destructive: false,
  },
  {
    name: 'set_subtitles_enabled',
    description: 'Enable or disable caption/subtitle export and on-screen display.',
    parameters: {
      type: 'object',
      properties: {
        enabled: {
          type: 'boolean',
          description: 'True to enable subtitles, false to disable.',
        },
        format: {
          type: 'string',
          enum: ['srt', 'vtt'],
          description: 'Subtitle export format.',
        },
      },
      required: ['enabled'],
    },
    destructive: false,
  },
  {
    name: 'update_subtitle_cue',
    description: 'Update the text content of an individual subtitle cue on the timeline.',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'ID of the subtitle cue.',
        },
        text: {
          type: 'string',
          description: 'New wording/text for the caption.',
        },
      },
      required: ['id', 'text'],
    },
    destructive: false,
  },
  {
    name: 'remove_subtitle_cue',
    description: 'Delete a single subtitle cue by ID.',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'ID of the cue to remove.',
        },
      },
      required: ['id'],
    },
    destructive: true,
  },
]
