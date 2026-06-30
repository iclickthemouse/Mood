# AGENTS.md

## Project identity

This repository contains mood, a React moodboard workspace.

Core product contract:

- Image boards turn uploaded visual references into one synthesized image prompt.
- Text boards turn writing samples into a reusable `skill.md` voice file.
- Boards have independent state: canvas items, content, weights, selected prompt format, and output.
- Moving items on the canvas must not trigger generation.
- Content changes must trigger regeneration after debounce.
- Stale async results must be discarded.

## Current architecture

- Main app: `src/App.jsx`
- React entry: `src/main.jsx`
- Prompt instruction source files: `prompts/`
- Project/pitch context: `docs/`
- Styling: Tailwind classes in JSX plus `src/index.css`
- Build tool: Vite

## Commands

Run these after code changes when dependencies are installed:

```bash
npm run build
```

Run this during development:

```bash
npm run dev
```

If linting is configured or repaired, run:

```bash
npm run lint
```

Do not mark work complete without explaining which commands were run and whether they passed.

## Model/provider rules

The browser prototype currently contains direct provider calls. Treat that as prototype-only.

Production direction:

- Move model calls behind server/API routes before hosted deployment.
- Never hardcode API keys.
- Never log raw API keys.
- Do not commit `.env` files.
- Use `.env.example` for documented variables only.
- Keep provider adapters small and testable.
- Preserve OpenAI, Gemini, Ollama, and Anthropic concepts unless asked to remove one.

## Image board rules

Image-board distillation must use the weighted prompt instruction file:

```txt
prompts/mood-image-board-distillation-agent.skill.md
```

Image weights:

- Default image weight is `1.0`.
- Supported UI range is `0.1` to `5.0`.
- Weight changes must trigger board-level prompt synthesis.
- Weight changes must not re-run single-image visual analysis.
- Weight affects synthesis influence only. It does not change what is true in the image analysis.
- A high-weight image should lead only the visual dimensions it actually contributes: subject, composition, palette, lighting, texture, atmosphere, typography, or style.
- A low-weight image should act as an accent or narrow supporting reference.

Prompt format dropdown values:

- `json`
- `verbose_flux_caption`
- `ideogram_json`
- `midjourney_tags`

Do not remove these formats. If you add a format, update the prompt instruction file and the UI together.

## Text board rules

Text-board distillation must use:

```txt
prompts/mood-text-board-distillation-agent.skill.md
```

Text boards should generate a complete `skill.md` only when there is enough usable writing. Keep the five-note readiness behavior unless asked to change it.

Generated writing-voice skill files must not contain placeholders, TODOs, vague style advice, or app internals.

## UI behavior to preserve

- Board creation modal with Image/Text board selection.
- Left board list with type icon, rename, and delete behavior.
- Infinite canvas pan and zoom.
- Items freely movable.
- Image card drag handle is the image itself.
- Note card drag handle is the title bar so body text remains editable.
- Image cards include weight controls.
- Image board output format dropdown remains visible and functional.
- Copy/download output controls stay available.
- Regenerate button appears on generation failure.

## Code style

- Prefer small pure helper functions for board signatures, item updates, and provider payload construction.
- Avoid putting new long prompt strings directly inside React components.
- Keep app-facing instruction content in `prompts/` or a dedicated prompt module.
- Keep UI state updates immutable.
- Avoid adding heavy state-management libraries unless the task clearly requires it.
- Keep generated output parsing defensive.

## Review guidelines

When reviewing code, prioritize:

- Secret exposure in client-side code.
- Async race conditions in generation flows.
- Re-running expensive image analysis when only weight, layout, or prompt format changed.
- Broken output-format contracts.
- Prompt files drifting out of sync with UI format values.
- Unhandled provider errors.
- Large single-component complexity in `src/App.jsx`.
