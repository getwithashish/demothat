import type { ToolDefinition } from '../../../../shared/ai-types'

export const timelineTools: ToolDefinition[] = [
  {
    name: 'add_zoom_region',
    description: 'Add a zoom region to focus in on a specific part of the screen at a given timestamp.',
    parameters: {
      type: 'object',
      properties: {
        startTime: {
          type: 'number',
          description: 'Start time in seconds on the timeline.',
        },
        duration: {
          type: 'number',
          description: 'Duration in seconds (default is 2.5s).',
        },
        zoomLevel: {
          type: 'number',
          description: 'Zoom magnification level (e.g., 1.5, 2.0, 3.0). Default is 2.0.',
        },
        targetX: {
          type: 'number',
          description: 'Horizontal center offset from -0.5 (left) to 0.5 (right). 0 is center.',
        },
        targetY: {
          type: 'number',
          description: 'Vertical center offset from -0.5 (top) to 0.5 (bottom). 0 is center.',
        },
        easing: {
          type: 'string',
          description: 'Easing curve (e.g., "ease-in-out", "linear", "ease-out").',
        },
        transitionDuration: {
          type: 'number',
          description: 'Speed of transition in seconds (e.g., 0.3, 0.5).',
        },
      },
      required: ['startTime'],
    },
    destructive: false,
  },
  {
    name: 'add_cut_region',
    description: 'Cut out a section of the recording so it is skipped during playback and export.',
    parameters: {
      type: 'object',
      properties: {
        startTime: {
          type: 'number',
          description: 'Start time in seconds on the timeline where the cut starts.',
        },
        duration: {
          type: 'number',
          description: 'Length of the cut in seconds.',
        },
      },
      required: ['startTime', 'duration'],
    },
    destructive: false,
  },
  {
    name: 'add_speed_region',
    description: 'Change the playback speed of a section of the video (e.g. 1.5x, 2x, 4x fast-forward).',
    parameters: {
      type: 'object',
      properties: {
        startTime: {
          type: 'number',
          description: 'Start time in seconds on the timeline.',
        },
        duration: {
          type: 'number',
          description: 'Duration in seconds for the speed-up effect.',
        },
        speed: {
          type: 'number',
          description: 'Speed multiplier (e.g. 1.5, 2, 3, 4).',
        },
      },
      required: ['startTime', 'duration', 'speed'],
    },
    destructive: false,
  },
  {
    name: 'update_region',
    description: 'Update properties of an existing zoom, cut, or speed region by its ID.',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The region ID (e.g. "zoom-1700000000000").',
        },
        updates: {
          type: 'object',
          description: 'Key-value pairs to update (startTime, duration, zoomLevel, targetX, targetY, speed, etc.).',
        },
      },
      required: ['id', 'updates'],
    },
    destructive: false,
  },
  {
    name: 'delete_region',
    description: 'Permanently remove a zoom, cut, or speed region from the timeline by its ID.',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The region ID to delete.',
        },
      },
      required: ['id'],
    },
    destructive: true,
  },
  {
    name: 'delete_selected',
    description: 'Delete whatever is currently selected on the timeline (region, effect, camera motion, clip).',
    parameters: {
      type: 'object',
      properties: {},
    },
    destructive: true,
  },
  {
    name: 'set_playhead',
    description: 'Move the editor playhead to a specific timestamp in seconds.',
    parameters: {
      type: 'object',
      properties: {
        time: {
          type: 'number',
          description: 'Target timestamp in seconds.',
        },
      },
      required: ['time'],
    },
    destructive: false,
  },
  {
    name: 'run_tidy_up',
    description: 'Automatically detect silent and inactive stretches in the recording and insert speed-up regions.',
    parameters: {
      type: 'object',
      properties: {},
    },
    destructive: false,
  },
]
