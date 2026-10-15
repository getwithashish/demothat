# DemoThat 🎬

<div align="center">
  <img src="docs/assets/small-banner.png" alt="DemoThat Banner">
</div>

<div align="center">
  <img src="https://img.shields.io/github/v/release/getwithashish/DemoThat?style=for-the-badge" alt="Latest Release" />
  <img src="https://img.shields.io/github/license/getwithashish/DemoThat?style=for-the-badge" alt="License" />
  <img src="https://img.shields.io/github/downloads/getwithashish/DemoThat/total?style=for-the-badge&color=green" alt="Total Downloads" />
  <a href="https://github.com/sponsors/getwithashish"><img src="https://img.shields.io/badge/Sponsor-%E2%9D%A4-ea4aaa?style=for-the-badge&logo=githubsponsors" alt="Sponsor this project" /></a>
</div>

<div align="center">
  <h3>✨ Create cinematic screen recordings with automatic pan-and-zoom effects ✨</h3>
</div>

**DemoThat** is a smart screen recording and editing tool that makes professional video creation effortless. It automatically tracks your mouse movements and clicks, creating smooth cinematic animations that keep viewers focused on what matters. **No manual keyframing needed!**

Perfect for developers, educators, and content creators who want to produce stunning tutorials, demos, and presentations.

## 🎥 Demo

![Demo Video](docs/assets/demothat-demo.gif)

---

## ⭐ Features

- 🎥 **Flexible Capture**: Record your full screen, a specific window, or a custom area with seamless multi-monitor support.
- 👤 **Webcam Overlay**: Add a personal touch by including your webcam feed in the recording.
- 🎬 **Cinematic Mouse Tracking**: Automatically generates smooth pan-and-zoom effects that follow your mouse clicks, keeping the action front and center.
- 🎨 **Powerful Editor**: A visual timeline to easily trim clips, customize frames, backgrounds (colors, gradients, wallpapers), shadows, and more.
- 📏 **Instant Aspect Ratios**: Switch between 16:9 (YouTube), 9:16 (Shorts/TikTok), and 1:1 (Instagram) with a single click.
- 💾 **Preset System**: Save your favorite styles and apply them instantly to future projects for a consistent look.
- 📤 **High-Quality Export**: Export your masterpiece as an MP4 or GIF with resolutions up to 2K.

---

## 🚀 Installation

Grab the latest version for your OS from the [**Releases Page**](https://github.com/getwithashish/DemoThat/releases/latest).

### 🐧 Linux Instructions

#### Prerequisites

- **X11 Display Server Required** - DemoThat currently doesn't support Wayland.
  - Check your session type: `echo $XDG_SESSION_TYPE`
  - If it shows `wayland`, switch to X11 from your login screen.

#### Installation Steps

1. **Download** the latest AppImage:

   ```bash
   wget https://github.com/getwithashish/DemoThat/releases/latest/download/DemoThat-*-linux-x64.AppImage
   ```

2. **Make it executable**:

   ```bash
   chmod +x DemoThat-*-linux-x64.AppImage
   ```

3. **Run DemoThat**:
   - Double-click the file in your file manager, or
   - Run from terminal:
     ```bash
     ./DemoThat-*-linux-x64.AppImage
     ```

#### Troubleshooting

- If you get permission errors, ensure the file is executable
- For AppImage issues, try running with `--no-sandbox` flag

### 🪟 Windows Instructions

#### Security Notice

> **🔒 Important:** As a new open-source project, we don't have a code signing certificate yet. You may see security warnings during installation.
>
> **To proceed safely:**
>
> - In your browser, click "Keep" or "Keep anyway" when downloading
> - On the SmartScreen prompt, click "More info" → "Run anyway"
>
> Our code is [fully open source](https://github.com/getwithashish/DemoThat) for your review.

#### Installation Steps

1. **Download** the latest Windows installer:
   - Visit our [Releases Page](https://github.com/getwithashish/DemoThat/releases/latest)
   - Download the `DemoThat-*-Setup.exe` file

2. **Run the installer**:
   - Locate the downloaded file (usually in your `Downloads` folder)
   - Double-click to start the installation
   - Follow the on-screen instructions

### 🍏 macOS Instructions

#### Security Notice

> **🔒 Important:** As a new open-source project, we don't have a code signing certificate yet. You'll need to authorize the app to run on your Mac.
>
> **To proceed safely:**
>
> 1. After downloading and attempting to open the app, you'll see a security warning
> 2. Close the warning dialog
> 3. Open System Settings > Privacy & Security
> 4. Scroll down to the "Security" section
> 5. Click "Open Anyway" next to the warning about DemoThat
> 6. Click "Open" in the confirmation dialog
>
> Our code is [fully open source](https://github.com/getwithashish/DemoThat) for your review

#### Installation Steps

1. **Download** the appropriate macOS package for your system:
   - Visit our [Releases Page](https://github.com/getwithashish/DemoThat/releases/latest)
   - For Apple Silicon (M1/M2/M3) Macs: Download `DemoThat-*-arm64.dmg`
   - For Intel Macs: Download `DemoThat-*-x64.dmg`

2. **Install DemoThat**:
   - Open the downloaded `.dmg` file
   - Drag the DemoThat app to your Applications folder
   - Open from Launchpad or Applications folder

---

## 🛠️ Tech Stack

- **⚡ Core Framework**: Electron, Vite, TypeScript
- **💅 Frontend**: React, TailwindCSS
- **📦 State Management**: Zustand with Immer & Zundo (for undo/redo)
- **🎥 Backend & Video Processing**: Node.js, FFmpeg

---

## 🔧 Development Setup Guide

### Prerequisites

- **Linux:** Ensure you are on an X11 session, not Wayland.
- **Windows:**
  1.  Install [Build Tools for Visual Studio 2022](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the "Desktop development with C++" workload.
  2.  Install [Python 3.8](https://www.python.org/downloads/release/python-3810/) and add it to your PATH.
- **macOS:**
  1. Install [Xcode Command Line Tools](https://developer.apple.com/xcode/resources/)
  2. Install [Python 3.8](https://www.python.org/downloads/release/python-3810/) and add it to your PATH.

### Setup Steps

1.  **Clone the repo:**
    ```bash
    git clone https://github.com/getwithashish/DemoThat.git
    cd DemoThat
    ```
2.  **Install dependencies:**
    ```bash
    rm package-lock.json
    npm install
    ```
3.  **Set up FFmpeg:**
    - Download the appropriate FFmpeg executable from [screenarc-assets](https://github.com/tamnguyenvan/screenarc-assets/releases/tag/v0.0.1) and place it in the `binaries/[os]` directory.

    ```bash
    # Linux
    wget https://github.com/tamnguyenvan/screenarc-assets/releases/download/v0.0.1/ffmpeg-linux-x64 -O binaries/linux/ffmpeg
    chmod +x binaries/linux/ffmpeg

    # macOS (Apple Silicon)
    wget https://github.com/tamnguyenvan/screenarc-assets/releases/download/v0.0.1/ffmpeg-darwin-arm64 -O binaries/darwin/ffmpeg-arm64
    chmod +x binaries/darwin/ffmpeg-arm64

    # macOS (Intel)
    wget https://github.com/tamnguyenvan/screenarc-assets/releases/download/v0.0.1/ffmpeg-darwin-x64 -O binaries/darwin/ffmpeg-x64
    chmod +x binaries/darwin/ffmpeg-x64

    # Windows
    wget https://github.com/tamnguyenvan/screenarc-assets/releases/download/v0.0.1/ffmpeg.exe -O binaries/windows/ffmpeg.exe
    ```

4.  **Run in development mode:**
    ```bash
    npm run dev
    ```

## 💖 Sponsor This Project

DemoThat is free and open source. If it saves you time, please consider [sponsoring the project](https://github.com/sponsors/getwithashish) to support continued development.

---

## 🤝 Contributing

A huge thank you to everyone who has contributed to making DemoThat better!

Commits follow the [Conventional Commits](https://www.conventionalcommits.org/) format, because releases are fully automated from them. Every push to `main` is analysed and, when it contains releasable changes, a new [semantic version](https://semver.org/) is published:

| Commit                                                   | Release                   |
| -------------------------------------------------------- | ------------------------- |
| `fix: ...`, `perf: ...`                                  | Patch (`1.0.0` → `1.0.1`) |
| `feat: ...`                                              | Minor (`1.0.0` → `1.1.0`) |
| `feat!: ...`, or a `BREAKING CHANGE:` footer             | Major (`1.0.0` → `2.0.0`) |
| `docs:`, `chore:`, `refactor:`, `test:`, `ci:`, `style:` | No release                |

<a href="https://github.com/getwithashish/DemoThat/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=getwithashish/DemoThat" />
</a>

<br/>

---

## 🙏 Acknowledgements

DemoThat is a fork of [ScreenArc](https://github.com/tamnguyenvan/screenarc) by Tam Nguyen, and is modified and maintained by Ashish Sam. Thank you to the original author for releasing it as free software.

DemoThat stands on the shoulders of giants. This project would not be possible without the incredible work of the open-source community. A special thank you to the authors and maintainers of these key libraries & tools that handle low-level system interactions:

- [global-mouse-events](https://github.com/xanderfrangos/global-mouse-events): Mouse event listener on Windows
- [node-x11](https://github.com/sidorares/node-x11): X11 Node.js binding
- [Cursorful](https://cursorful.com/): I borrowed the Timeline design idea from them.

---

## 📜 License

This project is licensed under the [GPL-3.0 License](LICENSE).

- Copyright (C) 2025 Tam Nguyen (original ScreenArc)
- Copyright (C) 2026 Ashish Sam (modifications in DemoThat)

DemoThat is a modified version of ScreenArc. The original copyright notices are retained as required by the GPL, and the complete corresponding source for every release is available in this repository.
