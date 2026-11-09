import type { ToolDefinition } from '../../../../shared/ai-types'

export const frameTools: ToolDefinition[] = [
  {
    name: 'set_aspect_ratio',
    description:
      'Set the canvas aspect ratio (e.g., "16:9" for YouTube/Landscape, "9:16" for TikTok/Reels, "1:1" for Square, "4:3", "3:4").',
    parameters: {
      type: 'object',
      properties: {
        aspectRatio: {
          type: 'string',
          enum: ['16:9', '9:16', '4:3', '3:4', '1:1'],
          description: 'The target aspect ratio.',
        },
      },
      required: ['aspectRatio'],
    },
    destructive: false,
  },
  {
    name: 'set_frame_style',
    description: 'Adjust the window frame appearance: padding, rounded corners, drop shadow, and border.',
    parameters: {
      type: 'object',
      properties: {
        padding: {
          type: 'number',
          description: 'Padding inset percentage around the video (e.g. 0 to 20).',
        },
        borderRadius: {
          type: 'number',
          description: 'Corner radius in pixels (e.g. 0 to 40).',
        },
        shadowBlur: {
          type: 'number',
          description: 'Shadow blur radius in pixels (e.g. 0 to 60).',
        },
        shadowOffsetX: {
          type: 'number',
          description: 'Shadow horizontal offset in pixels.',
        },
        shadowOffsetY: {
          type: 'number',
          description: 'Shadow vertical offset in pixels.',
        },
        shadowColor: {
          type: 'string',
          description: 'Shadow color as rgba (e.g. "rgba(0, 0, 0, 0.7)").',
        },
        borderWidth: {
          type: 'number',
          description: 'Border thickness in pixels.',
        },
        borderColor: {
          type: 'string',
          description: 'Border color (e.g. "rgba(255, 255, 255, 0.2)").',
        },
      },
    },
    destructive: false,
  },
  {
    name: 'set_background',
    description: 'Change the canvas background behind the video (wallpaper, solid color, gradient, or custom image).',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['wallpaper', 'color', 'gradient', 'image'],
          description: 'Background category.',
        },
        color: {
          type: 'string',
          description: 'Hex or rgb color when type is "color".',
        },
        gradientStart: {
          type: 'string',
          description: 'Start color when type is "gradient".',
        },
        gradientEnd: {
          type: 'string',
          description: 'End color when type is "gradient".',
        },
        gradientDirection: {
          type: 'string',
          description: 'Direction of gradient (e.g. "to bottom right").',
        },
        imageUrl: {
          type: 'string',
          description: 'Image or wallpaper URL.',
        },
        thumbnailUrl: {
          type: 'string',
          description: 'Thumbnail URL if wallpaper.',
        },
      },
      required: ['type'],
    },
    destructive: false,
  },
  {
    name: 'add_visual_effect',
    description:
      'Add a visual highlight or redaction effect (mask, blur, focus, or border) over a specific region of the screen.',
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['mask', 'blur', 'focus', 'border'],
          description: 'Type of visual effect.',
        },
        shape: {
          type: 'string',
          enum: ['rectangle', 'square', 'circle'],
          description: 'Shape of the effect bounding area.',
        },
        startTime: {
          type: 'number',
          description: 'Start time in seconds on the timeline.',
        },
        duration: {
          type: 'number',
          description: 'Duration in seconds for the effect.',
        },
        x: {
          type: 'number',
          description: 'Normalized X position from 0 (left) to 1 (right). Default 0.3.',
        },
        y: {
          type: 'number',
          description: 'Normalized Y position from 0 (top) to 1 (bottom). Default 0.3.',
        },
        width: {
          type: 'number',
          description: 'Normalized width from 0 to 1. Default 0.4.',
        },
        height: {
          type: 'number',
          description: 'Normalized height from 0 to 1. Default 0.4.',
        },
      },
      required: ['kind'],
    },
    destructive: false,
  },
  {
    name: 'delete_visual_effect',
    description: 'Delete a visual effect by its ID.',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'ID of the visual effect to remove.',
        },
      },
      required: ['id'],
    },
    destructive: true,
  },
]
