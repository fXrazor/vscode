# Self-hosted existing font assets

UI-23, 2026-11-14. Unmodified WOFF2 files copied from the existing project's
`out/_next/static/media/`. Family names, weights, Unicode subsets and fallback
metrics were matched from the existing generated `3q6vpli95p3kd.css`; all 16
subsets are preserved. `app/fonts.css` retains those declarations, adjusting
only URLs to `/fonts/` and explicitly declaring the existing font variables.
No font binary was downloaded or changed. See `manifest.json` for hashes.

- Inter: weight 100–900, seven subsets.
- Space Grotesk: weight 300–700, three subsets.
- JetBrains Mono: weight 100–800, six subsets.

License: SIL Open Font License 1.1; copyright notices and complete license
are retained in `OFL.txt`. Official source notices checked through the web tool:

- https://raw.githubusercontent.com/google/fonts/main/ofl/inter/OFL.txt
- https://raw.githubusercontent.com/google/fonts/main/ofl/spacegrotesk/OFL.txt
- https://raw.githubusercontent.com/google/fonts/main/ofl/jetbrainsmono/OFL.txt

The Latin files used by the interface are `07c7676b89ed2778-s.p.2bn3s6zvc0dyp.woff2`
(Inter), `237858b39a32779d-s.p.2cyn07wtgehh0.woff2` (Space Grotesk), and
`53897e768d329f66-s.p.3t6q91iet4nsy.woff2` (JetBrains Mono).
