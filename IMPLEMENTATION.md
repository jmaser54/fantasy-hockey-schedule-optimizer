# Implementation checklist

Fantasy hockey playoff optimizer: maximizes **usable player-games** (not points) across fantasy playoff periods.

## Starting state
- The repository was empty (no commits, no branches), so this was built from scratch: Vite + React 18 + TypeScript, with Vitest.
- No Firebase, accounts, or backend. All state persists in `localStorage`, and roster data never leaves the browser.

## Architecture
| Layer | Files | Notes |
|---|---|---|
| Domain (pure, tested) | `src/domain/*` | dates, schedule index, team stints, matching, optimizer, roster rules, rankings, name matching |
| Data pipeline (Node) | `scripts/refresh-data.ts`, `src/data/pipeline/*` | fetch → strict parse → reconcile → validate → write `public/data/*.json` |
| Data format/validation (shared) | `src/data/format.ts`, `src/data/validate.ts`, `src/data/load.ts` | same checks in the refresh script, CI (`scripts/check-data.ts`) and the app |
| State | `src/state/appState.ts` | reducer, scenario/undo, tolerant persistence |
| UI | `src/ui/*` | Team schedules, Roster, Lineup, Trade lab, Settings |

### Optimization model (`src/domain/optimizer.ts`)
- Each calendar date is optimized independently using maximum-cardinality bipartite matching (Kuhn's algorithm): players with a game that date are matched to the lineup seats they're eligible for.
- Window totals are sums of the daily maxima. This is exactly optimal because lineup moves are free and days are independent.
- IR players are never lineup candidates. IR capacity is in addition to roster size, and both limits are read from the league config.
- Goalie games count as start opportunities (the team plays), not confirmed starts, and are reported separately.
- Unused games carry a reason: on IR, no slot accepts the position, eligible slots are full (with the occupants named), or benched by a manual lineup.
- **Assumptions (not modeled):** games-played caps, transaction limits, weekly lineup locks.

### Data sources (verified with real data on 2026-10-14 via GitHub Actions)
| Need | Source | Status |
|---|---|---|
| Teams | NHL `api-web.nhle.com/v1/standings/now` | 32 teams |
| Schedule | NHL `club-schedule-season/{team}/20262027` | 1,344 games, Sep 29 → Apr 10, exactly 84 per team, each game cross-checked in both teams' lists |
| Players, current team | NHL `roster/{team}/current` | 785 players |
| Fantasy eligibility | ESPN `lm-api-reads.fantasy.espn.com/.../fhl/seasons/2027/players?view=players_wl` (unofficial) | 1,705 players; 777 matched to NHL records |
| Injury status | none available | ESPN's public pool has no injury fields, so users mark players injured themselves |

- ESPN slot ids and team ids are inferred from the data, not hardcoded. The inferred mapping was 0=C, 1=LW, 2=RW, 3=F, 4=D, 5=G, 6=UTIL, 7=Bench, 8=IR, with all 32 teams mapped. If inference isn't clean, ESPN is rejected and NHL positions are used instead.
- The ESPN↔NHL match uses exact names first, then a loose name (ignoring middle initials) plus team plus position. Real case handled: VAN has two Elias Petterssons (C and D), and ESPN calls the D "Elias N. Pettersson".
- ESPN-only players (about 810, mostly minor-leaguers) are included and flagged "Not on NHL roster".
- **Traded players:** each refresh compares against the previous snapshot. A team change closes the old stint the day before and opens the new one on the refresh date. Every date resolves to exactly one team, so a traded player's games are never double-counted.
- **Refresh:** `.github/workflows/refresh-data.yml` runs daily and on pipeline changes, then commits the validated snapshot. If any validation fails, nothing is written.
- **Dates:** `YYYY-MM-DD` strings in the NHL's Eastern game-date convention. There's no local-time `Date` arithmetic.

## Status

### Done
- [x] Inspected the repo and probed data sources. A real-data proof of concept passed via GitHub Actions.
- [x] Domain core: dates, schedule, stints, matching, daily optimizer, manual lineups, roster/IR validation, rankings
- [x] Data pipeline with strict parsers, reconciliation, and validation; two real-data bugs fixed (same-name players, duplicate carry-forward)
- [x] App shell, data loading with a status chip (fresh, stale, or error), and persisted state with migration of renamed ids
- [x] Team schedules: per round, full playoffs, and custom range; sortable; heat shading; light-night games; games-per-night strip; team date drill-down
- [x] Rounds editor and custom date range
- [x] Roster: autocomplete, bulk paste with review (matched, ambiguous, suggested, unmatched), custom players, IR with eligibility rules, eligibility overrides, conflict reporting
- [x] League settings: roster size, IR slots and rule, lineup slots (count and accepted positions). Changes keep the roster and report conflicts.
- [x] Lineup: per-window summary cards, player × date grid with usable/benched/IR marks, daily detail with reasons and NHL games
- [x] Manual lineup overrides per date, clearly badged with the optimal total; reset per day or per window
- [x] Trade lab: drop and add, before/after table by round and full playoffs, undo, back to current roster, apply
- [x] CI workflow: typecheck, tests, build, and bundled-data validation

### Remaining / nice to have
- [ ] Optional per-player manual team override (e.g. a trade announced between data refreshes)
- [ ] UI component tests (the core logic is covered by unit tests; UI checked with a scripted Playwright walkthrough, see below)
- [ ] Deployment target. The output is a static site (`dist/`); the data refresh commits to the repo, so a deploy must rebuild after each refresh.

## Test results (latest)
- `npm test`: **55/55 passing**
  - optimizer, spec cases 1–10, plus 500 random instances checked against brute force: 13
  - dates, roster/IR, rankings: 12
  - name matching and paste parsing: 7
  - pipeline parsers and reconciliation: 16
  - state: scenarios, case 11; persistence, case 12: 7
- `npm run typecheck`: clean. `vite build`: OK (about 66 kB gzipped JS).
- `scripts/check-data.ts`: 1,344 games, 32 teams, 1,593 players; valid.
- Playwright walkthrough against real data (scratchpad script, not committed), no console errors:
  - pasted 19 names: 16 auto-matched; Pettersson flagged ambiguous; the misspelled "Conor Bedard" offered as a suggestion (not auto-matched); Gretzky unmatched
  - lineup: 293 of 329 usable games across the full playoffs. A manual edit drops it to 292, and reset restores 293.
  - trade (Hedman → Dahlin): +2 over the full playoffs; Undo works
  - reload restores the roster and scenario; a smaller roster limit shows a conflict without removing players
  - no horizontal overflow at 390px on any screen

## Known issues and risks
- **This dev container cannot reach the NHL or ESPN APIs** (network policy). Data is fetched only by GitHub Actions, or locally once those hosts are allowed.
- NHL and ESPN endpoints are undocumented. Parsers fail loudly and keep the last good snapshot.
- ESPN gives no injury data, so the "injured only" IR rule relies on the user marking players injured (choosing IR does this, labeled as user-provided).
- A trade's effective date is the first refresh that observes it (up to about 1 day late).
- ESPN's pool contains a duplicate "Andrew Agozzino" (two ESPN ids, both minor-league). Both are shown; paste import flags the name as ambiguous.
- The scheduled (cron) refresh runs only on the repository's default branch, which is currently this feature branch.

## Next step
Choose a hosting target (e.g. Firebase Hosting or GitHub Pages) and add a deploy step that rebuilds after each data refresh.
