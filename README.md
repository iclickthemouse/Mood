<p align="center">
  <img src="src/assets/mood-logo.svg" alt="Mood" width="220" />
</p>

<h3 align="center">Distill your mood into prompts.</h3>

---

**Mood is an infinite-canvas workspace that turns scattered visual inspiration into one clear creative direction — automatically.**

Drag reference photos onto the canvas, and Mood analyzes each one in real time — color, light, texture, composition, atmosphere — then synthesizes the whole board into a single cohesive image-to-text prompt. Add an image, remove one, and the prompt updates instantly to reflect the new direction.

You collect the way you always have — dragging, arranging, building boards. Mood just does the part that used to take hours of squinting and guessing: turning a pile of references into a clear, usable prompt you can hand to any model.

## What you can do

- **Infinite canvas** — drag, drop, and arrange reference images freely.
- **Live analysis** — every image is read for color, light, texture, composition, and atmosphere the moment you add it.
- **One cohesive prompt** — the whole board is fused into a single image-to-text prompt that updates instantly as the board changes.
- **Steer the direction** — weight any image up or down, and dial in how strongly it drives character, style, composition, or lighting.
- **Per-image focus** — flip any card to add *positive* (include) and *negative* (avoid) notes that flow straight into the prompt.
- **Export anywhere** — JSON, verbose / FLUX caption, Ideogram JSON, or Midjourney tags.
- **Prompt library** — save prompts as cards alongside the references that made them.

## Works with any model

Mood is model-agnostic:

- **Cloud** — OpenAI and Google Gemini (bring your own key; runs in the browser and the desktop app).
- **Local** — LM Studio and Ollama (best in the desktop app, which talks to local model servers natively — no CORS or setup headaches).

API keys live only in memory for the session and are never persisted.

## Download (desktop app)

Prebuilt macOS and Windows apps are published on the **[Releases](https://github.com/iclickthemouse/Mood/releases)** page:

- **macOS** — `.dmg` (universal: Apple Silicon + Intel)
- **Windows** — `.msi` or `.exe`

> Builds are currently unsigned. On macOS, right-click the app → **Open** the first time; on Windows, choose **More info → Run anyway** if SmartScreen appears.

## Run locally (web)

```bash
npm install
npm run dev
```

## Build the desktop app

Requires the [Rust toolchain](https://rustup.rs) in addition to Node.

```bash
npm install
npm run tauri:dev     # hot-reload desktop window
npm run tauri:build   # installer for the current OS
```

Both platforms are built in CI by `.github/workflows/release.yml` — push a version tag (e.g. `v0.1.0`) to produce a draft GitHub Release with installers attached.

## Repository layout

```txt
src/                UI, image analysis, and prompt synthesis
src-tauri/          desktop shell (Tauri v2)
.github/workflows/  GitHub Pages + desktop release workflows
```

## Roadmap

- **v2 — Voice boards.** The text counterpart to image distillation: turn writing samples into a reusable `skill.md` style profile that captures a voice the way image boards capture a look.

---

<p align="center"><em>Mood: distill your mood into prompts.</em></p>
