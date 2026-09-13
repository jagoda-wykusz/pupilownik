---
change_id: e2e-invite-reveal
title: First E2E test — the caretaker reveal chain, and the sensitive tier's absence from island props
status: impl_reviewed
created: 2026-09-13
updated: 2026-09-13
archived_at: null
---

## Notes

pierwszy test E2E (Playwright): ryzyko #4 ∩ #6 z test-plan.md — wrażliwe wskazówki nie mogą pojawić się w bajtach strony /invite/[token] przed claimem, ani dla przeglądarki bez capability cookie, i muszą pojawić się po claimie
