---
change_id: testing-secret-leak
title: Prove no secret reaches the client bundle or an error body, and gate it in CI
status: implementing
created: 2026-09-11
updated: 2026-09-11
archived_at: null
---

## Notes

rollout phase 3 — Risk #6: prove no Secret/service-role key reaches the built client bundle and no secret or PII escapes in error bodies; wire the secret-leak grep as a CI gate
