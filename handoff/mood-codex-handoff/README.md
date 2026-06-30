# mood

mood is a React moodboard workspace for turning creative source material into usable model instructions.

- Image boards turn reference images into one synthesized image-generation prompt.
- Text boards turn writing samples into a reusable `skill.md` voice file.
- Image weights let the user decide which references should steer synthesis more heavily.
- Prompt output formats are: JSON, verbose/FLUX caption, Ideogram JSON, and Midjourney tags.

## Current state

This repo is a Vite handoff build generated from the current single-file React prototype.

The app entry point is:

```txt
src/App.jsx
```

Prompt instruction files live in:

```txt
prompts/mood-image-board-distillation-agent.skill.md
prompts/mood-text-board-distillation-agent.skill.md
```

Project context and earlier pitch material live in:

```txt
docs/
```

## Run locally

```bash
npm install
npm run dev
```

Then open the local Vite URL.

## Build

```bash
npm run build
```

## Known implementation note

The current prototype can call external model APIs directly from the browser for OpenAI, Gemini, and Ollama. That is useful for testing, but not production-safe for hosted use because browser-side API keys can be exposed. The recommended next build step is to add a server/API proxy and move provider calls behind server-side endpoints.

The `anthropic` provider path was written for an in-artifact environment and may not work as-is in a normal browser build. Codex should either replace it with a server-backed provider or make Anthropic a keyed server-side option.

## First Codex tasks to run

Start with one of these:

```txt
Review the mood repo. Explain the current architecture, identify the fastest path to a production-safe model API layer, and propose a small implementation plan before editing files.
```

```txt
Refactor model provider calls out of src/App.jsx into a small provider module, then add a server/API proxy so browser API keys are not exposed. Keep the existing UI behavior intact.
```

```txt
Wire the prompt instruction files in /prompts as the source of truth for image-board and text-board distillation. Remove duplicated long instruction strings from src/App.jsx where practical.
```

```txt
Add lightweight tests for image weight behavior: default weight is 1.0, weight edits trigger board synthesis, and weight edits do not re-run single-image analysis.
```

## Desktop app (Tauri)

mood ships as a Tauri desktop app for macOS and Windows. The desktop build is the
recommended way to use **local models** (LM Studio, Ollama): model calls are routed
through Tauri's native HTTP plugin (`src/App.jsx` → `appFetch`), which bypasses the
browser CORS and mixed-content restrictions that block `http://localhost` model
servers from a hosted web page.

Project layout:

```txt
src-tauri/            Rust shell + Tauri config
src-tauri/tauri.conf.json
src-tauri/capabilities/default.json   HTTP allow-list (providers + localhost)
```

### Run / build locally

Requires the Rust toolchain (https://rustup.rs) in addition to Node.

```bash
npm install
npm run tauri:dev     # hot-reload desktop window
npm run tauri:build   # produce an installer for the current OS
```

### Download builds (GitHub Releases)

The `.github/workflows/release.yml` workflow builds **both** platforms in CI:

1. Push a version tag — `git tag v0.1.0 && git push origin v0.1.0` — or run the
   workflow manually from the Actions tab.
2. CI builds on a macOS runner (universal `.dmg`, Apple Silicon + Intel) and a
   Windows runner (`.msi` / `.exe`) and creates a **draft GitHub Release** with
   the installers attached.
3. Open the draft under **Releases**, publish it, and share the download links.

### Signing note

CI builds are **unsigned**. macOS users right-click → Open (or
`xattr -dr com.apple.quarantine /Applications/mood.app`); Windows users click
"More info" → "Run anyway" on SmartScreen. Add an Apple Developer ID and a
Windows code-signing certificate to the workflow to remove these prompts.

## Hosting the web demo (GitHub Pages)

`.github/workflows/pages.yml` deploys the web build to GitHub Pages (enable
**Settings → Pages → Source: GitHub Actions**). The hosted web version works with
**cloud providers** (OpenAI, Gemini) using the user's own key. Local models do
**not** work from the hosted HTTPS page — use the desktop app for those.
