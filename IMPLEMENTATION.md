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
- Unused games carry a reason: on IR, no slot accepts the position, eligible slots are full (with the occupants named), or sat by the user's choice for that date.
- Priorities: a roster player can be marked Preferred (★). Players are offered seats in priority order (Preferred, then roster order) by the same augmenting-path matching, which never drops a seated player, so every day still fills the maximum number of spots and seats as many Preferred players as possible.
- Daily choices: per date the user can Start or Sit players. Starts are seated first, sits are left out, and the rest is filled automatically by priority. Choices that can't be honored (IR, no game, no room among other starts) are ignored and listed on that day. Choices are stored per date, persist in localStorage, and are carried across player-id migrations; older saved full lineups load as that date's starts.
- **Assumptions (not modeled):** games-played caps, transaction limits, weekly lineup locks.

### Data sources (verified with real data on 2026-10-14 via GitHub Actions)
| Need | Source | Status |
|---|---|---|
| Teams | NHL `api-web.nhle.com/v1/standings/now` | 32 teams |
| Schedule | NHL `club-schedule-season/{team}/20262027` | 1,344 games, Sep 29 → Apr 10, exactly 84 per team, each game cross-checked in both teams' lists |
| Players, current team | NHL `roster/{team}/current` | 785 players |
| Fantasy eligibility | ESPN `lm-api-reads.fantasy.espn.com/.../fhl/seasons/2027/players?view=players_wl` (unofficial) | 1,705 players; 777 matched to NHL records |
| Injury status | none available | Not needed: IR is the user's own roster designation (Active/IR on the Roster page) |

- ESPN slot ids and team ids are inferred from the data, not hardcoded. The inferred mapping was 0=C, 1=LW, 2=RW, 3=F, 4=D, 5=G, 6=UTIL, 7=Bench, 8=IR, with all 32 teams mapped. If inference isn't clean, ESPN is rejected and NHL positions are used instead.
- The ESPN↔NHL match uses exact names first, then a loose name (ignoring middle initials) plus team plus position. Real case handled: VAN has two Elias Petterssons (C and D), and ESPN calls the D "Elias N. Pettersson".
- ESPN-only players (about 810: prospects, minor-leaguers, injured non-roster players and some retired players) are included so they can be added, using ESPN's team and positions. The data marks them `inactive` (not on any NHL current roster at the last refresh); the app does not display this.
- **Traded players:** each refresh compares against the previous snapshot. A team change closes the old stint the day before and opens the new one on the refresh date. Every date resolves to exactly one team, so a traded player's games are never double-counted.
- **Refresh:** `.github/workflows/refresh-data.yml` runs daily and on pipeline changes, then commits the validated snapshot. If any validation fails, nothing is written.
- **Dates:** `YYYY-MM-DD` strings in the NHL's Eastern game-date convention. There's no local-time `Date` arithmetic.

- **Contact form:** League Settings → Contact is a standard FormSubmit form post with the same recipient and settings as Letter Ladder's `contact.html` (`src/contact.ts`). FormSubmit then returns the visitor here (`_next` with `?contact=sent`), and the app shows "Message sent". The recipient address is visible in the page source, as it is on Letter Ladder.

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
- [x] Daily Start/Sit choices per date, auto-filled around them, badged "Your Changes" with the optimal total; reset per day or per window
- [x] Preferred (★) players get contested lineup spots first, without reducing filled spots; toggled from the Lineup grid, day view or Roster table
- [x] Trade lab: drop and add, before/after table by round and full playoffs, undo, back to current roster, apply
- [x] CI workflow: typecheck, tests, build, and bundled-data validation

### Remaining / nice to have
- [ ] Optional per-player manual team override (e.g. a trade announced between data refreshes)
- [ ] UI component tests (the core logic is covered by unit tests; UI checked with a scripted Playwright walkthrough, see below)
- [x] GitHub Pages deployment workflow (`deploy-pages.yml`): build → deploy → live smoke test; triggered by pushes to the default branch, manual dispatch, and the refresh workflow when the snapshot changes
- [x] Pages enabled (repo made public). **Live: https://jmaser54.github.io/fantasy-hockey-schedule-optimizer/**. First deploy (run 38635409510, 2026-10-14) passed its smoke test against the live URL: data snapshot matched the commit (1,344 games, 32 teams), rankings rendered 32 teams, lineup computed, roster persisted across reload, no browser errors.

## Test results (latest)
- `npm test`: **66/66 passing** (includes lineup capacity counts, `src/domain/capacity.ts`, and Team Schedules sorting/round filtering/matchups/roster-by-team, `src/domain/teamSchedules.ts`)
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
- IR is whatever the user sets on the Roster page. A player set to IR uses an IR slot and never plays; no injury status or separate mark is required. Only the league's IR slot count is enforced. Older saves' injured marks and "Who Can Use IR" setting are ignored on load.
- A trade's effective date is the first refresh that observes it (up to about 1 day late).
- ESPN's pool contains a duplicate "Andrew Agozzino" (two ESPN ids, both minor-league). Both are shown; paste import flags the name as ambiguous.
- The scheduled (cron) refresh and Pages deploys run only on the repository's default branch, currently `claude/practical-faraday-ti8p02`. If a `main` branch becomes the default later, merge this branch into it first; the workflows need no changes.
- `github.io` is not reachable from the dev container, so the live site is verified by the smoke-test job in GitHub Actions (`scripts/smoke-test.mjs`), which runs after every deploy.
- GitHub Actions warns that `actions/checkout@v4` / `setup-node@v4` target the deprecated Node 20 runtime (they still run, forced to Node 24). Not failing; bump action versions when newer majors are adopted.

## Next step
Watch the first scheduled refresh (daily at 10:17 UTC). It should commit a new snapshot and trigger deploy → smoke test automatically. If a run fails, the Actions tab shows which stage failed (fetch/validation, build, deploy or live smoke test).
