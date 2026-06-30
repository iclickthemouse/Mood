# Suggested first prompt for Codex

Use this when you open the repo in Codex:

```txt
You are working on mood, a React/Vite app. Start by reading README.md, AGENTS.md, docs/project-brief.md, src/App.jsx, and the two files in prompts/. Do not edit files yet. First summarize the current architecture, then identify the smallest safe next step to make the app easier to build and test. Pay special attention to image weights, prompt format dropdowns, and moving model API calls out of the browser.
```

Then use this for the first coding task:

```txt
Refactor the current single-file prototype into a cleaner structure without changing behavior. Extract provider calls, prompt instructions, board helpers, and reusable UI pieces. Keep the image weight behavior exactly intact: default 1.0, range 0.1 to 5.0, weight changes trigger synthesis but not single-image analysis. After editing, run npm run build and report any failures with exact next steps.
```
