import type { ToolDefinition } from '../../../../shared/ai-types'

export const cursorTools: ToolDefinition[] = [
  {
    name: 'set_cursor_style',
    description: 'Configure cursor visibility, appearance, click ripple/scale animations, smoothing, and motion blur.',
    parameters: {
      type: 'object',
      properties: {
        showCursor: {
          type: 'boolean',
          description: 'Whether the mouse cursor is visible.',
        },
        cursorIcon: {
          type: 'string',
          enum: ['recorded', 'arrow', 'text', 'hand', 'crosshair', 'pointer'],
          description: 'The pointer graphic used.',
        },
        clickRippleEffect: {
          type: 'boolean',
          description: 'Whether clicking produces an animated ripple ring.',
        },
        clickRippleColor: {
          type: 'string',
          description: 'Color of the click ripple.',
        },
        clickScaleEffect: {
          type: 'boolean',
          description: 'Whether clicking shrinks the cursor momentarily.',
        },
        smoothingEnabled: {
          type: 'boolean',
          description: 'Whether jerky mouse movements are smoothed into a glide.',
        },
        smoothing: {
          type: 'number',
          description: 'Smoothing factor from 0 to 1.',
        },
        motionBlurEnabled: {
          type: 'boolean',
          description: 'Whether fast cursor movements produce realistic motion blur.',
        },
      },
    },
    destructive: false,
  },
]
