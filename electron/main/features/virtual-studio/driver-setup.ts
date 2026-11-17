import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import log from 'electron-log/main'
import { app } from 'electron'

export interface DriverStatusResult {
  cameraDriverInstalled: boolean
  micDriverInstalled: boolean
  cameraDevicePath?: string
  details?: string
}

const execPromise = (
  file: string,
  args: string[],
  options: { timeout?: number } = {},
): Promise<{ stdout: string; stderr: string; code: number }> => {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: options.timeout ?? 5000 }, (error, stdout, stderr) => {
      if (error) {
        resolve({
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? error.message),
          code: (error as { code?: number })?.code ?? 1,
        })
      } else {
        resolve({
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          code: 0,
        })
      }
    })
  })
}

/**
 * Checks Linux virtual camera driver (v4l2loopback).
 */
export async function checkLinuxCameraDriver(): Promise<{ installed: boolean; devicePath?: string }> {
  try {
    // 1. Check if /sys/module/v4l2loopback exists
    try {
      await fs.access('/sys/module/v4l2loopback')
      // Try to find device in /sys/class/video4linux
      const v4lDir = '/sys/class/video4linux'
      const entries = await fs.readdir(v4lDir)
      for (const entry of entries) {
        const namePath = path.join(v4lDir, entry, 'name')
        try {
          const cardName = (await fs.readFile(namePath, 'utf8')).trim()
          if (cardName.includes('DemoThat') || cardName.includes('v4l2loopback') || cardName.includes('Virtual')) {
            return { installed: true, devicePath: `/dev/${entry}` }
          }
        } catch {
          // ignore individual read errors
        }
      }
      // If module is loaded and /dev/video10 exists
      try {
        await fs.access('/dev/video10')
        return { installed: true, devicePath: '/dev/video10' }
      } catch {
        // Module loaded, maybe default video device
        if (entries.length > 0) {
          return { installed: true, devicePath: `/dev/${entries[entries.length - 1]}` }
        }
        return { installed: true, devicePath: '/dev/video10' }
      }
    } catch {
      // Module path check failed, check lsmod
      const { stdout } = await execPromise('lsmod', [])
      if (stdout.includes('v4l2loopback')) {
        return { installed: true, devicePath: '/dev/video10' }
      }
    }
  } catch (err) {
    log.debug('[DriverSetup] Linux camera check encountered error:', err)
  }
  return { installed: false }
}

/**
 * Checks Linux virtual audio sink and source (PulseAudio or PipeWire).
 */
export async function checkLinuxAudioSink(): Promise<boolean> {
  try {
    const { stdout } = await execPromise('pactl', ['list', 'short', 'sources'])
    if (stdout.includes('demothat_virtual_mic') || stdout.includes('demothat_mic')) {
      return true
    }
    return false
  } catch {
    return false
  }
}

/**
 * Checks Windows virtual camera driver registration.
 */
export async function checkWindowsCameraDriver(): Promise<boolean> {
  try {
    // Query registry for DemoThat DirectShow filter CLSID or check binaries
    const clsid = '{8E28C8A0-58F3-46B9-B3A9-D95427BE82B6}'
    const { code } = await execPromise('reg', ['query', `HKCR\\CLSID\\${clsid}`])
    if (code === 0) return true

    // Check 64-bit hive
    const { code: code64 } = await execPromise('reg', ['query', `HKLM\\SOFTWARE\\Classes\\CLSID\\${clsid}`])
    return code64 === 0
  } catch {
    return false
  }
}

/**
 * Checks macOS CMIOExtension or CoreMediaIO DAL plugin.
 */
export async function checkMacCameraDriver(): Promise<boolean> {
  try {
    // Check CoreMediaIO Plug-Ins directory
    const dalPath = '/Library/CoreMediaIO/Plug-Ins/DAL/DemoThatVirtualCamera.plugin'
    try {
      await fs.access(dalPath)
      return true
    } catch {
      // Check systemextensionsctl
      const { stdout } = await execPromise('systemextensionsctl', ['list'])
      if (stdout.includes('demothat') || stdout.includes('DemoThat')) {
        return true
      }
    }
  } catch {
    // ignore
  }
  return false
}

/**
 * Checks driver installation status for camera and microphone on host OS.
 */
export async function checkVirtualDrivers(platform: NodeJS.Platform = process.platform): Promise<DriverStatusResult> {
  if (platform === 'linux') {
    const cam = await checkLinuxCameraDriver()
    const mic = await checkLinuxAudioSink()
    return {
      cameraDriverInstalled: cam.installed,
      micDriverInstalled: mic,
      cameraDevicePath: cam.devicePath,
      details: cam.installed
        ? `v4l2loopback active on ${cam.devicePath ?? '/dev/video10'}`
        : 'v4l2loopback module not loaded',
    }
  }

  if (platform === 'win32') {
    const cam = await checkWindowsCameraDriver()
    return {
      cameraDriverInstalled: cam,
      micDriverInstalled: true, // Windows uses default loopback or virtual cable if configured
      details: cam ? 'DirectShow virtual camera filter registered' : 'DirectShow filter not registered',
    }
  }

  if (platform === 'darwin') {
    const cam = await checkMacCameraDriver()
    return {
      cameraDriverInstalled: cam,
      micDriverInstalled: true, // macOS BlackHole / native aggregate
      details: cam ? 'CMIOExtension active' : 'CMIOExtension not active in System Settings',
    }
  }

  return {
    cameraDriverInstalled: false,
    micDriverInstalled: false,
    details: `Unsupported platform: ${platform}`,
  }
}

/**
 * 1-click elevation installer for Linux (pkexec modprobe v4l2loopback).
 */
export async function installLinuxDriver(): Promise<{ success: boolean; error?: string }> {
  try {
    log.info('[DriverSetup] Attempting Linux v4l2loopback driver setup via pkexec')
    // Attempt loading v4l2loopback and configuring passwordless sudoers rule for dynamic unload on app exit
    const sudoersRule =
      'ALL ALL=(root) NOPASSWD: /usr/sbin/modprobe -r v4l2loopback, /usr/sbin/modprobe v4l2loopback *, /sbin/modprobe -r v4l2loopback, /sbin/modprobe v4l2loopback *'
    const script = `modprobe v4l2loopback video_nr=10 card_label="DemoThat Virtual Camera" exclusive_caps=1 max_buffers=4 && echo "${sudoersRule}" > /etc/sudoers.d/demothat-v4l2 && chmod 0440 /etc/sudoers.d/demothat-v4l2`

    let { code, stderr } = await execPromise('pkexec', ['sh', '-c', script], { timeout: 30000 })

    if (code !== 0) {
      // Fallback to simple modprobe without sudoers write if restricted
      const fallback = await execPromise(
        'pkexec',
        [
          'modprobe',
          'v4l2loopback',
          'video_nr=10',
          'card_label=DemoThat Virtual Camera',
          'exclusive_caps=1',
          'max_buffers=4',
        ],
        { timeout: 30000 },
      )
      code = fallback.code
      stderr = fallback.stderr
    }

    if (code !== 0) {
      log.warn(`[DriverSetup] pkexec modprobe failed: ${stderr}`)
      return { success: false, error: stderr || 'Failed to load v4l2loopback kernel module' }
    }

    // Set up PulseAudio null sink if not present
    try {
      await ensureLinuxAudioSink()
    } catch {
      // Audio null sink setup is optional/best-effort
    }

    return { success: true }
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Ensures Linux camera driver is loaded, using passwordless sudo if available.
 */
export async function ensureLinuxCameraDriver(): Promise<{ success: boolean; error?: string }> {
  try {
    const status = await checkLinuxCameraDriver()
    if (status.installed) {
      return { success: true }
    }
    const { code, stderr } = await execPromise(
      'sudo',
      [
        '-n',
        'modprobe',
        'v4l2loopback',
        'video_nr=10',
        'card_label=DemoThat Virtual Camera',
        'exclusive_caps=1',
        'max_buffers=4',
      ],
      { timeout: 5000 },
    )
    if (code === 0) {
      log.info('[DriverSetup] Successfully ensured Linux camera driver via passwordless sudo')
      return { success: true }
    }
    return { success: false, error: stderr || 'v4l2loopback module not loaded' }
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Ensures Linux PulseAudio/PipeWire virtual microphone source and null sink exist.
 */
export async function ensureLinuxAudioSink(): Promise<{ success: boolean; error?: string }> {
  try {
    // Step 1: Check if demothat_virtual_mic source exists via pactl list short sources
    const { stdout: sourcesOut } = await execPromise('pactl', ['list', 'short', 'sources'])
    // Step 2: Check if demothat_mic sink exists via pactl list short sinks
    const { stdout: sinksOut } = await execPromise('pactl', ['list', 'short', 'sinks'])

    if (sourcesOut.includes('demothat_virtual_mic') && sinksOut.includes('demothat_mic')) {
      return { success: true }
    }

    if (!sinksOut.includes('demothat_mic')) {
      const loadSink = await execPromise('pactl', [
        'load-module',
        'module-null-sink',
        'sink_name=demothat_mic',
        'sink_properties=device.description=DemoThat_Virtual_Audio',
      ])
      if (loadSink.code !== 0) {
        log.warn(`[DriverSetup] Failed to load module-null-sink: ${loadSink.stderr}`)
        return { success: false, error: loadSink.stderr || 'Failed to load module-null-sink' }
      }
    }

    if (!sourcesOut.includes('demothat_virtual_mic')) {
      // Step 3: Load module-remap-source master=demothat_mic.monitor source_name=demothat_virtual_mic source_properties=device.description="DemoThat Virtual Microphone"
      const loadSource = await execPromise('pactl', [
        'load-module',
        'module-remap-source',
        'master=demothat_mic.monitor',
        'source_name=demothat_virtual_mic',
        'source_properties=device.description=DemoThat_Virtual_Microphone',
      ])
      if (loadSource.code !== 0) {
        log.warn(`[DriverSetup] Failed to load module-remap-source: ${loadSource.stderr}`)
        return { success: false, error: loadSource.stderr || 'Failed to load module-remap-source' }
      }
    }

    return { success: true }
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Dynamically unloads Linux v4l2loopback kernel module so /dev/video10 disappears when app exits.
 */
export async function teardownLinuxCameraDriver(): Promise<{ success: boolean; error?: string }> {
  try {
    log.info('[DriverSetup] Teardown Linux camera driver (modprobe -r v4l2loopback)')
    const { code, stderr } = await execPromise('sudo', ['-n', 'modprobe', '-r', 'v4l2loopback'], { timeout: 5000 })
    if (code !== 0) {
      log.debug(`[DriverSetup] Passwordless sudo modprobe -r returned code ${code}: ${stderr}`)
      return { success: false, error: stderr }
    }
    log.info('[DriverSetup] Successfully unloaded v4l2loopback module')
    return { success: true }
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Dynamically unloads PulseAudio modules matching demothat_virtual_mic and demothat_mic so devices disappear when app exits.
 */
export async function teardownLinuxAudioSink(): Promise<{ success: boolean; error?: string }> {
  try {
    log.info('[DriverSetup] Teardown Linux audio virtual devices (demothat_virtual_mic and demothat_mic)')
    const { stdout } = await execPromise('pactl', ['list', 'short', 'modules'], { timeout: 5000 })
    const lines = stdout.split('\n')
    const seenIds = new Set<string>()
    for (const line of lines) {
      if (line.includes('demothat_virtual_mic') || line.includes('demothat_mic')) {
        const moduleId = line.trim().split(/\s+/)[0]
        if (moduleId && !isNaN(Number(moduleId)) && !seenIds.has(moduleId)) {
          seenIds.add(moduleId)
          log.info(`[DriverSetup] Unloading PulseAudio module ${moduleId}`)
          await execPromise('pactl', ['unload-module', moduleId], { timeout: 5000 })
        }
      }
    }
    return { success: true }
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * 1-click elevation installer for Windows (regsvr32 via elevated PowerShell).
 */
export async function installWindowsDriver(): Promise<{ success: boolean; error?: string }> {
  try {
    const binariesPath = app.isPackaged
      ? path.join(process.resourcesPath, 'binaries', 'windows', 'demothat-vcam.dll')
      : path.join(__dirname, '..', '..', '..', 'binaries', 'windows', 'demothat-vcam.dll')

    log.info(`[DriverSetup] Registering Windows DirectShow DLL at: ${binariesPath}`)

    const psCommand = `Start-Process regsvr32 -ArgumentList '/s', '${binariesPath}' -Verb runAs -Wait`
    const { code, stderr } = await execPromise('powershell.exe', ['-NoProfile', '-Command', psCommand], {
      timeout: 30000,
    })

    if (code !== 0) {
      return { success: false, error: stderr || 'Elevated registration failed' }
    }
    return { success: true }
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * 1-click elevation installer for macOS.
 */
export async function installMacDriver(): Promise<{ success: boolean; error?: string }> {
  try {
    log.info('[DriverSetup] Prompting user to authorize macOS CMIO Extension')
    // On macOS, trigger system extensions manager or prompt via osascript
    const script = 'tell application "System Settings" to activate'
    await execPromise('osascript', ['-e', script])
    return {
      success: true,
      error: 'Please approve "DemoThat Camera Extension" in System Settings > Privacy & Security > Camera Extensions.',
    }
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Unified 1-click driver installation helper.
 */
export async function installVirtualDrivers(
  platform: NodeJS.Platform = process.platform,
): Promise<{ success: boolean; error?: string }> {
  if (platform === 'linux') {
    return installLinuxDriver()
  }
  if (platform === 'win32') {
    return installWindowsDriver()
  }
  if (platform === 'darwin') {
    return installMacDriver()
  }
  return { success: false, error: `Unsupported platform ${platform}` }
}
