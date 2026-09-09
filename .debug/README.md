# Debug notes

Non-obvious findings — a framework bug, a surprising build behaviour, a fix
whose reason is not visible from the diff — are written down here so the next
person (or the next session) does not rediscover them.

## Conventions

- One file per investigation: `NNN-short-description-YYYY-MM-DD.md`, `NNN`
  zero-padded and monotonically increasing.
- Structure: **Symptom** → **Investigation** → **Root cause** → **Fix** →
  **How to detect a regression** (ideally a test path).
- Add the entry and its row in the table below **in the same commit as the fix**.
- This directory is committed; it is excluded from the Vercel build through
  `.vercelignore`.

## Index

| #   | Date | Subject            | Status |
| --- | ---- | ------------------ | ------ |
| —   | —    | _(no entries yet)_ | —      |
