# Sofer STAM font and input repair — live 6 September 2026

## Proven causes

- v10 public/styles.css selected Frank Ruhl Libre rather than the existing STAM Ashkenaz CLM font. The font file itself was still installed.
- Upload/paste offered only txt/json/sefaria, while the English-keyboard parser required format=stam.
- File.text() decoded the owner's UTF-16LE BOM file as UTF-8. The earlier engine tests bypassed this real upload path.
- The async HTTP layout path did not handle lowercase l blank-line markers, although the synchronous path did.
- A standalone capital P/X decoded to Hebrew פ/ס but was then incorrectly classified as a bare section marker.

## Changes

- Restored bundled StamAshkenazCLM.ttf as the first Hebrew font.
- Browser upload decodes UTF-8, UTF-16LE BOM and UTF-16BE BOM strictly; invalid encoding is rejected rather than saved as corrupted text.
- Default txt imports detect keyboard markers; explicit STAM selection and .stam/.stam.txt uploads supported. Structured JSON/Sefaria imports are not automatically reinterpreted.
- Capitals mark only the corresponding Hebrew letters as holy. Spelling alone does not confer holiness. Lowercase p/s/l remain distinct controls, including when attached to words.
- Async layout retains blank lines and song gap metadata. This is not certification of song geometry or ritual suitability.
- Existing stored sources, written layouts and profiles were not rewritten. Re-import original files and compute a new layout to correct earlier corrupted imports.

## Verification

- 135 main checks and 27 stretch checks passed in network-disabled, read-only containers.
- Owner file through corrected decoder/reader: 79,977 words; 304,802 letters; p=307; s=495; 2,658 explicitly marked words; 11,684 holy letters. Original decoded text retained; no Latin controls remain in writing text. These are input counts, not canonical Torah certification.
- Public disposable-demo HTTP test passed: STAM font served (14,968 bytes), correct upload module, default txt parsing, exact five marked letters versus the same word unmarked, p/s layout breaks and l blank line.
- Interactive browser unavailable (no connected browser surfaces). No claim of visual screenshot verification.
- Saved DB online backup integrity ok: 7 profiles, 16 sources, 8 geometries, 21 layouts, 171,874 lines, schema 7.
- Agent Hub public health remained ok; no Hub service restart.

## Release

- Host srv1876836 / 191.215.35.160.
- Image prima-sofer-studio:stam-v11-final, manifest 20f6e44ef7a6b9a84be3a3685d74fa81c9f215efb68f92a87c3228d99fe0b038.
- Release folder /opt/sofer-studio/releases/stam-v11-20260906.
- Archive SHA256 84df541beabafcf14285692aa36d6483b17bde7a304efd7e73b69db7a51c4f7b.
- DB backup /opt/sofer-studio/backups/stam-v11-20260906/sofer-before-v11.sqlite.
- Caddy backup /opt/sofer-studio/backups/Caddyfile.before-stam-v11-1788713598750.
- Only Sofer block changed; other-host bytes hash a9663133c8f8f67aeb7325986ecdac358ebffb21fa7bc8d158cd35b6e029c722 unchanged.
- Older containers retained without restart. Existing temporary demo sessions retain their prior version until expiry or explicit upgrade. Upgrade starts a separate temporary workspace; export any unsaved demo work first. Saved authenticated workspace remains the same database.
- Updated entry: https://sofer.primainsurance.tech/?upgrade=stam-v11
- This was a scoped VPS image/cutover, not a Git commit/push or Agent Hub deployment.
