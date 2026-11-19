# Shelter Watch — research dataset (Washoe County, NV)

Draft research compiled 2026-11-11 for the Shelter Watch feature. **Not yet verified for publication.**

- `housing_master.json` / `.csv` — 161 deduplicated records (IDs `SW-001`…), grouped:
  Shelter (20), Transitional / Recovery (36), PSH / Public / HUD (39), Affordable / Low-cost (60),
  plus 6 places that were asked about but fall outside scope.
- `raw/` — the four source research files before merging.
- `merge.py` — rebuilds the master files from `raw/`.

## Confidence
`high` 33 · `medium` 91 · `low` 37. Research ran on search-result summaries only — the session's
network policy blocked direct fetches of washoecounty.gov, renoha.org, hud.gov, housing.nv.gov and
local news sites. Every record needs a phone or primary-source check before going live.

## Known gaps
Weekly motels / SROs, rent-assistance programs, Oxford Houses, CoC-funded PSH project list,
HOPWA, rapid rehousing providers, most RHA complex street addresses, the full NV Housing Division
LIHTC property list.
