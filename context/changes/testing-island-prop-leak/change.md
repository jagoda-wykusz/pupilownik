---
change_id: testing-island-prop-leak
title: Catch a server-only value reaching a client island prop, where the bundle scan cannot look
status: planned
created: 2026-09-12
updated: 2026-09-12
archived_at: null
---

## Notes

rollout phase 3 reopened — Risk #6 at a level the bundle scan cannot reach: a server-only value passed as a prop to a client:\* island is serialized into the SSR response, never into dist/client, so check-client-bundle reports clean
