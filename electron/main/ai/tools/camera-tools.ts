import type { ToolDefinition } from '../../../../shared/ai-types'

export const cameraTools: ToolDefinition[] = [
  {
    name: 'add_camera_motion',
    description: 'Add a dynamic 3D camera pan, dolly, or orbit movement across a time range.',
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: [
            'dolly-in',
            'dolly-out',
            'pan-left',
            'pan-right',
            'orbit-cw',
            'orbit-ccw',
            'breathing',
            'reset',
            'custom',
          ],
          description: 'Type of preset 3D camera move.',
        },
        startTime: {
          type: 'number',
          description: 'Start time in seconds on the timeline.',
        },
        endTime: {
          type: 'number',
          description: 'End time in seconds on the timeline.',
        },
        easing: {
          type: 'string',
          description: 'Transition curve (e.g., "ease-in-out", "linear").',
        },
      },
      required: ['kind', 'startTime', 'endTime'],
    },
    destructive: false,
  },
  {
    name: 'delete_camera_motion',
    description: 'Delete a camera motion clip by its ID.',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'ID of the camera motion track to delete.',
        },
      },
      required: ['id'],
    },
    destructive: true,
  },
]
