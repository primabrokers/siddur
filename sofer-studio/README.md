# Sofer Studio

This is the application source serving the Sofer VPS as STAM v11 on 6 September
2026. It is separate from the Siddur/Vecker app in the repository root.

## Run locally

Use Node.js 22 or newer. From this directory:

```sh
npm ci
npm test
node --test tests/stretch-policy.test.js tests/stretch-policy-api.test.js tests/stretch-book.test.js
npm start
```

The server listens on localhost port 4252 by default. Local SQLite state belongs
in data/ (ignored by Git). Never commit saved workspaces, credentials or backups.

## Input and font

- Writing text uses the bundled STAM Ashkenaz CLM font; licence files accompany it.
- Upload UTF-8 or UTF-16 with a byte-order mark. Windows STAM UTF-16 files must
  not be decoded with File.text(), which interprets them as UTF-8.
- Text uploads and pasted text recognise the owner's English-keyboard controls.
  Uppercase H becomes י and V becomes ה, with exact human-marked holy letters
  shown with a white strike. The program does not infer holiness from spelling.
- Lowercase p = pesucha, s = setuma and l = blank line, including attached markers.
- Re-import an original file and compute a new layout to repair an earlier
  incorrectly decoded import. Existing saved layouts are never rewritten.

Historical design/audit documents under docs/sofer-studio describe earlier
versions; current human-only holy-name decisions supersede their old automatic
name-detection proposals. This is planning software, not scribal certification.

## Release isolation

The source was recovered from the original Sofer branch (6152ac6) and reconciled
with the running, tested STAM v11 image. No production database or secrets are
included. The release report is docs/sofer-studio/STAM-V11-RELEASE-2026-09-06.md.
Pushing main triggers the repository's existing Siddur GitHub Pages workflow;
that workflow only publishes its explicit root app files, not Sofer. It does not
redeploy the Sofer VPS. Do not expose this loopback server without its existing
authenticated gateway or isolated-demo wrapper.
