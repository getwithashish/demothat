// Pure parsing of `ffmpeg -encoders` output. Kept dependency-free so the
// capability decision can be unit tested without spawning anything.

export interface EncoderCapabilities {
  /** The software HEVC encoder this app actually uses for 8K exports. */
  libx265: boolean
  /** Every HEVC encoder found, in the order ffmpeg listed them. */
  hevcEncoders: string[]
  /** The software H.264 encoder. */
  libx264: boolean
  /** Every H.264 encoder found. */
  h264Encoders: string[]
}

const HEVC_ENCODERS = ['libx265', 'hevc_nvenc', 'hevc_videotoolbox', 'hevc_v4l2m2m', 'hevc_qsv', 'hevc_amf']

export const H264_HARDWARE_ENCODERS = ['h264_nvenc', 'h264_videotoolbox', 'h264_vaapi', 'h264_qsv'] as const
export const H264_ENCODERS = ['libx264', ...H264_HARDWARE_ENCODERS] as const

/** Parses the output of `ffmpeg -hide_banner -encoders`. */
export function parseEncoderCapabilities(encoderList: string): EncoderCapabilities {
  const names = new Set<string>()
  for (const line of encoderList.split('\n')) {
    // Lines look like " V....D libx265   libx265 H.265 / HEVC (codec hevc)";
    // the flags column is fixed-width, so the name is the second token.
    const name = line.trim().split(/\s+/)[1]
    if (name) names.add(name)
  }

  return {
    libx265: names.has('libx265'),
    hevcEncoders: HEVC_ENCODERS.filter((encoder) => names.has(encoder)),
    libx264: names.has('libx264'),
    h264Encoders: H264_ENCODERS.filter((encoder) => names.has(encoder)),
  }
}

/**
 * Returns the best available H.264 encoder.
 * Hardware GPU encoders take priority (NVENC, VideoToolbox, VAAPI, QSV) for maximum
 * parallel throughput; falls back to libx264.
 */
export function selectBestH264Encoder(capabilities?: EncoderCapabilities | null): string {
  if (!capabilities) return 'libx264'
  for (const encoder of H264_HARDWARE_ENCODERS) {
    if (capabilities.h264Encoders.includes(encoder)) {
      return encoder
    }
  }
  return capabilities.libx264 ? 'libx264' : 'libx264'
}
