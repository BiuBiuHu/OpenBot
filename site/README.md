# OpenBot marketing site

Static bilingual introduction at `site/`. Product documentation stays in `docs/` and the root README files.

## Preview locally

The preview server mounts the site at `/OpenBot/`, matching the GitHub Pages project URL `https://biubiuhu.github.io/OpenBot/` (repository name `OpenBot`).

```bash
python3 site/preview.py
```

- English: http://127.0.0.1:4173/OpenBot/
- 简体中文: http://127.0.0.1:4173/OpenBot/zh/

Optional: `python3 site/preview.py --port 4173 --host 127.0.0.1`

## Tests

From the repository root:

```bash
python3 -m unittest tests.test_site
```

Checks language split (`en` vs `zh-Hans`), relative asset URLs that survive the `/OpenBot/` base path, and that copy stays within the README.

## GitHub Pages (not enabled)

Production Pages is still off. Do not enable it, and do not turn on a deploy workflow, until the owner is ready to publish.

When that happens:

1. Copy `site/pages.workflow.yml.example` to `.github/workflows/pages.yml`.
2. In the GitHub repo: Settings → Pages → Source: GitHub Actions.
3. Merge to `main` (or run the workflow by hand).

Until then, this directory is preview-only.

## Screenshots

Images under `assets/screenshots/` are copies of existing README evidence from `docs/`. Captions keep the same cautions: synthetic data, empty demo forms, no real credentials.
