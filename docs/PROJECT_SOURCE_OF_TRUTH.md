# Playoff Planner — Project Source of Truth

Development reference for this repository. **Not part of the website**: nothing under `docs/` is built or deployed (see §F). The repository is public on GitHub, so this file is readable there; it contains no secrets.

How to use it: read the sections relevant to your change, then confirm against the current code and tests. Code can drift from this document and this document can drift from code; when they disagree, investigate and flag it rather than silently picking one (see `CLAUDE.md`).

Labels used below:
- **Confirmed**: an explicit owner decision or requirement.
- **Implemented**: verified in the current code; not necessarily an explicit requirement.
- **Open**: unresolved; ask before changing behavior.

Last reviewed against commit `c9af699` (2026-10-19); sections touched by the 2026-11-12 changes reviewed against the code.

**Testing repo:** `jmaser54/fantasy-hockey-schedule-optimizer-testing` (default branch `main`, site https://jmaser54.github.io/fantasy-hockey-schedule-optimizer-testing/) is where the owner tries changes before they come here. Rounds 1–3 (its commits `5c2d2dc`, `952152a`, `004f18f`) were brought to live on 2026-11-12. The testing repo has its own `CLAUDE.md` and copy of this document, and no GA tag.

---

## A. Product purpose and scope

**Playoff Planner** is a guest-first, single-page web app for fantasy hockey managers. It maximizes the number of **player-games that fit the user's daily lineups** for the next week, the league's fantasy playoff rounds or any custom period, using the real NHL schedule. It's built around the user's roster. It doesn't maximize fantasy points.

Live site: https://jmaser54.github.io/fantasy-hockey-schedule-optimizer/ (GitHub Pages).

Primary workflows (tabs, in order; `src/ui/App.tsx` `TABS`). The site opens on Team Schedules (no hash or an unknown hash → `#rankings`; owner decision, round 2):
1. **Team Schedules** (`src/ui/Rankings.tsx`, short label "Schedules" on phones): which NHL teams play the most, and on light nights, in the selected window.
2. **Roster** (`src/ui/Roster.tsx`): paste or search players. Set position eligibility, Active/IR and ★ Preferred, then remove or clear. No period toggle here; its Games column is always next week.
3. **Lineup** (`src/ui/Lineup.tsx`): the optimizer's results.
   - Summary cards, a player × date grid, and a day editor with Start/Sit.
   - This page *is* "the optimizer"; there's no separate optimizer page.
4. **Trade Lab** (`src/ui/Trades.tsx`): try drops and adds and compare games in the lineup, current vs proposed. "Current" is always the saved roster. "Update Roster" applies the tested moves after a confirmation.
5. **League Settings** (modal, `src/ui/Settings.tsx`): roster size, IR slots, lineup slots and playoff rounds. Cancel and Save (`.modal-actions`) sit in normal flow below "Add Round" / "Restore 2027 Defaults" at the bottom of the form, and scroll with it (not sticky; owner decision). There's no Contact link in it any more.
6. **About** (`src/ui/About.tsx`): opened only from the footer link; not a tab.
7. **Contact** (`src/ui/Contact.tsx`): opened from the footer's Contact link, in its own dialog (`ContactModal` in `App.tsx`).

**Confirmed scope and exclusions:**
- Guest-first: no accounts, Firebase or backend. All user state lives in the browser's `localStorage`.
- Real NHL data only; no mock data presented as real.
- No max-goalies setting. A "goalie limit" setting was removed on purpose; don't reintroduce it.
- Not modeled: games-played caps, transaction limits, weekly lineup locks, player quality or points. A goalie game is an *opportunity* (the team plays), not a confirmed start.

## B. Confirmed product requirements

### Terminology and copy (Confirmed)
- App name: "Playoff Planner". Labels use Title Case. "Trade Lab" has a capital L.
- Never say "usable games" in user-facing UI. Use:
  - overall totals: "N of M scheduled games fit your lineup";
  - per-player counts: "In Lineup / Scheduled".

  Code still uses `usable` field names internally (`DayResult.usable`, `PlayerTotals.usable`); that's fine.
- Team Schedules intro: "Click a team to view game dates."
- Roster status options: "Active" and "IR". The old "IR (mark injured)" label is gone.
- Roster-limit warning: "Your roster has N players, but your current limit is L. If your roster is correct, update your league settings. Otherwise, drop players or move eligible players to IR." (`src/domain/roster.ts` `describeIssue`).
- Contact intro: "Have feedback? Send us a message."
- Browser title: "Fantasy Hockey Playoff Planner" (`index.html`); the in-page brand stays "Playoff Planner".
- Subtitle under the brand: "Plan your next week — and your playoff run. Add your roster to see which pickups are worth it."
- The "How it works" strip was removed in round 2 (owner decision); only the subtitle stays.
- Roster shortcut above "NHL Team Schedules": a "+ Add your roster" pill while the roster is empty; then "Roster: N players" with an "Edit" link. Both go to the Roster tab (`RosterPill` in `Rankings.tsx`).
- League Settings button: gear icon plus the words "League Settings", at every width (`.tabbar .settings-btn`).
- Setup line under the period bar: "<roster size> roster · <IR slots> IR · <starters> starters", e.g. "22 roster · 2 IR · 13 starters" (starters = the sum of lineup slot counts, `activeSlotCount`). In Playoffs mode it adds the selected round, e.g. "· Round 1: Feb 22 – Mar 7, 2027". Clicking it opens League Settings (`SetupLine` in `App.tsx`). It also shows on Roster, where there's no period bar.
- Roster Games column header: "Games next week" (on phones, rows read "N games next week").
- Trade Lab, under the comparison table, two lines: "Test any move before you make it — a trade, a waiver pickup, a drop — and see how it changes your lineup." then the original note, restored word for word: "Both columns use optimal daily lineups. This compares schedule opportunity only, not player quality."
- Link previews (`index.html`): meta description and `og:description` "Add your roster and see which NHL teams give you the most games that fit your lineup in your fantasy playoffs — plus which pickups are worth it." (reworded in round 2 to drop "usable games"), `og:title` "Fantasy Hockey Playoff Planner", `og:type` "website", `og:url` the **live** URL, `twitter:card` "summary". No `og:image`: the repo has no suitable image, and the owner said not to create one.

### Visual and UX (Confirmed)
- **Light theme on every device**, whatever the OS dark-mode setting. `color-scheme: only light` in `src/styles.css` `:root` and in a `<meta>` in `index.html`; `theme-color` is `#ffffff`. Don't add `prefers-color-scheme: dark` rules.
- Main tables have a white background.
- Desktop appearance must not change when making mobile improvements.
- **Mobile Phase 1 (done, commit `284c651`):**
  - Roster rows show in two lines at ≤600px.
  - All four tabs fit at ≤600px; "Team Schedules" shows as "Schedules", with the accessible name unchanged.
  - (Superseded in round 2: League Settings is now a labeled button at every width.)
  - Larger tap targets under `@media (pointer: coarse)`.
- Phases 2 and 3 of the mobile plan aren't done (§H).
- **Header:** the brand and subtitle sit above the tabs and scroll away. The tab bar (`.tabbar`) is sticky and holds the tabs plus the League Settings button, so the button stays visible while scrolling (owner decision, round 2). On desktop the button sits at the right of the tabs; at ≤600px it sits on its own row above them.
- **Custom period rows on phones (≤600px):** the name field and its delete ✕ share the first line, and the dates fill the second line (CSS grid on `.custom-row`).

### Roster and league rules (Confirmed)
- **IR is the user's Active/IR selection, nothing else** (commit `2e5c617`).
  - A player set to IR uses an IR slot and never plays.
  - No injury status, injured mark or "Who Can Use IR" setting exists.
  - Only the IR slot count is enforced.
- IR slots are *in addition to* roster size: `rosterSize` non-IR players plus `irSlots` IR players.
- League changes never remove players; conflicts are reported (`validateRoster`).
- Defaults (`src/domain/league.ts`):
  - roster 22, IR 2;
  - slots: C×2, LW×2, RW×2, D×4, UTIL×1 (C/LW/RW/D), G×2;
  - rounds: R1 2027-02-22→03-07, R2 03-08→03-21, R3 03-22→04-04.
- Paste import auto-accepts **exact** name matches only. Ambiguous names (e.g. two Elias Petterssons) and typos are never guessed; the user chooses (`src/domain/rosterImport.ts` `matchName`).
- Clear Roster lives inside the roster panel and needs confirmation. It keeps settings, rounds, custom players and Trade Lab adds.
- The "Not on NHL Roster" badge and the "not on NHL roster" labels in search and paste review were removed from the UI. The `inactive` data flag stays (§D, §H).

### Optimization (Confirmed)
- Objective: the most player-games in the lineup per day, summed over the window. Days are independent, and lineup moves are free.
- **Player priorities:** a single ★ Preferred flag per roster player. Default is not preferred.
  - Preferred players win contested spots across the whole selected period.
  - Priorities must never break position eligibility, overfill slots, or leave a fillable spot empty.
- **Daily manual overrides:** per date, the user can Start or Sit players.
  - The rest of the lineup refills automatically around those choices, by priority.
  - A choice on one date never changes other dates.
  - Changing a priority updates automatically optimized dates but keeps manual choices.
  - Reset Day, or Reset <period>, removes choices and returns to the priority-aware optimum.
  - Choices that become invalid (IR, no game, no room, roster change) are ignored *visibly*, never forced into an invalid lineup.
  - Manually adjusted days are marked: a "Your Changes" badge, an underline on the date in the grid, and an "edited" tag on summary cards.
- **Day editor:**
  - Selecting a date in the grid scrolls its editor into view below the sticky header. The ← → day arrows don't scroll.
  - A hint above the grid reads "Select a date to view and edit that day's lineup."
  - The editor title is "Lineup for <date>", with In Lineup and Sitting Out sections.

### Counts and summary metrics (Confirmed, commit `bfbc1a7` plus the priorities work)
- A player's **In Lineup** count = games where the player is actually seated in the *final* lineup, including manual choices.
- **Scheduled** = games the player's NHL team plays in the window's dates.
- Never count a player as in the lineup just because their team plays.
- Summary cards show "X of Y games fit your lineup" plus "Skaters a/b · Goalies c/d", summed from the same per-player totals as the grid rows. Skaters + Goalies = the headline = the grid footer.
- Everything recalculates immediately after a priority change, lineup edit, reset, roster change or period change.

### Schedule and date ranges (Confirmed / Implemented)
- **Period modes (owner decision, 2026-11-12):** a three-option toggle at the top of the period bar: "Next Week" (default), "Playoffs", "Custom". It switches the period for every tab. The mode is **not saved**: every visit starts on Next Week (`Ready` `mode` state in `App.tsx`).
  - **Next Week:** next Monday through Sunday (`nextWeek(easternToday())` in `src/domain/dates.ts`; on a Monday it's the following week). The bar shows only the toggle and a small date label, e.g. "Nov 16 – Nov 22, 2026".
  - **Playoffs:** the round buttons, exactly as before: each configured round plus "Full Playoffs" = the union of round dates (each date counted once). Defaults to Round 1 for new users (`initialState().selection` is the first round's id); a saved round or "Full Playoffs" selection is kept. Rounds are still edited in League Settings. **Don't change the presets** (Round 1 Feb 22–Mar 7, Round 2 Mar 8–21, Round 3 Mar 22–Apr 4, 2027; Full Playoffs Feb 22–Apr 4).
  - **Custom:** starts with one empty period, plus "Add period". Each period has a name (default "Period N"), any start and end date, and a delete button. "Add Total" adds an optional "Total" window spanning all complete periods; "Remove Total" takes it out. Until a period has valid dates, the tabs show "Enter a start and end date for your period above." Custom periods last only for the visit (not saved; the owner said not to add persistence).
  - The old saved `custom` range and `setCustom` action are kept so older saves load unchanged, but nothing in the UI uses them any more. A saved `selection` of `'custom'` falls back to Round 1 in Playoffs mode.
- `windows` in the context is the current mode's windows; `playoffWindows` is always the rounds plus Full Playoffs. Team Schedules uses `playoffWindows` for its "Full Playoffs" context column and the per-round breakdown.
- All dates are `YYYY-MM-DD` in the NHL's Eastern game-date convention. No local-time `Date` math; "today" for Next Week is the Eastern date (`easternToday`).
- Light night = at most half the teams play, i.e. ≤8 games with 32 teams (`src/domain/rankings.ts` `isLightNight`).
- Team Schedules:
  - The tab always shows, in order: "Games per Night", "NHL Team Schedules", then "Schedule Grid". The old "Team Rankings / Schedule Grid" toggle is gone (owner decision, 2026-11-12). Rankings are consistent with the selected window; columns sort ascending and descending.
  - The Schedule Grid covers the selected window: 7 days in Next Week, the full window in Playoffs or Custom.
  - **Roster highlight:** grid rows for teams with at least one roster player get `tr.mine-row`: light-blue row header with a blue left edge, and light-blue off-day cells, also on hover. Game cells keep their grey (`--surface-2`) background. The existing `mine-dot` stays. No highlight with an empty roster.
  - Games-per-night bars show that night's matchups; "Your Players" counts are clickable.
  - The Schedule Grid shows daily NHL game counts, with dates larger than the counts, and has no mouse-following hover lines.

### Trade Lab (Confirmed)
- **Baseline follows the roster (owner decision, round 2):** "Current" is always the saved roster, so roster changes on the Roster tab show up in Trade Lab automatically. Nothing copies the roster into Trade Lab; there's no separate Trade Lab roster.
- **"Update Roster" (owner decision, round 3)** sits in the Current vs Proposed panel header and pushes the tested moves into the saved roster:
  - It's enabled only when the proposed roster differs from the saved one (some tested add or drop would change it); otherwise it's disabled.
  - It first shows a confirmation listing the players to add and drop ("Update your saved roster? / Add: … / Drop: …"). Cancel applies nothing.
  - On OK it dispatches `scenarioApply`: the roster becomes the proposed roster (kept players keep their IR and ★ settings), dropped players' daily choices are removed, and the scenario is cleared. Current then equals Proposed, and Roster, Lineup and the rest update immediately. Toast: "Roster updated."
  - Tested drops and adds (`state.scenario`) never change the saved roster any other way.
- No Undo button, no "Back to current roster" button, and no Scheduled Games column. Zero change shows "+0".
- The label "In Lineup / Scheduled" sits above the period name, with an info tip.
- **Implemented:** both columns use *optimal* daily lineups. Priorities apply; manual daily choices are ignored (§H).

### Persistence (Confirmed)
- Priorities and per-date choices survive reloads via the app's `localStorage` persistence. Overrides are keyed by date, so they only affect windows containing that date.

### About page (Confirmed)
- A small "About" link sits at the far right of the footer, with the data note ("NHL data updated <date>") on the left and "Contact" just before About. Neither may appear in the main navigation or prominently on the main page.
- It opens a minimal About view at `#about`, using the app's existing hash navigation. There's no in-page Back button: the tabs and League Settings provide navigation, and the browser Back button returns to the previous tab.
- Exact copy:
  - Title: "About Playoff Planner".
  - Text: "Playoff Planner was created by Jeff Maser to help fantasy hockey managers optimize their lineups by combining NHL team schedules, roster data, and custom league settings. Users can also visualize how trades and free-agent moves would affect their lineups."
- **Implemented:**
  - The period bar is hidden on About, and no tab shows as selected.
  - The tabs and the League Settings button still work from About.
  - About opens at the top of the page.
  - No GA page view is sent for About (unchanged analytics behavior).

### Analytics and contact (Confirmed / Implemented)
- **GA4:** tag `G-NYB64MVCVE` in `index.html` (live only; the testing repo removed it so test visits don't count). When bringing changes over from the testing repo, keep this tag.
  - One `page_view` per in-app tab change, with page title "Playoff Planner – <Tab>" (`src/analytics.ts`, called from `App.tsx`).
  - No custom events, no Google Tag Manager, no Firebase.
  - Don't change the Measurement ID without explicit instruction (§H).
- **Contact:** the footer's "Contact" link (next to About) opens the same form in its own dialog. Its Back button, Escape or a click on the backdrop closes it. Moved out of League Settings on 2026-11-12 (owner decision).
  - Submission is a standard FormSubmit form post with the same recipient and settings as Letter Ladder's `contact.html`:
    - `https://formsubmit.co/jmaser4@gmail.com`;
    - `_template=box`, `_captcha=false`, subject "Playoff Planner — Contact form message".
  - `_next` returns visitors to the same page and tab with `?contact=sent`, and the app shows a "Message sent" toast (`src/contact.ts`, `src/ui/Contact.tsx`).
  - The owner accepted that the address is visible in page source.
  - Real delivery has never been verified (§H).

## C. Architecture and data flow

Vite 6 + React 18 + TypeScript (strict), Vitest. No runtime dependencies besides React.

| Area | Files | Role |
|---|---|---|
| Entry | `index.html`, `src/main.tsx`, `src/ui/App.tsx` | Shell, tabs (hash routing via `tabFromHash`), the About view (`#about` via `isAboutHash`; `about` state, separate from `tab`), header (brand, subtitle, how-it-works strip, sticky `.tabbar`), data loading, footer (`DataFooter`: data note plus Contact and About links), `ContactModal`, toast. `Ready` holds the period mode and custom periods, builds the app context, and renders the period bar (`PeriodBar`, `CustomEditor`) unless `periodBar` is false, plus the Settings modal (`overlay`). |
| Context | `src/ui/context.ts` | `AppCtx`: `state`, `dispatch`, `data`, `resolve`, `teams`, `windows` (current mode), `playoffWindows`, `selected`, `lineupPlayers`, `days`, `summarizeWindow`, `toast`. |
| State | `src/state/appState.ts` | `AppState`, `reducer` (actions: select, setCustom, setPeriods, setLeague, addPlayers, removePlayer, updateEntry, replacePlayer, addCustomPlayer, clearRoster, setManual, clearManual, scenario, scenarioApply), `proposedRoster`, tolerant `deserialize`/`serialize`, `loadFromStorage`/`saveToStorage`. |
| Domain (pure, tested) | `src/domain/*` | `optimizer.ts` (daily lineup, priorities, overrides, totals), `matching.ts` (Kuhn bipartite matching), `capacity.ts` (daily group counts, `lineupGroupTotals`), `roster.ts` (`validateRoster`, `describeIssue`, `toLineupPlayers`, `effectivePositions`), `schedule.ts` (`ScheduleIndex`, `teamOnDate`, `playerGameOn`, `playerGames`, `opponent`), `league.ts`, `dates.ts`, `rankings.ts`, `teamSchedules.ts`, `rosterImport.ts`, `names.ts`, `types.ts`. |
| Data load | `src/data/load.ts`, `src/data/format.ts`, `src/data/validate.ts` | Fetch `public/data/*.json`, validate, build `Dataset`; `isStale` (more than 3 days old); `buildPlayerLookup` (resolves `nhl-<id>`/`espn-<id>` aliases). |
| Data pipeline (Node, CI only) | `scripts/refresh-data.ts`, `src/data/pipeline/{nhl,espn,reconcile}.ts` | Fetch NHL teams, schedules and rosters plus ESPN eligibility; strict parse; reconcile; validate; write `public/data/{schedule,players}.json`. |
| UI pages | `src/ui/Rankings.tsx`, `Roster.tsx`, `Lineup.tsx`, `Trades.tsx`, `Settings.tsx`, `Contact.tsx`, `common.tsx` | `common.tsx`: `PosBadges`, `PosToggles`, `PlayerSearch`, `Delta`, `InfoTip`, `PreferredToggle`. |
| Other | `src/analytics.ts`, `src/contact.ts`, `src/styles.css` | GA page views, contact config, all CSS (tokens on `:root`, phone and touch media queries at the end). |

**Data flow** (all recomputed from state with `useMemo`; nothing derived is stored):
1. `loadDataset()` loads the schedule and player directory.
2. `lookup.resolve(entry.playerId)` maps saved roster entries to `Player`s. IDs that now resolve under a different ID are migrated once with `replacePlayer` (`App.tsx` effect).
3. `toLineupPlayers(state.roster, playersMap)` produces `LineupPlayer`s: effective positions, `onIr`, `preferred`.
4. `optimizeDates(allDates, lineupPlayers, state.league, data.schedule, state.manual)` runs over the union of the current mode's window dates, once per date. It returns a `Map<date, DayResult>` (`App.tsx` `days`).
5. `summarizeWindow(window)` calls `summarize(daysForWindow)` and returns a `RangeResult` with per-player `PlayerTotals {scheduled, usable}` plus day totals.
6. The Lineup summary cards use `lineupGroupTotals(summary.players, lineupPlayers)`; the grid rows use the same `PlayerTotals`.
7. Trade Lab runs `optimizeDates` separately for the current and proposed rosters **without** `state.manual`.

**Where business rules live:**
- Lineup selection, priorities, overrides and unused-game reasons: `optimizeDay` in `src/domain/optimizer.ts`.
- Roster and IR validation: `validateRoster` in `src/domain/roster.ts`.
- League validation: `validateLeague` and `validatePeriod` in `src/domain/league.ts`.
- Group summaries: `lineupGroupTotals` in `src/domain/capacity.ts`.
- Which team a player is on per date (trades): `teamOnDate` in `src/domain/schedule.ts`.
- Saved-data migration and tolerance: the loaders (`loadRoster`, `loadManual`, …) in `src/state/appState.ts`.

## D. Critical business rules and invariants

Each rule below is enforced by the code or tests named; keep them true.

1. **Maximum lineup per day.** With no daily choices, each date seats the maximum possible number of players with a game. Priorities change *who* plays, never *how many*. (`optimizer.test.ts` "priorities never break eligibility or capacity…" random cross-check; `matching` brute-force test.)
2. **Priority mechanics.**
   - `priorityOrder` sorts Preferred first, then roster order (stable).
   - `assignInOrder` runs Kuhn's algorithm in that order. Kuhn never unseats a seated player, which makes this the greedy algorithm on a transversal matroid: maximum cardinality *and* the most Preferred players.
   - Replacing the matching algorithm with one that lacks this property silently breaks priorities.
3. **Eligibility and capacity.**
   - A player fills at most one seat, and only a seat whose `accepts` includes one of their effective positions.
   - Seats come from `expandSeats(league.slots)`; no seat holds two players; IR players never get seats.
4. **Daily choices** (`DayOverride {start[], sit[]}`, keyed by date in `state.manual`):
   - Starts are placed first, then everyone else not sat, by priority.
   - A start is honored only if the player is on the roster, not on IR, has a game, and fits among the other starts. Otherwise it's skipped and reported in `DayResult.manualIssues`.
   - Sat players get the reason `{kind: 'sat'}`.
   - An empty override deletes the date entry (`reducer` `setManual`).
   - A player without a game can't be started; the old "Started with no game" state no longer exists.
5. **Scheduled ≠ in lineup.**
   - `summarize` counts `scheduled` for every rostered player whose team plays, including IR players, and `usable` only when `seatKey` is set.
   - `DayResult.scheduled` excludes IR players.
   - The Lineup summaries exclude IR players from both groups (`lineupGroupTotals`), so they equal `RangeResult.usable/scheduled` and the daily footer.
6. **Goalie grouping.**
   - The Lineup grid rows and the summary cards both treat a player as a goalie only if *every* listed position is G (`isGoalie` in `Lineup.tsx` `LineupGrid`; `isGoalieOnly` in `capacity.ts`). Change both together, or neither.
   - They differ only for a player with no positions: the grid counts them as a goalie, the summaries as a skater (§H #11).
   - The grid's "Skaters"/"Goalies" count rows (`dailyGroupCounts`) are a separate measure, players with a game vs active slots. They count a player in each group they can play, so a dual-eligible player counts in both.
7. **IR.**
   - `onIr` alone decides IR.
   - `validateRoster` reports only `over-roster`, `over-ir`, `unknown-player` and `no-positions`.
   - IR players stay in saved daily choices; those choices are reported as not applying while the player is on IR.
8. **Roster limits** count non-IR entries against `rosterSize` and IR entries against `irSlots`. Players are never auto-removed.
9. **Dates and periods.**
   - Ranges are inclusive at both ends (`eachDate`).
   - "Full Playoffs" counts each date once even if rounds overlap.
   - A traded player is on exactly one team per date, via stints (`teamOnDate`; `optimizer.test.ts` case 9).
10. **Stale or invalid saved data.**
    - Each saved field loads independently, without discarding the rest (`deserialize`).
    - A notice appears only when the saved data is unreadable, or when the league, playoff dates or roster fail validation (those reset to defaults).
    - Other fields silently fall back or are filtered: custom range, selection, custom players, daily choices, Trade Lab draft.
    - Old manual seat maps load as that date's starts.
    - The legacy fields `markedInjured` and `irEligibility` are ignored and dropped on the next save.
    - Overrides for dates outside every window are kept but have no effect.
11. **The data snapshot must validate.**
    - `validateSchedule`/`validatePlayers` run in the refresh, in CI (`scripts/check-data.ts`) and at app load (`buildDataset`).
    - Two checks are **refresh-only**: exactly 84 games per team (`expectedGamesPerTeam`, `GAMES_PER_TEAM` in `scripts/refresh-data.ts`), and cross-checking every game in both teams' schedules (`mergeClubSchedules`).
    - CI and the app validate structure and consistency, but not the per-team count.

## E. Persistence and data integrity

- **Storage:**
  - Key `playoff-optimizer:v1` in `localStorage` (`STORAGE_KEY`, `STATE_VERSION = 1`).
  - Saved on every state change (`App.tsx` effect, then `saveToStorage`).
  - If storage fails, a banner says changes can't be saved.
  - No backend. The roster and settings never leave the browser. The only outbound traffic is the GA tag (page load plus a page view per tab change) and contact form posts.
- **Saved data:**
  - `league` (rosterSize, irSlots, slots), `periods`, `custom` range, `selection`;
  - `roster` (`RosterEntry`: `playerId`, `onIr`, optional `positionsOverride`, optional `preferred`, stored only when true);
  - `customPlayers`, `manual` (date → `{start, sit}`), and `scenario` (the Trade Lab draft: drops, adds).
- **Associations:**
  - Priorities and IR live on roster entries, keyed by player ID.
  - Overrides are keyed by ISO date and reference player IDs.
  - `replacePlayer` (ID migration) carries the entry's fields *and* rewrites the ID inside every date's choices.
  - `removePlayer` removes the player from all choices and drops dates left empty.
  - `clearRoster` clears `manual` and Trade Lab drops.
- **Player IDs:**
  - `nhl-<nhlId>` for players on NHL rosters; `espn-<espnId>` for ESPN-only players; user-created custom players.
  - `buildPlayerLookup` resolves either alias, so a saved `espn-` player who later appears in NHL data migrates automatically.
- **Integrity risks:**
  - Changing `STORAGE_KEY` or the loader shapes without migration would wipe or corrupt users' saved rosters. Keep loaders tolerant and add tests in `src/state/appState.test.ts`.
  - The data refresh (a bot commit) can change player IDs or teams; the lookup aliases and team stints handle this.

## F. Testing, builds and deployment

**Commands** (`package.json`):
- `npm test`: `vitest run`. Currently 85 tests in 9 files:
  - `src/domain/optimizer.test.ts` (20): spec cases 1–10, overrides, priorities, brute-force matching.
  - `capacity.test.ts` (7): summary reconciliation.
  - `domain.test.ts` (12): dates, league/IR validation, rankings.
  - `rosterImport.test.ts` (7), `teamSchedules.test.ts` (7).
  - `src/state/appState.test.ts` (11): reducer, persistence, legacy saves, Trade Lab proposals.
  - `src/data/pipeline/pipeline.test.ts` (16): parsers, reconciliation, history.
  - `src/analytics.test.ts` (3), `src/contact.test.ts` (2).
- `npm run typecheck`: `tsc -b`.
- `npm run build`: `tsc -b && vite build`, output in `dist/` (gitignored).
- `node --experimental-strip-types --no-warnings scripts/check-data.ts`: validates the committed snapshot.
- `npm run data:refresh`: fetches NHL/ESPN data. **It can't run in the dev container**, which has no access to the NHL or ESPN APIs.

**CI and deployment** (`.github/workflows/`):
- `ci.yml`: on every push and PR, runs typecheck, tests, `vite build` and the data check.
- `deploy-pages.yml`:
  - Triggers: every push (it deploys only when the ref is the repo's **default branch**: `claude/practical-faraday-ti8p02` in the live repo, `main` in the testing repo), plus manual runs and calls from the refresh workflow.
  - Build: `BASE_PATH=/<repo>/ npx vite build`, then uploads **`dist/` only**.
  - Afterwards, `scripts/smoke-test.mjs` checks the live URL in headless Chromium (Playwright 1.56.1, installed in the job; the job runs on `ubuntu-24.04`, see §G 15):
    - the live data matches the committed snapshot, and Team Schedules (`#rankings`) shows 32 teams in its first table (`.table-wrap`; the Schedule Grid is a second table);
    - the data status chip and paste mode as the Roster default;
    - the Lineup heading matches `/of \d+ scheduled games fit your lineup/`;
    - the roster persists across a reload;
    - GA hits are intercepted, not sent;
    - no browser errors.
- `refresh-data.yml`: daily at 10:17 UTC, and on pushes that touch the pipeline. It tests, refreshes, commits `public/data` as `github-actions[bot]` if changed, then calls the deploy.
- **Pushing to the default branch redeploys the live site.** Commit messages containing `[skip ci]` skip push-triggered workflows.
- **What's published:** only what Vite builds, i.e. `index.html`, bundled `src/` and `public/` (data). `docs/`, `README.md`, `IMPLEMENTATION.md`, `CLAUDE.md` and `scripts/` are never published.

**Verification practice:**
- UI changes have been verified with ad-hoc Playwright scripts against `vite preview`, at 390px and 360px phone widths and on desktop, with screenshot pixel comparisons proving desktop was unchanged. **These scripts aren't committed.**
- **Gap:** there are no UI component tests in the repo.
- **Environment limits:** the dev container can't reach NHL, ESPN, `github.io` or `formsubmit.co`. Live-site checks come only from the smoke-test job; contact delivery can only be simulated.

## G. Known pitfalls and regression risks

1. **Summary cards vs grid rows.**
   - An earlier version computed the goalie line as "goalie opportunities / slot-days" (75/84) when the rows summed to 54/75.
   - Summaries must derive from `PlayerTotals` via `lineupGroupTotals`, never a separate estimate.
   - Verify with `capacity.test.ts` and by summing grid rows in the browser.
2. **"Text-only" changes must stay text-only.**
   - A label change once looked like it had broken IR; a side-by-side behavior comparison proved behavior identical.
   - For copy changes, diff to confirm no handler or condition changed.
3. **The smoke test depends on copy:**
   - the Lineup heading regex;
   - the Roster tab name `/^Roster/`;
   - the "Paste player names" label;
   - the "NHL data" status chip;
   - the Team Schedules table selector (`.table-wrap table`) and the `#rankings` start URL.

   Renaming these without updating `scripts/smoke-test.mjs` fails the post-deploy job.
4. **Global CSS selectors leak.**
   - `.settings-btn span` resized a newly added label span and changed the desktop header.
   - Scope new rules, and compare desktop screenshots before and after any CSS work.
5. **Dark mode.**
   - A leftover `prefers-color-scheme: dark` block made phones render dark after the theme was reverted.
   - Keep `color-scheme: only light`; add no dark-mode rules.
6. **Accessible names.** Hiding text with CSS for mobile (`label-full`/`label-short`) removes it from the accessibility tree. The Schedules tab needs `aria-label`. The League Settings button now shows its label at every width, so it needs no `aria-label`.
7. **ID migration must keep fields.** An older `replacePlayer` rebuilt entries as `{playerId, onIr}`, dropping other fields. It now spreads the entry. Keep that, and keep remapping IDs in `manual`.
8. **Priorities rely on Kuhn order** (§D.2). Keep `priorityOrder` stable and keep starts first in `optimizeDay`.
9. **IR simplicity.** Don't reintroduce injury-eligibility checks, an injured flag or an IR eligibility setting. The data has no injury statuses (ESPN returns none).
10. **Two optimizer call sites.**
    - `App.tsx` passes `state.manual`; Trade Lab doesn't.
    - Per-player counts in Trade Lab can therefore differ from the Lineup page when daily choices exist. That's expected under current behavior (§H).
11. **The deploy is automatic and the bot commits.**
    - The refresh workflow pushes data commits to the default branch. Pull with rebase before pushing.
    - Every push to the default branch redeploys the site.
12. **Mobile layout.**
    - The Roster two-line layout depends on the class names `r-name`, `r-team`, `r-elig`, `r-games`, `r-status`, `r-remove` and on the row column count.
    - Adding a roster column means updating the ≤600px grid in `styles.css`.
    - Test at 360px; that's where overflow appeared.
13. **Footer timing and layout.** The footer (`.data-status`, a flex row: data note left; Contact and About right, the first link pushed right by `margin-left: auto` and the second reset by `.foot-link + .foot-link`, including in the touch rule) renders immediately, with only "About" until data loads. The smoke test reads its "NHL data" text only after the Team Schedules table has rendered; keep that ordering if you change either.
14. **Contact return flow.**
    - `takeContactReturn()` runs once in `App`'s toast state initializer and strips `?contact=sent`, keeping the hash.
    - `_next` must stay an absolute URL built at runtime (`contactReturnUrl`).
15. **Smoke-test runner pin.** On 2026-10-27, `ubuntu-latest` moved to Ubuntu 26.04, and Playwright 1.56.1 refused to install Chromium there ("does not support chromium on ubuntu26.04-x64"). That failed the deploy smoke test, which the daily refresh also runs. The `smoke-test` job in `deploy-pages.yml` is pinned to `ubuntu-24.04`; the other jobs don't use Playwright and stay on `ubuntu-latest`. Unpin it only together with a Playwright upgrade that supports the newer image.
16. **Smoke-test waits.** Don't wait for `networkidle` after the app has loaded: gtag can keep a request open, and the persistence `reload` timed out on 2026-10-30. Wait for `domcontentloaded` or `load`, then for a specific element. No smoke-test navigation uses `networkidle`. The first `goto` waits for the rankings rows and the "NHL data" status; the persistence reload waits for the Lineup heading.

## H. Open questions and discrepancies

| # | Topic | Confirmed | Current implementation | Uncertain / inconsistent | Ask before changing? |
|---|---|---|---|---|---|
| 1 | IR players in Lineup summaries | Summaries must match the rows and the final lineups. | IR players' scheduled games are excluded from the Skaters/Goalies/total cards, but still shown as 0/N in the grid's IR rows. | The owner was offered including them and didn't decide. | Yes |
| 2 | Trade Lab and daily choices | The Trade Lab UI says both columns use optimal daily lineups (note restored in round 2). | Trade Lab applies priorities but ignores `state.manual`. | Never explicitly confirmed as intended. | Yes |
| 3 | GA Measurement ID | The tag `G-NYB64MVCVE` was requested and is installed. | `index.html` uses `G-NYB64MVCVE`. | The owner saw `G-T0YYP0GJSY` in a new GA setup screen. Two options were offered (keep the current ID, or swap to the new one); no choice was made. The owner said not to install a second tag or change the ID yet. | Yes |
| 4 | Contact delivery | Reuse Letter Ladder's FormSubmit recipient and settings; the address is public. | Standard POST to `formsubmit.co/jmaser4@gmail.com`; simulated tests only. | Real delivery is unverified; FormSubmit may send a one-time activation email for the new site. | No (verify with a real message) |
| 5 | ESPN-only / `inactive` players | Remove the UI badge and labels; keep the data flag. | About 808 ESPN-only players use ESPN's team; retired players (e.g. Toews) still count their old team's games. | Whether to filter or label stale players is undecided. | Yes |
| 6 | Stale repo docs | — | `IMPLEMENTATION.md` still mentions "IR with eligibility rules", "IR slots and rule", Trade Lab "undo, back to current roster", "66/66 passing" and "usable player-games". `README.md` is titled "Playoff Schedule Optimizer" and says "usable player-games". | These describe removed or renamed behavior. This document is current. | No (update when authorized) |
| 7 | Mobile Phases 2–3 | Do the mobile work in reviewed phases; desktop stays unchanged. | Phase 1 is done. | Not done: Lineup per-player totals hidden at the far right, legend and cards long; Team Schedules hidden columns and cut-off date chips, 14px bars; Trade Lab Add below the Drop list; period bar wraps to 2 lines. | Yes (the owner reviews each phase) |
| 8 | Touch target sizes | Aim for about 40–44px where practical. | Position toggles are 32×34 (space-limited); Lineup grid cells weren't enlarged. | — | No |
| 9 | Missing-player roster rows on mobile | — | Rows with class `missing` keep the table layout at ≤600px. | Not exercised with real data. | No |
| 10 | Priority granularity | ★ Preferred is binary. | Ties break by roster order. | No full ranking; the owner hasn't asked for one. | Yes, if requested |
| 11 | Players with no positions | — | `LineupGrid` (`every` on an empty list) treats them as goalies; `isGoalieOnly` treats them as skaters. `validateRoster` reports `no-positions`. | Only reachable through an old saved custom player or a data record with no positions; the UI can't create one. | No (fix only if it matters) |
| 12 | Lineup slot rows on phones | — | At 390px and 360px, each Daily Lineup Slots row is wider than the dialog: the G toggle is cut off and the remove (×) button sits off-screen, reachable only by scrolling the dialog sideways. Found on 2026-10-21; the overflow was already there before the Cancel/Save move. | Not fixed; outside that change. | No (fix when authorized) |
| 14 | Testing site identity | — | The testing repo's `og:url` points to the live URL (as asked), so previews of the testing URL claim the live URL. | Matters only for the testing site. | Yes |
| 15 | Custom periods aren't saved | The owner said not to add persistence. | Custom-mode periods and the Total last only for the visit. | Users may expect them to survive a reload. | Yes |
