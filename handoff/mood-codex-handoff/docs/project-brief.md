# mood project brief

mood is a creative board app that turns collected inspiration into usable model instructions.

## Product flow

1. User creates a board.
2. User chooses Image or Text.
3. User drops source material onto an infinite canvas.
4. The app analyzes the source material.
5. The board produces one reusable output.

## Image boards

Image boards accept photos or visual references. Each image is analyzed for subject, composition, color, texture, lighting, atmosphere, style, and promptable visual cues. The board then synthesizes those readings into one prompt.

Image board outputs can be formatted as:

- JSON
- verbose/FLUX caption
- Ideogram JSON
- Midjourney tags

Image weights let the user influence synthesis. Default weight is `1.0`. Higher-weight images steer the final prompt more. Lower-weight images become accents or narrow supporting references.

## Text boards

Text boards accept notes, pasted writing, or text files. After there are enough samples, the app analyzes voice, tone, rhythm, diction, themes, rhetorical habits, and avoidances. The output is a complete `skill.md` that can be reused as a writing-voice instruction file.

## Important behavior

- Moving canvas items does not regenerate content.
- Adding, removing, editing, or reweighting content does regenerate the board output.
- Image reweighting should not rerun single-image analysis.
- Edits are debounced.
- Stale async model results should be ignored.
- Work is currently in-session unless persistence is added later.

## Build priorities

1. Convert prototype into clean app architecture.
2. Move model calls behind a server/API layer.
3. Make prompt files the source of truth.
4. Add persistence.
5. Add tests around board signatures, debounced generation, weights, and output formats.
6. Improve UX for long model runs and failed generations.
