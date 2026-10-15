// Upscale detection for the export modal.
//
// The implementation lives in shared/ so the main process can reuse the exact
// same maths for its export gate; it is re-exported here for renderer code.

export {
  UPSCALE_TOLERANCE,
  computeFrameContentSize,
  detectUpscale,
  maxCameraScale,
  maxZoomLevel,
} from '../../shared/export-upscale'
export type { FrameContentSize, FrameContentSizeInput, UpscaleInput, UpscaleResult } from '../../shared/export-upscale'
