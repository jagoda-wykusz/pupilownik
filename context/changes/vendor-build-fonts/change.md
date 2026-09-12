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

## Decyzje (2026-09-12, podjęte po badaniu — użytkownik oddał wybór)

1. **Vendorujemy, a nie cache'ujemy.** Obie ścieżki awarii znikają razem z zależnością. Kluczowy
   argument z pomiaru: Astro i tak nie subsettuje ani nie optymalizuje niczego — pliki lokalne są
   przepisywane bajt w bajt — więc vendoring nie kupuje kroku build'owego, tylko go likwiduje.
   Cache Cloudflare odrzucony: tygodniowy TTL metadanych sprawia, że degraduje w stronę _cichej_
   awarii, czyli dokładnie w złą.

2. **Kursywa wypada.** Zmierzone: w całym `src/` zero `<em>`, `<i>`, `font-style` i klas `italic`.
   Dwa pliki italic Nunito to 80 760 B z 210 280 B wysyłanych dziś do każdego odwiedzającego, dodane
   przez `DEFAULTS.styles`, którego obecna konfiguracja nie umie wyłączyć. Gdyby kiedyś pojawił się
   `<em>`, przeglądarka zsyntetyzuje pochylenie ze zmiennego kroju, a dołożenie prawdziwego pliku to
   dwie linie konfiguracji. 210 KB → 129 KB.

3. **Asercja na artefakcie wchodzi mimo vendoringu.** Po zmianie zła ścieżka do pliku lokalnego pada
   głośno (`readFile` → `AstroError`), więc cicha dziura znika sama — ale asercja pilnuje _klasy_:
   build, któremu się powiodło wyprodukowanie niewłaściwej rzeczy. Miejsce: `scripts/check-client-bundle.mjs`,
   który już chodzi po `dist/client` i już jest w `ci:gate`. Koszt ~5 linii.

4. **`OFL.txt` dokładamy, ale nie księgujemy go jako kosztu tej zmiany.** Binarki redystrybuujemy
   już dziś — Cloudflare serwuje je z naszego origin każdemu odwiedzającemu. Treść i linie
   copyright kopiujemy z `google/fonts` (`ofl/quicksand/`, `ofl/nunito/`), nie z research.md.

5. **Poza zakresem**: `supabase` jako devDependency ściągający binarkę Go na każdym zimnym buildzie
   Cloudflare, w kontenerze bez Dockera. Osobna zmiana.
