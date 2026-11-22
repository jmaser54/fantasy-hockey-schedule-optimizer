# Player Evaluator — Feature Specification

**Status:** Product direction agreed; implementation details remain open where explicitly marked below.  
**Last updated:** 2026-11-20  
**Target:** Testing repository first. This document is development guidance and must never be published in the website bundle.

## 1. Product goal

Add a second, independent Playoff Planner tool that helps fantasy hockey managers evaluate the statistical production of their actual roster without manually researching every player.

The core analysis normalizes skater counting statistics to a common games-played benchmark. The default benchmark is **league max**, the highest games-played total among all NHL skaters in the current season's stats (owner decision, 2026-11-21; it was previously the roster maximum).

This is a statistical comparison of observed production rates, **not a forecast or prediction** of future performance.

Working names only:
- Existing feature: **Lineup Planner** (the current schedule/lineup optimization experience).
- New feature: **Player Evaluator**.

Neither name nor the final site navigation convention is locked. The two tools should initially have separate experiences/pages/tabs rather than being combined into one screen.

## 2. Timing and release philosophy

There is a seasonal urgency: games-played gaps are especially large early in the NHL season, making normalization particularly useful now. Prioritize a reliable, useful public V1 over optional sophistication.

Do not delay Player Evaluator for screenshot recognition, goalie support, injury adjustments, ESPN/Yahoo account integrations, or elaborate visualizations.

## 3. V1 product requirements

### 3.1 Roster input and persistence
- Reuse the existing saved roster when one exists. Do not require users to re-enter it every time they open Player Evaluator.
- Reuse existing browser-local persistence. The product remains guest-first: no accounts, no backend, no mandatory external fantasy-platform authorization.
- Existing roster paste/manual entry remains a supported way to add or correct players.
- Do not change or break existing roster, Lineup Planner, Trade Lab, or league-settings behavior.
- Player Evaluator must work with a previously saved roster even if screenshot upload is not yet available.
- Roster changes made in the existing Roster experience should flow into Player Evaluator through the shared saved roster, not a separate manually maintained copy.

### 3.2 Skater-only initial release
- V1 supports skaters only.
- Goalies are deliberately excluded until their statistics and comparison model receive separate product consideration. Do not force goalie statistics into skater rules.
- If a saved roster contains goalies, preserve them in the existing roster. Player Evaluator should clearly explain that goalie evaluation is not yet supported and exclude them from skater calculations.

### 3.3 Statistical normalization
For each supported skater counting statistic:

`adjustedStat = actualStat / actualGP * benchmarkGP`

Default benchmark (**Confirmed 2026-11-21**, replacing the earlier roster-maximum default):

`benchmarkGP = maximum GP among all NHL skaters in the current season's stats dataset` (league max)

- Show actual and adjusted statistics side by side.
- Preserve actual GP and actual totals; never replace or conceal the source values.
- Keep decimal adjusted values so the normalization remains transparent and comparisons are not distorted by premature rounding.
- Clearly label the benchmark (for example, “Normalized to 25 GP”). **Confirmed 2026-11-21:** keep the GP prominent; put the explanation of how it was set behind the ⓘ, not as a permanent sentence, and don't show a player's name in the default label.
- If GP is zero or unavailable, do not divide; show the adjusted value as unavailable and explain why where useful.
- If a player has no stats record or cannot be confidently matched to an NHL player ID, do not guess or silently substitute another player. Show a clear unmatched/unavailable state.
- The analysis must use current-season regular-season statistics. Do not mix preseason, playoff, or career totals into the current-season calculation.

### 3.4 Statistic treatment
Treat each statistic according to what it measures, not merely whether it is numeric.

**Scale counting totals** by benchmark GP, subject to confirming availability and exact source-field definitions:
- Goals, assists, points
- Penalty minutes
- Power-play points and short-handed points
- Shots on goal
- Hits and blocked shots
- Faceoff wins
- Other supported counting statistics that are meaningful and available

**Leave unchanged**:
- Percentages/rates such as shooting percentage and faceoff percentage
- Average time on ice / time on ice per game
- Plus/minus
- Other per-game, per-minute, percentage, or context-dependent statistics unless a clear reason supports scaling

Plus/minus is intentionally static in V1. Although it can be mathematically multiplied, raw plus/minus is context-dependent and noisy; scaling it could imply a degree of individual predictive meaning it does not have.

Do not assume every field belongs in a scaled or unchanged category without checking its definition. Document the treatment of every displayed statistic.

### 3.5 Benchmark controls and external comparisons
- **Benchmark options (Confirmed 2026-11-21), in this order:** League max (the default: highest GP among all NHL skaters in the current season's stats; skaters only), Roster max (highest GP among the user's rostered skaters with valid stats, **including skaters on IR**), **Per Game** (a built-in 1 GP benchmark, added 2026-11-21: each counting stat per game played), a comparison player's GP, or a custom whole number. The dropdown order is League max, Roster max, Per Game, (comparison players), Custom. Normalized values show three decimals under Per Game and two decimals under every other benchmark (League max, Roster max, Custom, comparison player), trailing zeros kept (e.g. 0.900, 8.80); display only, calculations, sorting and ranking use full precision.
- **Roster max unavailable** (no roster, or no rostered skater with stats): use league max and say so (Confirmed 2026-11-20).
- An explicitly selected benchmark is remembered across visits and both Player Evaluator destinations; users with no saved explicit choice get League max.
- Allow the user to search for and add one or more NHL skaters who are not on their fantasy roster to the analysis. These are comparison players, not additions to the saved fantasy roster.
- Allow the user to choose a comparison player as the benchmark. In that mode, normalize the analysis to that player's current-season GP.
- Allow a custom benchmark GP value: a whole number from 1 through the current season's regular-season games (84 for 2026–27). Player Evaluator is a current-season tool: no historical-season support or 82-game rule; keep the limit easy to update if the NHL changes its format (Confirmed 2026-11-20).
- Adding/removing comparison players or changing the benchmark must not alter the user's actual saved roster.
- External-player comparison is intended to support acquisition and trade evaluation without requiring the user to manage another fantasy team's full roster.

**Confirmed (2026-11-20): persistence.** Comparison-player selections, explicitly selected benchmark settings and the rankings minimum-GP selection are remembered between visits in browser local storage, separate from the saved fantasy roster. Benchmarks are stored as choices (league max, roster max, a player), never as fixed GP numbers, so they stay dynamic. Implemented in `src/state/evaluatorPrefs.ts`; see `docs/PROJECT_SOURCE_OF_TRUTH.md` §E and §I.

### 3.6 Data freshness
- Retrieve season statistics from a trustworthy NHL data source and refresh them on a regular schedule.
- Prefer extending the existing daily GitHub Actions data-refresh pipeline and publishing a validated public statistics snapshot alongside existing NHL data, rather than making a separate live API request for every roster player.
- Display the statistics snapshot's last-updated date/time.
- Never present stale or incomplete data as current without a visible warning.
- Validate player IDs, season, game type, duplicate records, numeric fields, and completeness before publishing a refreshed snapshot.
- A failed refresh must preserve the last known-good snapshot, consistent with the existing data pipeline.

**Source verified on 2026-11-20:** the NHL Stats REST API, joining the `skater/summary`, `skater/realtime` and `skater/faceoffwins` reports on `playerId`.
- Query: current season, `gameTypeId=2`, `isAggregate=false`.
- Pagination: 100-row pages sorted by `playerId`.

`faceoffpercentages` isn't needed for V1. **Implemented (2026-11-20):** the daily refresh writes a validated `public/data/skater-stats.json` with the confirmed V1 statistics, and a stats failure keeps the last good file without blocking the schedule/player refresh. Exact fields, pagination limits, join behavior, coverage gaps, the recommended V1 statistics and snapshot shape, and the proposed pipeline step are recorded in `docs/PROJECT_SOURCE_OF_TRUTH.md` §I under "Verified NHL statistics source". Reference documentation (partly inaccurate: `limit=-1` is capped at 100 rows): https://github.com/pseudo-r/Public-NHL-API/blob/main/docs/stats-rest/skaters.md

### 3.7 Player Rankings (confirmed requirement, 2026-11-20)

Player Evaluator must include league-wide player rankings based on statistics normalized to a common games-played benchmark, so players can be compared on equal terms.

- Rank NHL skaters league-wide, not only the user's roster.
- Support ranking across the available statistical categories.
- Mark players on the user's actual fantasy roster. **Changed by the owner (2026-11-21):** subtle light-blue row shading for rostered players, white rows for everyone else, in both Player Evaluator tables; no blue dots.
- Keep actual games played visible alongside normalized statistics.
- Respect the selected normalization benchmark, including the default and custom options.

**Confirmed ranking decisions (2026-11-20):**
- **Minimum GP:** rankings default to a 10-game minimum, adjustable by the user. The minimum applies to rankings only; rostered players appear in roster evaluation whatever their GP.
- **Categories:** PIM and +/- are available ranking categories. Every category can be sorted ascending or descending: a ranking is a statistical ordering, not a claim that higher is better.
- **Position filter:** NHL position (C/L/R/D) for V1. Fantasy eligibility may be considered later.

**Product position:** rankings are an important, required capability, but they are **not assumed to be the primary focus, landing view or defining feature**. Normalized rankings exist elsewhere; the value here is convenient packaging that highlights the user's own players. Roster evaluation (§1) remains central.

**Confirmed (2026-11-20):** rankings are a secondary feature inside Player Evaluator: easy to reach, but not the landing view. The minimum-GP selection (default 10) is remembered between visits, separately from the roster. **Implemented** as a first prototype (Step 4). **Confirmed revision (2026-11-21):** Player Rankings is a peer destination to Roster Evaluation and uses the same multi-column stat table (same columns, groups, formatting, sorting and shared benchmark) with rank positions and the existing filters. **Open:** final presentation after review.

## 4. User experience and visual direction

- Player Evaluator should be a distinct, easy-to-find experience within Playoff Planner. **Confirmed (2026-11-20):** initially a separate tab alongside the Lineup Planner; the two tools stay distinct. Roster evaluation is the central experience. **Revised (2026-11-21, second iteration):** Playoff Planner and Player Evaluator are two equal primary product areas; the selected area's destinations (Schedules, Roster, Lineup, Trade Lab, or Roster Evaluation, Player Rankings) appear in a compact secondary row beneath, and only those. The shared benchmark control sits above both evaluator destinations. Comparison players appear within the roster table. **Confirmed (2026-11-21):** the top-level navigation labels are "Games Optimizer" and "Player Normalizer" (this area; desktop and mobile, two lines allowed on phones), with "Playoff Planner" kept as the website name; the destinations stay "Roster Evaluation" and "Player Rankings". A "Clear comparison players" button removes all comparison players without touching the roster. Other naming remains open.
- **Confirmed (2026-11-20):** load statistics only when Player Evaluator is opened; a stats failure must not affect the rest of the app. Show the stats update time with a proportionate stale warning.
- The main results should be a compact roster-wide table, not a set of large individual player cards.
- Actual and adjusted values must be visible side by side.
- Avoid repeating two full sets of column headers where grouped headers or paired values can communicate the distinction more compactly.
- Group statistics into sensible categories and let users switch categories or otherwise progressively reveal detail; do not put every available NHL statistic on screen at once.
- Design mobile-first. Avoid a table that requires excessive horizontal scrolling or makes the user lose the player name while viewing stats.
- Desktop appearance of the existing Lineup Planner must not change as a side effect.
- The exact table layout, category controls, responsive behavior, color treatment, and explanatory copy are design tasks to prototype and review before finalizing.

## 5. Explicitly out of V1 scope

- Goalie evaluation/normalization.
- Injury-adjusted scenarios or historical missed-games reconstruction.
- Future projections, forecasts, or claims about what a player will produce.
- ESPN/Yahoo account linking, OAuth, league synchronization, or managing other fantasy teams.
- Accounts, backend services, paid tiers, or subscriptions.
- Screenshot/image recognition as a dependency for Player Evaluator.
- A full trade analyzer or trade recommendation engine.

## 6. Screenshot roster recognition — separate high-priority workstream

Screenshot recognition is **not part of the Player Evaluator V1 acceptance criteria and must not block its release**.

It is nevertheless a high-priority improvement to the overall Playoff Planner because it reduces roster-entry friction, particularly for mobile users who cannot easily copy a full roster from fantasy-platform mobile views.

- Investigate it in parallel with Player Evaluator where practical.
- Reuse the existing player matching and import-review flow where possible.
- The user should be able to review and correct recognized names before adding them; ambiguous matches must never be guessed.
- If implementation or quality testing takes longer than expected, release Player Evaluator without screenshot recognition and continue that work separately.
- Do not add a dependency on screenshot recognition to saved-roster reuse, manual entry, or pasted roster import.

**V1 implemented in the testing repo (2026-11-21, not live):** an Upload Image roster input beside Paste Roster and Search Players, reading screenshots on the device with Tesseract.js and importing through the same path as pasted text (exact players added at once; only same-name players and near matches reviewed). Details, measurements and open items: `docs/PROJECT_SOURCE_OF_TRUTH.md` §B ("Roster input") and §I.

## 7. Existing implementation to reuse

Inspected in the testing repository on 2026-11-19:
- Vite + React + TypeScript single-page application; no runtime dependencies beyond React.
- Existing roster is stored in browser `localStorage`; testing site has an isolated storage key.
- Existing `RosterEntry` references player IDs, and `buildPlayerLookup` resolves NHL/ESPN aliases.
- Existing roster import supports paste parsing, exact-name auto-matching, explicit ambiguity review, suggestions, and unmatched handling.
- Existing `PlayerSearch` supports searching the bundled player directory.
- Existing data pipeline refreshes NHL schedules and team rosters plus ESPN fantasy eligibility, validates snapshots, and runs daily via GitHub Actions.
- Current `PlayersFile` contains player identity/team/position/eligibility information, not season performance statistics. Player Evaluator therefore needs a new validated statistics data shape and pipeline step.
- Existing testing repository: `jmaser54/fantasy-hockey-schedule-optimizer-testing`, default branch `main`. Do all experiments here first. Do not change the live repository until the owner reviews and approves the tested result.

Relevant existing files to inspect before implementation:
- `src/state/appState.ts`
- `src/data/format.ts`
- `src/data/load.ts`
- `src/data/pipeline/nhl.ts`
- `scripts/refresh-data.ts`
- `src/domain/rosterImport.ts`
- `src/ui/Roster.tsx`
- `src/ui/common.tsx`
- `src/ui/App.tsx`
- `src/styles.css`
- `.github/workflows/refresh-data.yml`
- `scripts/check-data.ts`

## 8. Acceptance criteria for a useful public V1

1. A returning user with a saved roster can open Player Evaluator and see results without uploading or pasting the roster again.
2. A new user can populate a roster through the existing paste/manual-entry experience.
3. Skaters are matched to NHL statistics by stable player ID, not name-only guesses.
4. The default benchmark is league max: the highest GP among all NHL skaters in the current season's stats (changed 2026-11-21 from the roster maximum).
5. Every displayed counting statistic is normalized correctly; every displayed rate/context statistic follows its documented unchanged treatment.
6. Actual GP and actual statistics remain visible alongside adjusted values.
7. Users can add external NHL skaters to the comparison without changing their fantasy roster.
8. Users can choose league max, the roster maximum, an external benchmark player, or a custom GP benchmark.
9. Missing, zero-GP, or unmatched player data is handled transparently without crashing or fabricating adjusted values.
10. Statistics are sourced from a validated current-season regular-season dataset with a visible update timestamp.
11. The experience is understandable and usable at desktop and phone widths, with no regressions to existing features.
12. Goalies are clearly outside V1; screenshot recognition is not required for release.
13. Typecheck, unit tests, build, data validation, and relevant browser smoke tests pass in the testing repository.

## 9. Implementation sequence

1. **Data proof of concept:** verify NHL stats endpoints and live 2026–27 responses; establish exact fields, report joins, pagination, player-ID coverage, and refresh behavior.
2. **Domain model and tests:** define the normalized stats model and pure calculation functions; test zero GP, fractional values, benchmark changes, missing stats, and unchanged metrics. Include the ranking calculations (§3.7). *Implemented 2026-11-20 in `src/domain/evaluator.ts`.*
3. **Saved-roster integration:** read the existing roster without duplicating or changing its persistence model. *Implemented 2026-11-20: `evaluateSavedRoster` and `loadSkaterStats` in `src/data/evaluatorData.ts`, evaluator preferences in `src/state/evaluatorPrefs.ts`.*
4. **Minimal evaluator UI:** roster-wide results, actual/adjusted values, benchmark control, and external player search. *Implemented 2026-11-20 as a working prototype for review (`src/ui/Evaluator.tsx`); details and open review items in `docs/PROJECT_SOURCE_OF_TRUTH.md` §I.*
5. **Visual/mobile refinement:** review at desktop, 390px, and 360px widths.
6. **Testing and public V1:** validate with realistic data and existing users before promoting from the testing repository to the live repository.

Screenshot recognition proceeds as a separate parallel workstream and is not a release gate.
