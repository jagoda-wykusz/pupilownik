---
change_id: vendor-build-fonts
title: Take Google out of the build path so a font request cannot stop a deploy
status: preparing
created: 2026-09-12
updated: 2026-09-12
archived_at: null
---

## Notes

take Google out of the build path — astro build downloads six woff2 from Google on every cold build and throws AstroError with no fallback, so one 429 stops a deploy; the browser already gets them self-hosted, so this is about publication reliability, not privacy
