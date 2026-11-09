import type { ToolDefinition } from '../../../../shared/ai-types'

export const projectTools: ToolDefinition[] = [
  {
    name: 'save_project',
    description: 'Save the current project to disk.',
    parameters: {
      type: 'object',
      properties: {},
    },
    destructive: false,
  },
  {
    name: 'export_video',
    description: 'Open the video export dialog to render the project.',
    parameters: {
      type: 'object',
      properties: {},
    },
    destructive: false,
  },
]
