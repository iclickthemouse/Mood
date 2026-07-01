# Mood — app

The Mood application: an infinite-canvas workspace that distills reference
images into one cohesive image-to-text prompt. Vite + React + Tailwind, packaged
as a Tauri desktop app.

See the [repository README](../../README.md) for what Mood is and how to use it.

## Develop

```bash
npm install
npm run dev          # web dev server (http://localhost:5173)
npm run tauri:dev    # desktop window (requires the Rust toolchain)
```

## Build

```bash
npm run build        # web build -> dist/
npm run tauri:build  # desktop installer for the current OS
```

## Structure

```txt
src/App.jsx     UI, image analysis, weighted prompt synthesis
src/index.css   theme + motion
src-tauri/      Tauri desktop shell + config
```

## Providers

Cloud providers (OpenAI, Gemini) work in the browser and the desktop app. Local
models (LM Studio, Ollama) work in the desktop app — model calls are routed
through Tauri's native HTTP layer (`appFetch` in `src/App.jsx`) so they bypass
browser CORS and mixed-content limits — or in `npm run dev` locally. API keys
live only in memory for the session and are never persisted.

## Desktop releases

`../../.github/workflows/release.yml` builds macOS + Windows in CI. Push a
version tag (e.g. `v0.1.0`) to produce a draft GitHub Release with installers.
CI builds are unsigned (see the root README for the first-launch steps).
