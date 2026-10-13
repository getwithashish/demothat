/**
 * Builds FFmpeg arguments for screen, microphone, and webcam capture.
 */
export function buildFfmpegArgs(
  inputArgs: string[],
  hasWebcam: boolean,
  hasMic: boolean,
  screenOut: string,
  webcamOut?: string,
): string[] {
  // Recording output paths can survive a failed attempt. FFmpeg is spawned
  // without an interactive terminal, so overwrite them instead of waiting for
  // a confirmation that can never arrive.
  const finalArgs = ['-y', ...inputArgs]
  const micIndex = hasMic ? 0 : -1
  const webcamIndex = hasMic ? (hasWebcam ? 1 : -1) : hasWebcam ? 0 : -1
  const screenIndex = (hasMic ? 1 : 0) + (hasWebcam ? 1 : 0)

  // Map screen video and microphone audio to the SAME output. Previously the
  // mic mapping appended screenOut a second time, creating a second output
  // file target; FFmpeg could overwrite/fail on the video file, leaving an
  // audio-only MP4 that appears black or will not play in the editor.
  finalArgs.push('-map', `${screenIndex}:v`)
  if (hasMic) {
    finalArgs.push('-map', `${micIndex}:a`)
  }

  finalArgs.push('-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p')
  if (hasMic) {
    finalArgs.push('-c:a', 'aac', '-b:a', '192k')
  }
  finalArgs.push(screenOut)

  if (hasWebcam && webcamOut) {
    finalArgs.push(
      '-map',
      `${webcamIndex}:v`,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      webcamOut,
    )
  }

  return finalArgs
}
