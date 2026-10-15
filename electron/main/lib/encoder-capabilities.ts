// Pure parsing of `ffmpeg -encoders` output. Kept dependency-free so the
// capability decision can be unit tested without spawning anything.

export interface EncoderCapabilities {
  /** The software HEVC encoder this app actually uses for 8K exports. */
  libx265: boolean
  /** Every HEVC encoder found, in the order ffmpeg listed them. */
  hevcEncoders: string[]
}

const HEVC_ENCODERS = ['libx265', 'hevc_nvenc', 'hevc_videotoolbox', 'hevc_v4l2m2m', 'hevc_qsv', 'hevc_amf']

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
  }
}
