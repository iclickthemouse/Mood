# mood

mood is a React moodboard workspace for turning image references into reusable prompts and writing samples into `skill.md` voice profiles.

The current app lives in:

```txt
handoff/mood-codex-handoff
```

## Local Run

```bash
cd handoff/mood-codex-handoff
npm install
npm run dev
```

## GitHub Pages Testing

This repository includes a GitHub Pages workflow at `.github/workflows/pages.yml`.

After the repository is pushed to GitHub:

1. Open the repository settings on GitHub.
2. Go to **Pages**.
3. Set the source to **GitHub Actions**.
4. Push to `master` or `main`, or manually run the workflow.

The workflow builds the Vite app from `handoff/mood-codex-handoff` and publishes the generated `dist` folder.

## Provider Notes

The GitHub Pages build is static frontend hosting. It is good for online UI testing.

Model-provider behavior depends on browser access:

- LM Studio and Ollama are local-only providers and should be tested from local dev.
- Browser-side external provider keys are useful for private testing but are not production-safe.
- A production hosted version should move model calls behind a backend/API proxy.
