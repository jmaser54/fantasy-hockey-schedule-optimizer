# Implementation checklist

Fantasy hockey playoff optimizer: maximizes **usable player-games** (not points) across fantasy playoff periods.

## Starting state
- Repository was empty (no commits, no branches). Built from scratch: Vite + React + TypeScript, Vitest.
- No Firebase, no accounts, no backend. State persists in `localStorage`.

## Architecture
| Layer | Files | Notes |
|---|---|---|
| Domain (pure, tested) | `src/domain/*` | dates, schedule index, team stints, matching, optimizer, roster rules, rankings |
| Data pipeline (Node) | `scripts/refresh-data.ts`, `src/data/pipeline/*` | fetch → strict parse → reconcile → validate → write `public/data/*.json` |
| Data format/validation (shared) | `src/data/format.ts`, `src/data/validate.ts` | same checks in the script and the app |
| App | `src/state/*`, `src/ui/*` | loads the static snapshot; no runtime calls to NHL/ESPN |

### Optimization model
- Each calendar date is optimized independently: max-cardinality bipartite matching (Kuhn) of players with a game that date → lineup seats they're eligible for.
- Period and full-window totals = sums of daily maxima. This is exactly optimal because lineup moves are free and days are independent.
- IR players are never lineup candidates. IR capacity is in addition to roster size.
- Goalie games count as start opportunities (the team plays), not confirmed starts.
- Not modeled (not required by the configured rules): games-played caps, transaction limits, weekly lineup locks.

### Data model and sources
- **Schedule + teams:** NHL web API `api-web.nhle.com/v1` (`standings/now`, `club-schedule-season/{team}/{season}`). Each game must appear identically in both teams' lists, each team must have 84 regular-season games, and no team can play twice on one date.
- **Players and current team:** NHL `roster/{team}/current`.
- **Fantasy eligibility:** ESPN fantasy pool (unofficial). ESPN slot and team ids are *inferred from the data* and the source is rejected if inference isn't clean. The fallback is NHL position codes (C/L/R/D/G → C/LW/RW/D/G), and each player is labeled with the source of their eligibility.
- **Traded players:** each refresh compares against the previous snapshot. A team change closes the old stint the day before and opens the new one on the refresh date. Each date resolves to exactly one team, so games are never double-counted.
- **Refresh:** `.github/workflows/refresh-data.yml` runs daily (and on pipeline changes), commits the validated snapshot, and uploads raw samples and a report as the `data-raw` artifact.
- Dates are `YYYY-MM-DD` strings in the NHL's Eastern game-date convention; there's no `Date` arithmetic in local time zones.

## Status

### Done
- [x] Phase A: inspected the repo (empty) and probed data sources (see Known issues)
- [x] Domain core: dates, schedule index, stints, matching, daily optimizer, manual lineups, roster/IR validation, rankings
- [x] Hand-checkable tests for spec cases 1–10, plus brute-force verification of the matching (500 random instances)
- [x] Data pipeline: strict NHL/ESPN parsers, schedule cross-check, ESPN id inference, same-name disambiguation, team history, dataset validation, and tests
- [x] GitHub Actions refresh workflow

### Remaining
- [ ] Real-data proof of concept: run the workflow and inspect `data-raw/report.txt` and the samples
- [ ] App shell, data loading with a status indicator, and persisted state
- [ ] Team rankings screen (per round, full window, custom range)
- [ ] Period editor and custom range
- [ ] Roster entry: search, bulk paste, disambiguation, custom players
- [ ] League settings editor with conflict reporting
- [ ] Lineup views: overview and daily breakdown, with explanations
- [ ] Manual lineup overrides and reset
- [ ] Scenario (trade) comparison with undo and restore-original
- [ ] Tests for spec cases 11 (scenarios) and 12 (persistence)

## Test results
- `npm test`: 38/38 passing (domain 25, pipeline 13)
- `npm run typecheck`: clean

## Known issues and risks
- **This dev container cannot reach `api-web.nhle.com` or ESPN** (blocked by its network policy, so the proxy returns 403). Real data can only be fetched by the GitHub Actions workflow, or locally after adding those hosts to the environment's allowed domains.
- NHL and ESPN endpoints are undocumented and may change. The parsers fail loudly rather than degrade silently.
- A trade's effective date is the refresh date that first observes it (up to about 1 day late with daily refreshes).
- Players carried forward after leaving every NHL roster are flagged inactive; their team's schedule still applies, with a warning shown.

## Next step
Run the refresh workflow, inspect the report, and fix any parser mismatches against the real responses.
