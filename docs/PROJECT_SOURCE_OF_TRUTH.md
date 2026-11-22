# Playoff Planner — Project Source of Truth

Development reference for this repository. **Not part of the website**: nothing under `docs/` is built or deployed (see §F). The repository is public on GitHub, so this file is readable there; it contains no secrets.

How to use it: read the sections relevant to your change, then confirm against the current code and tests. Code can drift from this document and this document can drift from code; when they disagree, investigate and flag it rather than silently picking one (see `CLAUDE.md`).

Labels used below:
- **Confirmed**: an explicit owner decision or requirement.
- **Implemented**: verified in the current code; not necessarily an explicit requirement.
- **Open**: unresolved; ask before changing behavior.

Last reviewed against commit `2430b9662da3bc7de067f465d79edbeb1feff43a` (2026-11-19); existing behavior reviewed against the testing repository, and Player Evaluator decisions recorded in §I. §I's NHL statistics findings were added on 2026-11-20 from the probe run at `67ea97e`, and the skater-stats pipeline step (§C, §F, §I) was reviewed against the code on 2026-11-20. On 2026-11-20 the owner's Player Evaluator decisions (minimum GP, benchmarks, ranking categories, persistence) were recorded in §I, and the Step 3 saved-roster integration (§C, §E, §F, §I) was reviewed against the code. The Step 4 prototype UI (§B, §C, §E, §F, §I) and the owner's Step 4 decisions were recorded on 2026-11-20 and reviewed against the code; the owner's first prototype revisions (two navigation families, two evaluator destinations, merged comparison rows, multi-column rankings) were recorded and reviewed on 2026-11-21, followed the same day by the owner's second iteration (equal product areas in the navigation, league max as the default benchmark, a leaner Player Rankings header). On 2026-11-21 screenshot import matching (first initials, umlaut variants, OCR margin; §B, §C, §F, §I) was reviewed against the testing code. On 2026-11-22 historical seasons (§F, §I "Historical seasons") were added and reviewed against the testing code, then promoted to live.

**This copy lives in the live repo** `jmaser54/fantasy-hockey-schedule-optimizer` (default branch `claude/practical-faraday-ti8p02`, site https://jmaser54.github.io/fantasy-hockey-schedule-optimizer/). Changes are tried first in the testing repo `jmaser54/fantasy-hockey-schedule-optimizer-testing` (default branch `main`, site https://jmaser54.github.io/fantasy-hockey-schedule-optimizer-testing/). The last full promotion was testing `cf877ed` (2026-11-22). Since then the owner approved, one by one: the "Per game" label and tooltip, the four-times-a-day refresh, the smoke-test reliability fix, and (2026-11-22, promoted at testing `3bb4f51`) the historical-season experience (§I "Historical seasons"). The live repo matches testing except for the live-only files: `index.html` (GA tag, below), `CLAUDE.md`, and the live current-season data snapshots in `public/data/` (`schedule.json`, `players.json`, `skater-stats.json`, refreshed here). The historical snapshots `skater-stats-20242025.json` and `skater-stats-20252026.json` are the same validated files as testing (fetched 2026-11-22, testing run 45049015579). Parts of this document written in the testing repo still say "here" or "the testing repo" for work done there first; the code described is now also live.

---

## A. Product purpose and scope

**Playoff Planner** is a guest-first, single-page web app for fantasy hockey managers. It maximizes the number of **player-games that fit the user's daily lineups** for the next week, the league's fantasy playoff rounds or any custom period, using the real NHL schedule. It's built around the user's roster. It doesn't maximize fantasy points.

Live site: https://jmaser54.github.io/fantasy-hockey-schedule-optimizer/ (GitHub Pages).

Primary workflows (tabs, in order; `src/ui/App.tsx` `TABS`). The site opens on Team Schedules (no hash or an unknown hash → `#rankings`; owner decision, round 2):
1. **Team Schedules** (`src/ui/Rankings.tsx`, short label "Schedules" on phones): which NHL teams play the most, and on light nights, in the selected window.
2. **Roster** (`src/ui/Roster.tsx`): paste or search players. Set position eligibility, Active/IR and ★ Preferred, then remove or clear. No period toggle here; its Games column is always next week.
3. **Lineup** (`src/ui/Lineup.tsx`): the optimizer's results.
   - Summary cards, a player × date grid, and an ESPN-style day editor (tap a player's position button, then a highlighted position).
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
- Trade Lab, under the comparison table, two lines (owner's exact wording, round 7): "Test a trade or pickup before you make it and see how it changes your lineup." then "Compares the number of games players can start in your lineup based on your league’s roster positions and eligibility." Don't reintroduce "optimal daily lineups". It measures schedule opportunity, not player quality.
- Trade Lab panel order: Add first, then Drop (round 7). On phones Add sits above Drop; on desktop the two sit side by side, Add on the left.
- Link previews (`index.html`): meta description and `og:description` "Add your roster and see which NHL teams give you the most games that fit your lineup in your fantasy playoffs — plus which pickups are worth it." (reworded in round 2 to drop "usable games"), `og:title` "Fantasy Hockey Playoff Planner", `og:type` "website", `og:url` the **live** URL, `twitter:card` "summary". No `og:image`: the repo has no suitable image, and the owner said not to create one.

### Visual and UX (Confirmed)
- **Light theme on every device**, whatever the OS dark-mode setting. `color-scheme: only light` in `src/styles.css` `:root` and in a `<meta>` in `index.html`; `theme-color` is `#ffffff`. Don't add `prefers-color-scheme: dark` rules.
- Main tables have a white background.
- Desktop appearance must not change when making mobile improvements.
- **Mobile Phase 1 (done, commit `284c651`):**
  - Roster rows show in two lines at ≤600px.
  - All four Playoff Planner tabs fit at ≤600px; "Team Schedules" shows as "Schedules", with the accessible name unchanged. Since 2026-11-21 they sit in a secondary row under the product-area row (Games Optimizer / Player Normalizer, two-line labels at ≤600px, §I).
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
- Switching between Paste Roster and Search Players never focuses an input (no `autoFocus`; removed 2026-11-21 because focusing made phones zoom or jump). The fields work normally when tapped.
- **Roster input (owner decisions, 2026-11-21):** three equal modes in the segmented toggle: Paste Roster, Upload Image, Search Players (`INPUT_MODES` in `Roster.tsx`). Each label is always two lines, one word per line ("Paste / Roster", "Upload / Image", "Search / Players"), at every width (owner request, 2026-11-22; `.mode-word` spans, with a real space between them so the accessible names are unchanged).
- **Import (paste and screenshots share one path, `extractRosterNames` in `src/domain/rosterImport.ts`):** names are found inside each line of a whole roster page (slots, stats, menus, opponents around them), including "Last, First" and comma lists; a nearby team code ("EDM", "Edm", "(EDM)") is a hint, but "@TOR"/"vs Det" are opponents and never hints. On **Add Players**:
  - exact, unambiguous players are added at once, with no confirmation (a unique exact name is accepted whatever the nearby team says; the team only chooses between same-name players);
  - players already on the roster, and duplicates within the import or across screenshots, are skipped and counted;
  - a first initial and last name ("C. McDavid", "M.Marner", "GD. Tarasov" with the slot run into the initial) is looked up in the player directory by initial + last name (`byInitial`, built from the data, no hard-coded list): a single player is added automatically; several players sharing it ("E. Pettersson", "C. Smith") go to review as "Which one?", pre-selected only when a nearby team code singles one out. A bare capital letter without a dot ("J Hughes") resolves automatically only next to a team code; otherwise it is a "Did you mean" suggestion. This step runs only for lines where no full name was found, so full names are unaffected;
  - names with ü/ö/ä also match common screenshot misreadings and spellings ("Stutzle", "Stuetzle", "Stiitzle", "Stitzle", "Stytzle"), for full names and initials, when exactly one directory player fits;
  - only same-name players ("Which one?") and near matches ("Did you mean", from `matchName`: typos, OCR errors, an initial with a misread last name) are listed for review; a near match with a single candidate (or a single candidate on the hinted team) is pre-selected for one-click confirmation, never added without the user; a review name whose candidate is already on the roster, or was found exactly elsewhere, is not asked;
  - obvious non-player text is dropped silently; name-like text that matches nobody is listed, collapsed, under "N names not recognized" with "Add as New Player…", and is never treated as imported.
  The result panel shows "N added · N already on your roster · N need a look", Skip / Add N Players when there is something to review, or Done. On phones (≤600px) each review row puts its choices on a full-width line under the name. `matchName` and `parseRosterText` are unchanged (`parseRosterText` is no longer used by the UI).
- **Upload Image:** "Choose Screenshots" (then "Add More Screenshots") opens the file picker (`accept="image/*"`, multiple); screenshots can be added at different times and removed. Each is read as soon as it is added ("Reading…" → "Ready"); Add Players imports the text of all of them together. Works with any site's layout (no site-specific reader). Loading the engine starts when the Upload Image panel opens.
- Clear Roster is a separate outlined button: red text, white background and a subtle red outline, all visible by default (hover adds a light red fill; keyboard focus a red outline). It sits on its own row directly under the Paste Roster / Search Players toggle, aligned left (`.clear-roster-row`), in both modes (owner requests, 2026-11-21; `ClearRosterButton` in `Roster.tsx`). The roster area uses one spacing rhythm (`.panel-body.roster-body`): the setup line ("22 roster · 2 IR · 13 starters") 8px under the heading row, 10px to the toggle, 8px to Clear Roster, 12px to the paste or search content; on touch screens Clear Roster is at least 36px tall. The setup line is passed through `AppCtx.setupLine` (other tabs keep it above the content); the heading row keeps "Roster", the counts and View Lineup. There is only one Clear Roster; it appears only when the roster has players, needs confirmation, and keeps settings, rounds, custom players and Trade Lab adds.
- Paste mode's hint reads "Paste your roster page - player names detected automatically" (owner wording, 2026-11-21), just above the text box, only in Paste Roster. The button is "Add Players".
- The "Not on NHL Roster" badge and the "not on NHL roster" labels in search and paste review were removed from the UI. The `inactive` data flag stays (§D, §H).

### Optimization (Confirmed)
- Objective: the most player-games in the lineup per day, summed over the window. Days are independent, and lineup moves are free.
- **Player priorities:** a single ★ Preferred flag per roster player. Default is not preferred.
  - Preferred players win contested spots across the whole selected period on automatic days. Guarded by the "star priority (regression suite)" tests in `optimizer.test.ts` (including a random-roster check against the rule) and by `stars.test.ts`.
  - **Stars vs manual days (owner decision, round 9):** starring or unstarring a player immediately recalculates automatic days and never changes a manually edited day. Explicit manual changes take precedence over stars. Reset Day to Optimal discards that day's manual lineup and recalculates with the current stars; it never changes stars. Stars change only when the user stars or unstars a player.
  - Roster tab hint (exact copy): "★ Starred players get priority in automatically optimized lineups. Manual lineup changes take precedence."
  - Day editor, only on manually edited days (exact copy): "This day keeps your saved lineup; starring or unstarring players won’t change it. Choose Reset Day to Optimal to follow current stars."
  - Priorities must never break position eligibility, overfill slots, or leave a fillable spot empty.
- **Daily manual overrides (round 6, owner decision; modeled on ESPN Fantasy's mobile lineup editor, replacing round 5's destination panel):**
  - Every row has a position button beside the player: the slot label for starters (C, LW, RW, D, UTIL, F, G…) and "BN" for bench players. Empty slots show their button with "Empty".
  - Tapping a player's button enters move mode: that button turns solid blue, the hint reads "Moving <name>: tap a highlighted position." (with Cancel), and only the positions they can take are highlighted (outlined in blue). All other buttons are disabled. Tapping the selected button again cancels.
  - Valid positions (`moveInLineup` in `optimizer.ts`, unit-tested): for a starter, another starter's slot if each can play the other's slot, an empty slot they can play, a bench player who can play their slot, or an empty "BN" row (move to the bench; the slot becomes Empty). For a bench player, a starter's slot or an empty slot they can play.
  - Tapping a highlighted position swaps exactly those two players, or moves the player there and leaves the old slot Empty. A "Lineup saved." toast confirms it.
  - **Strict per-slot eligibility** (`canPlaySeat`): a slot that takes any skater position never takes a goalie, and a goalie slot takes goalies only.
  - **Only the players involved move.** The day saves an exact lineup (`DayOverride.lineup`: every seat key → player id or null), used as is: no re-optimizing, no refilling, nobody else moves.
  - A move is never warned about, confirmed or blocked because it loses games; that includes moving in a bench player with no game (counts zero). The day's count just updates.
  - If a move returns the day to its automatic lineup (same player in every seat), the override is cleared and the dash goes away.
  - Phones (`pointer: coarse`): position buttons are 52×44px.
  - The automatic optimal lineup stays the default for every day. A move on one date never changes other dates, the roster, league settings or rounds.
  - Changing a priority updates automatically optimized dates and leaves manually edited dates exactly as saved.
  - Reset Day, or Reset <period>, removes choices and returns to the priority-aware optimum. Reset <period> asks for confirmation with exactly "Revert lineup changes?" (round 13, owner's wording; no day count).
  - Choices that become invalid (IR, no room, roster change) are ignored *visibly*, never forced into an invalid lineup.
  - Manually adjusted days are marked: a "Your Changes" badge, a blue dash under the date in the grid, and an "edited" tag on summary cards. The legend has no entry for the dash (removed in round 7, owner decision).
- **Day editor:**
  - Selecting a date in the grid scrolls its editor into view below the sticky header. The ← → day arrows don't scroll.
  - The date headers are buttons (`.day-btn`). The hint above the grid reads "Tap a day to change that day's lineup."
  - The editor title is "Lineup for <date>", with In Lineup and Bench sections and the instruction "Tap a player’s position to move them." The Bench lists every non-IR player not in the lineup, including those with no game ("No game").
  - **Slot order (round 7, owner decision):** `expandSeats` lists F slots (two or more forward positions, no D or G) first, then every other slot in the league's order (UTIL stays where it is), then goalie-only slots last. This applies even when F was added after G in League Settings, whose own list order is unchanged. Seat keys don't depend on order, so saved lineups are unaffected.
  - The automatic lineup tries each player's most specific slots first (`eligibleSeatIndices` sorts by how many positions a slot accepts), so showing F first doesn't put a LW in F while a LW slot stays empty.
  - The day view shows no priority or competition logic: no ★ toggles, no "lowest-priority" line, no "<slots> full (…)" lists, no Sit/Start buttons. (The week grid's hover tooltips still give unused-game reasons.)

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
  - NHL Team Schedules shows a "Full Playoffs" context column for a single round or a Custom period, but **not in Next Week** (owner decision, round 8). In Next Week the table (`table.next-week`) lets its headers wrap on phones so every column, Your Players included, fits at 360px. The Full Playoffs view itself (rounds + Total) is unchanged.
  - **Roster indicator:** teams with at least one roster player show the blue `mine-dot` beside the team code. The light-blue row shading (`tr.mine-row`) was removed at the owner's request on 2026-11-21, restoring the plain rows; other grid formatting is unchanged.
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
- **Open tabs stay in sync (round 11):** when saved data changes in another tab, each open page reloads it at once (`storage` event in `App.tsx`, reducer action `load`) and doesn't write it back. Before, another open tab kept showing, and could later re-save, an old lineup. That's what made Reset Next Week to Optimal look broken until a refresh.
- **Separate storage per site (round 12, owner decision):** the live and testing sites share one domain (`jmaser54.github.io`) and so one browser storage. `storageKeyFor(BASE_URL)` in `appState.ts` gives the testing build (base `/fantasy-hockey-schedule-optimizer-testing/`) the key `playoff-optimizer-testing:v1`; the live site and local runs keep `playoff-optimizer:v1`. Nothing is migrated or copied: the testing site starts empty. Tab sync only reacts to its own key, so it never crosses between the sites.

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
- **GA4 (live repo only):** the live repo has tag `G-NYB64MVCVE` in `index.html`. **The testing repo has no GA tag** (removed in round 2 so test visits don't count in live analytics). `src/analytics.ts` still exists here and does nothing when `gtag` isn't loaded. Don't copy the tag removal to the live repo by accident.
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

Vite 6 + React 18 + TypeScript (strict), Vitest. Runtime dependencies: React, and `tesseract.js` (7.0.0, Apache-2.0) for screenshot import, loaded as a separate chunk only when Upload Image is used. `@tesseract.js-data/eng` (MIT) is a dev dependency: its English model is copied into the build.

| Area | Files | Role |
|---|---|---|
| Entry | `index.html`, `src/main.tsx`, `src/ui/App.tsx` | Shell, tabs (hash routing via `tabFromHash`), the About view (`#about` via `isAboutHash`; `about` state, separate from `tab`), header (brand, subtitle, how-it-works strip, sticky `.tabbar`), data loading, footer (`DataFooter`: data note plus Contact and About links), `ContactModal`, toast. `Ready` holds the period mode and custom periods, builds the app context, and renders the period bar (`PeriodBar`, `CustomEditor`) unless `periodBar` is false, plus the Settings modal (`overlay`). |
| Context | `src/ui/context.ts` | `AppCtx`: `state`, `dispatch`, `data`, `resolve`, `teams`, `windows` (current mode), `playoffWindows`, `selected`, `lineupPlayers`, `days`, `summarizeWindow`, `toast`. |
| Screenshot OCR | `src/ui/ocr.ts`, `vite.config.ts` (`ocrAssets` plugin) | Upload Image reads screenshots with Tesseract.js in Web Workers, in the browser (images never leave the device). `ocr.ts` greyscales, inverts dark-mode images, caps width at 1600px and adds a 32px white margin on every side (so a row touching the bottom or side edge of a screenshot is still read), then recognizes text; up to two workers read screenshots in parallel. The plugin copies the worker, three WASM core variants (the browser downloads one) and `eng.traineddata.gz` (4.0.0 best_int) into `dist/ocr/`, and serves them from `node_modules` in dev. First use downloads about 4.4 MB (gzipped); the browser caches it (the model also in IndexedDB). |
| Evaluator preferences | `src/state/evaluatorPrefs.ts` | Player Evaluator comparison players, benchmark choice and rankings minimum GP, in their own storage key (§E, §I). |
| Player Evaluator UI | `src/ui/Evaluator.tsx`, `src/ui/evaluatorFormat.ts` | The Player Evaluator destinations, Roster Evaluation (`#evaluator`) and Player Rankings (`#player-rankings`), under one `EvaluatorView`: lazy stats load, shared benchmark bar, the two stat tables (§I). Pure display helpers (stat groups, short labels, formatting, stats-name search, comparison-row merge and sorting) in `evaluatorFormat.ts`. |
| State | `src/state/appState.ts` | `AppState`, `reducer` (actions: select, setCustom, setPeriods, setLeague, addPlayers, removePlayer, updateEntry, replacePlayer, addCustomPlayer, clearRoster, setManual, clearManual, scenario, scenarioApply), `proposedRoster`, tolerant `deserialize`/`serialize`, `loadFromStorage`/`saveToStorage`. |
| Domain (pure, tested) | `src/domain/*` | `optimizer.ts` (daily lineup, priorities, overrides, totals), `matching.ts` (Kuhn bipartite matching), `capacity.ts` (daily group counts, `lineupGroupTotals`), `roster.ts` (`validateRoster`, `describeIssue`, `toLineupPlayers`, `effectivePositions`), `schedule.ts` (`ScheduleIndex`, `teamOnDate`, `playerGameOn`, `playerGames`, `opponent`), `league.ts`, `dates.ts`, `rankings.ts`, `teamSchedules.ts`, `rosterImport.ts`, `names.ts`, `types.ts`, `evaluator.ts` (Player Evaluator calculations and league-wide ranking data, §I). |
| Data load | `src/data/load.ts`, `src/data/format.ts`, `src/data/validate.ts` | Fetch `public/data/*.json`, validate, build `Dataset`; `isStale` (more than 3 days old); `buildPlayerLookup` (resolves `nhl-<id>`/`espn-<id>` aliases). |
| Evaluator data | `src/data/evaluatorData.ts` | `buildSkaterStats` / `loadSkaterStats` (validate and fetch `skater-stats.json`, separately from `loadDataset`) and `evaluateSavedRoster` (reads the saved roster into `evaluator.ts`, §I). Used only by the Player Evaluator tab. |
| Data pipeline (Node, CI only) | `scripts/refresh-data.ts`, `src/data/pipeline/{nhl,espn,reconcile,stats}.ts` | Fetch NHL teams, schedules and rosters plus ESPN eligibility; strict parse; reconcile; validate; write `public/data/{schedule,players}.json`. Then, as an independent step, fetch the NHL Stats REST skater reports, join them, validate, and write `public/data/skater-stats.json` (§I). The app fetches that file only when the Player Evaluator tab is opened (`loadSkaterStats`). |
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
4. **Daily choices** (`DayOverride {start[], sit[], lineup?}`, keyed by date in `state.manual`):
   - **Older start/sit days are frozen on load:** `Ready` (`App.tsx`) converts every saved day without `lineup` into the exact lineup it currently produces (`freezeOverride`), once. The user sees the same lineup, and later star changes can't re-sort it. Its "no longer applies" warnings are kept in `DayOverride.notes` and still shown (day editor notice and the week view's flag); later moves on that day keep them, and Reset Day to Optimal clears them with the day. (Start/sit days only pinned the chosen players and re-sorted the rest by stars, so they used to change when a star changed.)
   - **Exact lineup** (`lineup`, written by the day editor): used seat by seat with no re-optimizing or refilling. Entries for players who left the roster, went on IR or can't play that seat (`canPlaySeat`) are dropped and reported in `manualIssues`. If the league's seats no longer match (slots changed), the whole lineup is ignored with an issue and the day is automatic. `removePlayer`/`replacePlayer` empty or rename the seat. `isEmptyOverride` treats any `lineup` as a change. The loader keeps `lineup`; older saves without it work as before.
   - Without `lineup` (older saves), the start/sit rules below apply:
   - Starts are placed first, then everyone else not sat, by priority.
   - A start is honored if the player is on the roster, not on IR, and fits among the other starts. Otherwise it's skipped and reported in `DayResult.manualIssues`. Started players with a game are placed before started players without one.
   - Sat players get the reason `{kind: 'sat'}`.
   - An empty override deletes the date entry (`reducer` `setManual`).
   - **A started player without a game takes a seat and counts zero** (round 4, owner decision). This reverses the earlier rule that such starts were ignored. It's needed so a swap that loses games always goes through.
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
  - **Player Evaluator preferences (Confirmed 2026-11-20; Implemented in `src/state/evaluatorPrefs.ts`, used by the Player Evaluator tab):** comparison players (NHL ids), the selected benchmark and the rankings minimum GP (default 10) are kept under a separate key, `playoff-evaluator:v1` (live and local) or `playoff-evaluator-testing:v1` (testing base), shape `{version: 2, comparisons, benchmark, minGamesPlayed}`. Saved on every change from the tab; not synced between open tabs (the roster is). Never stored in the app state, so saving them can't touch the roster. Benchmarks are stored as the choice (`league-max`, `roster-max`, a player, or a custom number), never a resolved GP, so they stay dynamic. Version 2 (2026-11-21) made league max the default; version 1 always saved its default (`roster-max`), so a version-1 `roster-max` loads as league max, while version-1 player and custom choices are kept. Loading is tolerant (bad fields fall back to defaults).
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
- `npm test`: `vitest run`. On 2026-11-22 (saved season) it ran **220 tests in 16 files**, including:
  - `src/data/pipeline/stats.test.ts` (17: stats request URL, pagination, report join, `validateSkaterStats` incl. the completed-season check);
  - `src/domain/evaluator.test.ts` (35: incl. the Full season basis and ranking on actual totals (`benchmarkGp: 'own'`), the Per Game 1 GP benchmark, incl. ranking by actual values (`sortBy`), normalization, roster classification, benchmarks incl. the league-max default, roster-max fallback and season limit, comparisons, rankings incl. the 10-GP default, PIM/+/-, direction and position filter);
  - `src/data/evaluatorData.test.ts` (8: the saved roster read through `deserialize(serialize())` and never changed, IR/goalie/ESPN-only/custom/alias handling, preferences applied, the published snapshot against the published directory);
  - `src/state/evaluatorPrefs.test.ts` (11: separate per-site keys, the saved season and completed-season benchmark (2026-27 default), round trip incl. min GP, league-max default and version-1 migration, clearing comparison players, tolerant parse, saving prefs leaves the roster key byte-for-byte unchanged);
  - `src/ui/evaluatorFormat.test.ts` (6: stat groups, value formatting, stats-name search, sorting by normalized or actual values, comparison players inserted by position, roster and comparison rows sorted together).

   The rest of the per-file list below predates that and is stale (Open: refresh it when this section is next reviewed):
  - `src/domain/optimizer.test.ts` (20): spec cases 1–10, overrides, priorities, brute-force matching.
  - `capacity.test.ts` (7): summary reconciliation.
  - `domain.test.ts` (12): dates, league/IR validation, rankings.
  - `rosterImport.test.ts` (22: incl. 15 for `extractRosterNames`: whole pages, opponents, duplicates, "Last, First", ambiguous and near matches, unrecognized names, unique vs shared first initials, slot merged into an initial, umlaut variants), `teamSchedules.test.ts` (7).
  - `src/state/appState.test.ts` (11): reducer, persistence, legacy saves, Trade Lab proposals.
  - `src/data/pipeline/pipeline.test.ts` (16): parsers, reconciliation, history.
  - `src/analytics.test.ts` (3), `src/contact.test.ts` (2).
- `npm run typecheck`: `tsc -b`.
- `npm run build`: `tsc -b && vite build`, output in `dist/` (gitignored).
- `node --experimental-strip-types --no-warnings scripts/check-data.ts`: validates the committed snapshot, plus `skater-stats.json` when present. It prints a warning instead of failing while that file doesn't exist yet.
- `npm run data:refresh`: fetches NHL/ESPN data. **It can't run in the dev container**, which has no access to the NHL or ESPN APIs.

**CI and deployment** (`.github/workflows/`):
- `ci.yml`: on every push and PR, runs typecheck, tests, `vite build` and the data check.
- `deploy-pages.yml`:
  - Triggers: every push (it deploys only when the ref is the repo's **default branch**: `claude/practical-faraday-ti8p02` in the live repo, `main` in the testing repo), plus manual runs and calls from the refresh workflow.
  - Build: `BASE_PATH=/<repo>/ npx vite build`, then uploads **`dist/` only**.
  - Afterwards, `scripts/smoke-test.mjs` checks the live URL in headless Chromium (Playwright 1.56.1, installed in the job; the job runs on `ubuntu-24.04`, see §G 15):
    - the live data is the committed snapshot or a newer one (2026-11-22: a refresh started by the same push can deploy on top, §G 18), and Team Schedules (`#rankings`) shows 32 teams in its first table (`.table-wrap`; the Schedule Grid is a second table);
    - the data status chip and paste mode as the Roster default;
    - Upload Image opens and the self-hosted OCR files (`ocr/worker.min.js`, `ocr/eng.traineddata.gz`, a core) are served (OCR is not run; each check is tried up to 3 times, §G 18);
    - the Lineup heading matches `/of \d+ scheduled games fit your lineup/`;
    - the roster persists across a reload;
    - Roster Evaluation loads the published skater stats and shows the roster with a "Normalized to N GP" benchmark; Player Rankings lists the roster player with roster shading; neither changes the saved roster;
    - historical seasons (2026-11-22; seasons read from `HISTORICAL_SEASONS` in `src/data/format.ts`): each `data/skater-stats-<season>.json` is served (3 tries) and is that season's complete regular-season snapshot; the Season select lists every season on Roster Evaluation and Player Rankings and is absent from the Games Optimizer (Roster, Lineup); a new visitor starts on the current season; for each completed season Player Rankings shows "(final)", offers exactly Full season / Per game, Full season shows totals with the snapshot's points leader first and Per game shows 3-decimal values with the snapshot's points-per-game leader first (leaders computed from the fetched file, ties allowed, min 10 GP); the season and Per game are saved and survive a reload, and Roster Evaluation shows the roster player's GP from that season; switching back restores the current season's benchmark options and choice and saves `season: null`; the saved roster is never changed. No exact rankings, values or timestamps are hard-coded, and the snapshots don't change when a refresh deploys on top;
    - Reset <period> to Optimal updates the visible lineup and saved data at once, and a change or reset in one tab shows in another open tab without a reload (skipped if McDavid has no game that week);
    - storage isolation: the other site's key is seeded with a different roster, which this site must never read, sync from or change;
    - GA hits are intercepted, not sent;
    - no browser errors.
- `probe-nhl-stats.yml`: Player Evaluator investigation only. It runs manually or on pushes to `scripts/probe-nhl-stats.mjs` or the workflow itself, prints an NHL Stats REST report to the job log, and uploads raw responses as the `nhl-stats-probe` artifact. It writes nothing to the repository or the site.
- `historical-stats.yml` (both repos, 2026-11-22): manual only (`workflow_dispatch`, optional `seasons` input; empty = every season in `HISTORICAL_SEASONS`). Runs the tests, then `npm run data:historical` (`scripts/fetch-historical-stats.ts`), commits `public/data/skater-stats-<season>.json` as `github-actions[bot]` ("data: historical skater stats snapshots") if changed, then calls the deploy workflow. Never scheduled: completed seasons don't change.
- `refresh-data.yml`: four times a day at 02:17, 08:17, 14:17 and 20:17 UTC (changed 2026-11-22 from once daily at 10:17 UTC, which GitHub started 7–10 hours late, so a night's games were missing until the next afternoon; owner report: stale Player Evaluator stats), and on pushes that touch the pipeline. It tests, refreshes, commits `public/data` as `github-actions[bot]` if changed (message "data: refresh NHL schedule, player directory and skater stats"), then calls the deploy.
  - A schedule or player failure still fails the job and writes nothing.
  - A skater-stats failure (fetch, parse, join or validation) keeps the previous `skater-stats.json`, logs the failure to the report and as a job `::warning` annotation, and doesn't block the schedule and player files (**Confirmed** 2026-11-20).
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
   - the Roster tab name `/^Roster(\s*\d+)?$/` (anchored at both ends since 2026-11-21: plain `/^Roster/` also matched the new "Roster Evaluation" tab and failed Playwright's strict mode; new tab names must not collide with these selectors);
   - the "Paste player names" label;
   - the "Upload Image" tab and "Choose Screenshots" button, and the `ocr/` file names;
   - the "NHL data" status chip;
   - the Team Schedules table selector (`.table-wrap table`) and the `#rankings` start URL.

   - the product-area buttons "Games Optimizer" and "Player Normalizer" (exact accessible names), the Player Evaluator tab names "Roster Evaluation" and "Player Rankings", and the `.planner-tabs` group.

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
17. **Several open tabs.** Every open page keeps its own copy of the state. Without the `storage` sync, a reset (or any change) in one tab left other tabs stale, and a later change there re-saved the old data. Reproduce by opening two tabs; the smoke test covers it.
18. **Two deploys from one push (2026-11-22).** A push that touches the data pipeline (`src/data/**`, `scripts/refresh-data.ts`, `refresh-data.yml`) starts both the push's Pages deploy and a data refresh, which commits newer data and deploys again seconds later. The smoke test checks out the branch head when it starts, so it can see either snapshot. Two failures followed: live run 45038101595 (15:25 UTC) lost one OCR `HEAD` request to `ECONNRESET` right after the second deploy, with no retry; testing run 45049394421 (17:26 UTC) checked out before the bot's data commit and waited for an exact `fetchedAt` match the site could no longer show, until the 10-minute job limit cancelled it. In both cases the refresh's own deploy and smoke test passed. Fixed in testing `7471fd7`: the data check accepts the committed snapshot or a newer one, and the OCR checks retry (3 tries, 5 s apart). Promoted to live as `c130ac5` on 2026-11-22 (owner approval; smoke test only).

## H. Open questions and discrepancies

| # | Topic | Confirmed | Current implementation | Uncertain / inconsistent | Ask before changing? |
|---|---|---|---|---|---|
| 1 | IR players in Lineup summaries | Summaries must match the rows and the final lineups. | IR players' scheduled games are excluded from the Skaters/Goalies/total cards, but still shown as 0/N in the grid's IR rows. | The owner was offered including them and didn't decide. | Yes |
| 2 | Trade Lab and daily choices | The Trade Lab UI says both columns use optimal daily lineups (note restored in round 2). | Trade Lab applies priorities but ignores `state.manual`. | Never explicitly confirmed as intended. | Yes |
| 3 | GA Measurement ID | The tag `G-NYB64MVCVE` was requested and is installed. | `index.html` uses `G-NYB64MVCVE`. | The owner saw `G-T0YYP0GJSY` in a new GA setup screen. Two options were offered (keep the current ID, or swap to the new one); no choice was made. The owner said not to install a second tag or change the ID yet. | Yes |
| 4 | Contact delivery | Reuse Letter Ladder's FormSubmit recipient and settings; the address is public. | Standard POST to `formsubmit.co/jmaser4@gmail.com`; simulated tests only. | Real delivery is unverified; FormSubmit may send a one-time activation email for the new site. | No (verify with a real message) |
| 5 | ESPN-only / `inactive` players | Remove the UI badge and labels; keep the data flag. | About 808 ESPN-only players use ESPN's team; retired players (e.g. Toews) still count their old team's games. | Whether to filter or label stale players is undecided. | Yes |
| 6 | Stale repo docs | — | `IMPLEMENTATION.md` still mentions "IR with eligibility rules", "IR slots and rule", Trade Lab "undo, back to current roster", "66/66 passing" and "usable player-games". `README.md` is titled "Playoff Schedule Optimizer" and says "usable player-games". | These describe removed or renamed behavior. This document is current. | No (update when authorized) |
| 7 | Mobile Phases 2–3 | Do the mobile work in reviewed phases; desktop stays unchanged. | Phase 1 is done. | Not done: Lineup per-player totals hidden at the far right, legend and cards long; Team Schedules hidden columns and cut-off date chips, 14px bars; period bar wraps to 2 lines. | Yes (the owner reviews each phase) |
| 8 | Touch target sizes | Aim for about 40–44px where practical. | Position toggles are 32×34 (space-limited); Lineup grid cells weren't enlarged. | — | No |
| 9 | Missing-player roster rows on mobile | — | Rows with class `missing` keep the table layout at ≤600px. | Not exercised with real data. | No |
| 10 | Priority granularity | ★ Preferred is binary. | Ties break by roster order. | No full ranking; the owner hasn't asked for one. | Yes, if requested |
| 11 | Players with no positions | — | `LineupGrid` (`every` on an empty list) treats them as goalies; `isGoalieOnly` treats them as skaters. `validateRoster` reports `no-positions`. | Only reachable through an old saved custom player or a data record with no positions; the UI can't create one. | No (fix only if it matters) |
| 12 | Lineup slot rows on phones | — | At 390px and 360px, each Daily Lineup Slots row is wider than the dialog: the G toggle is cut off and the remove (×) button sits off-screen, reachable only by scrolling the dialog sideways. Found on 2026-10-21; the overflow was already there before the Cancel/Save move. | Not fixed; outside that change. | No (fix when authorized) |
| 14 | Testing site identity | — | The testing site's `og:url` points to the live URL (as asked). Its GA tag was removed in round 2. | Previews of the testing URL claim the live URL. | Yes |
| 15 | Custom periods aren't saved | The owner said not to add persistence. | Custom-mode periods and the Total last only for the visit. | Users may expect them to survive a reload. | Yes |

## I. Player Evaluator (new feature; product direction confirmed 2026-11-19)

- Full feature requirements and implementation guidance: [`docs/PLAYER_EVALUATOR_SPEC.md`](PLAYER_EVALUATOR_SPEC.md).
- **Working names only:** the existing schedule/lineup optimizer is provisionally called **Lineup Planner**; the new feature is provisionally **Player Evaluator**. **Confirmed 2026-11-21:** the top-level navigation labels are "Games Optimizer" (the schedule/lineup tools) and "Player Normalizer" (this feature); "Playoff Planner" stays the website name. Other user-facing naming is not locked.
- **Product direction confirmed:** add a separate roster-wide skater statistical-normalization experience. It complements, but must not be merged into, the existing lineup optimization workflow.
- **V1:** skaters only; current-season regular-season stats; actual and adjusted counting totals shown side by side; default benchmark is league max, the highest GP among all NHL skaters in the current season's stats (Confirmed 2026-11-21; previously the roster maximum). Adjust counting statistics by `actualStat / actualGP * benchmarkGP`. Leave percentages, per-game/per-minute averages, plus/minus and other context-dependent measures unchanged unless a statistic-specific decision is documented. Preserve actual values and clearly label the benchmark. This is a comparison of observed production rates, not a projection.
- **Benchmark controls:** default league max, with roster max selectable; optional external NHL skater(s) for comparison; allow an external player to be selected as benchmark and allow a custom GP benchmark. External comparison players must not be added to or alter the saved fantasy roster.
- **Roster and privacy:** reuse the existing saved browser-local roster and player-ID lookup. No accounts, backend, ESPN/Yahoo authorization, or repeated roster upload requirement. Existing roster paste/manual entry remains available.
- **Goalies:** deliberately excluded from V1 pending separate design. Preserve goalies in the existing roster and explain their exclusion in Player Evaluator.
- **Injury adjustment:** excluded from V1.
- **Data:** current bundled player directory contains identity/team/position/eligibility data, not season performance stats. The skater-statistics snapshot and refresh step are **implemented** (below). The snapshot keeps the last good file on failure. The Player Evaluator tab fetches it when opened and shows its update time and a stale warning (below).

### Verified NHL statistics source (data proof of concept, 2026-11-20)

Verified from GitHub Actions (`.github/workflows/probe-nhl-stats.yml` running `scripts/probe-nhl-stats.mjs`, run 44678868587 at commit `67ea97e`) against live 2026–27 data. These are observations of an undocumented external API, not guarantees; the refresh must keep validating them.

- **Endpoint:** `https://api.nhle.com/stats/rest/en/skater/{report}?isAggregate=false&isGame=false&start=<n>&limit=100&sort=[{"property":"playerId","direction":"ASC"}]&cayenneExp=gameTypeId=2 and seasonId<=20262027 and seasonId>=20262027`. No key or special headers. The `season` endpoint lists `20262027` (start 2026-09-29, regular season ends 2027-04-10, `numberOfGames` 84).
- **Pagination:**
  - Every request returns **at most 100 rows**. `limit=-1`, 101, 500 and 1000 all returned 100 rows with `total` 782. The `limit=-1` "fetch all" in the reference docs does not work.
  - Page with `start` += 100 until `rows >= total`. That takes 8 pages per report, all four reports finished in under 15 s, and each report is about 0.5 MB.
  - **Always sort on the unique `playerId`.** Unsorted pagination returned 25 duplicate and 5 missing players in `summary`. Sorted pagination returned exactly `total` rows with no duplicates.
- **Coverage and IDs:**
  - Each report returned 782 rows: 782 distinct `playerId`s, all with `gamesPlayed` ≥ 1 (range 1–25). By position: 272 D, 244 C, 137 R and 129 L.
  - Skaters with 0 GP have **no row**, so a missing row means 0 GP or not an NHL skater.
  - All 32 teams appear.
  - `playerId` is the same NHL ID as `Player.nhlId` in `players.json`.
- **Season and game type:**
  - Every row has `seasonId` 20262027. **Rows have no `gameTypeId` field**, so game type can only be enforced through the query, which must always send `gameTypeId=2`.
  - Preseason (`gameTypeId=1`) and playoffs (`3`) currently return 0 rows.
  - An invalid `cayenneExp` returns HTTP 500, which the existing retry-then-throw `getJson` treats as a failure.
- **Traded players:** with `isAggregate=false`, a traded player still has **one row** with season totals and `teamAbbrevs` as a comma list (8 rows, e.g. `"PIT,EDM"`; not alphabetical). `isAggregate=true` returns the same 782 players but drops `teamAbbrevs`. Use `isAggregate=false`, and take the current team from `players.json`, not from `teamAbbrevs`.
- **Joining:**
  - The four reports cover the identical 782 `playerId`s, so they join 1:1 on `playerId` with no orphans.
  - The shared fields agree exactly (`gamesPlayed`, `otGoals`, `faceoffWinPct`, names, position, team, season), except `timeOnIcePerGame`, which is rounded differently: 4 decimals in `summary`, 2 in `realtime` and an integer in `faceoffpercentages`. Use `summary`'s value. It is in seconds per game.
- **Internal consistency (0 violations across 782 rows):**
  - `goals + assists = points`.
  - `evGoals + ppGoals + shGoals = goals` and `evPoints + ppPoints + shPoints = points`.
  - `shootingPct = goals/shots`, and is `null` exactly when shots = 0.
  - `pointsPerGame = points/GP`.
  - `totalFaceoffWins + totalFaceoffLosses = totalFaceoffs`.
  - `faceoffWinPct = wins/total`, and is `null` exactly when total = 0 (337 players).
  - `gamesPlayed` is equal across reports.
  - League-wide faceoff wins equal losses (20,397).
- **Fields by report** (all integers unless noted):
  - **`summary`:**
    - Counting: `gamesPlayed`, `goals`, `assists`, `points`, `plusMinus`, `penaltyMinutes`, `evGoals`, `evPoints`, `ppGoals`, `ppPoints`, `shGoals`, `shPoints`, `gameWinningGoals`, `otGoals`, `shots`.
    - Rates (floats, nullable as above): `shootingPct`, `faceoffWinPct`, `pointsPerGame`, `timeOnIcePerGame`.
    - Identity: `playerId`, `skaterFullName`, `lastName`, `positionCode` (C/L/R/D), `shootsCatches`, `teamAbbrevs`, `seasonId`.
  - **`realtime`:**
    - Counting: `hits`, `blockedShots`, `giveaways`, `takeaways`, `missedShots` (plus its breakdowns), `totalShotAttempts`, `shotAttemptsBlocked`, `emptyNetGoals`, `firstGoals`.
    - Nullable: `emptyNetAssists` and `emptyNetPoints` (13 nulls).
    - Per-60 rates: `hitsPer60`, `blockedShotsPer60`, `giveawaysPer60`, `takeawaysPer60`.
  - **`faceoffwins`:** `totalFaceoffWins`, `totalFaceoffLosses` and `totalFaceoffs`, plus zone (`offensive`/`defensive`/`neutralZone…`) and situation (`ev`/`pp`/`sh…`) wins, losses and totals.
  - **`faceoffpercentages`:** only the zone and situation percentages and totals. **V1 doesn't need it**: overall `faceoffWinPct` is already in `summary`, and wins come from `faceoffwins`.
- **Coverage against `players.json`** (snapshot fetched 2026-11-19):
  - 738 directory skaters have an `nhlId`. 713 of them have a stats row; 18 active-roster skaters have none, which is consistent with 0 GP.
  - **69 skaters with 2026–27 stats have no `nhlId` in the directory**, for example Dylan Larkin (DET, 10 GP), Danton Heinen and Samuel Blais. They exist only as ESPN-only `inactive` entries (`espn-<id>`) because the NHL `roster/<team>/current` endpoint the pipeline uses didn't list them, presumably because they're injured or in the minors.
  - **Confirmed (2026-11-20):** don't resolve these now, and don't change `players.json` for them. In Player Evaluator they are flagged transparently as unmatched/unavailable (spec §3.3), and individual players may be handled manually later. This must not delay V1.
  - One directory team differs from the stats team (Mike Reilly: directory COL, stats CAR).

**V1 statistics** (**Confirmed** 2026-11-20 as listed):

| Treatment | Statistic | Source field |
|---|---|---|
| Scaled by GP | Goals, Assists, Points | `summary.goals`, `.assists`, `.points` |
| Scaled by GP | Power-play points, Short-handed points | `summary.ppPoints`, `.shPoints` |
| Scaled by GP | Shots on goal | `summary.shots` |
| Scaled by GP | Penalty minutes | `summary.penaltyMinutes` |
| Scaled by GP | Hits, Blocked shots | `realtime.hits`, `.blockedShots` |
| Scaled by GP | Faceoff wins | `faceoffwins.totalFaceoffWins` |
| Unchanged | Games played (the denominator) | `summary.gamesPlayed` |
| Unchanged | Plus/minus (spec §3.4) | `summary.plusMinus` |
| Unchanged | Shooting %, Faceoff % (`null` with 0 shots / 0 faceoffs) | `summary.shootingPct`, `.faceoffWinPct` |
| Unchanged | TOI per game (seconds) | `summary.timeOnIcePerGame` |

These are also available and verified, but not in V1: PPG, SHG, GWG, EV points, takeaways, giveaways, faceoff losses and totals, shot attempts.

**Implemented snapshot and pipeline step** (2026-11-20):
- **File:** `public/data/skater-stats.json` (`SkaterStatsFile` / `SkaterStatLine` in `src/data/format.ts`): `{ version: 1, season, gameType: 2, fetchedAt, source, skaters: [{ nhlId, name, teams, position, gamesPlayed, goals, assists, points, plusMinus, penaltyMinutes, ppPoints, shPoints, shots, hits, blockedShots, faceoffWins, shootingPct|null, faceoffWinPct|null, toiPerGame }] }`.
  - One entry per `playerId`, sorted by `nhlId`.
  - `teams` keeps the API order and isn't the current team.
  - `toiPerGame` is in seconds.
  - The first live snapshot (bot commit `c54a30d`, 2026-11-20) has 784 skaters (9 traded) and is 235 KB uncompressed; `check-data.ts` validates it.
  - At that snapshot, **71** stats skaters had no `nhlId` in the directory (the confirmed-unresolved gap above; it moves daily). One reason: when a player leaves every NHL roster but stays in ESPN's pool, the refresh turns his `nhl-<id>` entry into an ESPN-only `espn-<id>` entry without `nhlId` (seen for Jani Nyman on 2026-11-20). This is pre-existing reconcile behavior, not caused by the stats step.
- **`src/data/pipeline/stats.ts`:**
  - `statsPageUrl` always sends `gameTypeId=2`, the season, `isAggregate=false`, a 100-row `limit` and a `playerId` sort.
  - `fetchStatsReport` pages until `total`, and throws if the row count ≠ `total`, the total changes mid-fetch, or IDs repeat.
  - `joinSkaterStats` strictly parses the fields above. It throws if the reports cover different players, disagree on `gamesPlayed`, include another season, or include a non-skater position. Reports used: `summary`, `realtime`, `faceoffwins`.
- **`validateSkaterStats` (`src/data/validate.ts`) checks:**
  - version, season and `gameType` 2, plus a valid `fetchedAt`;
  - unique `nhlId`s, known positions, and team codes against the schedule's teams;
  - integer counting stats ≥ 0, `gamesPlayed` ≥ 1, integer `plusMinus`;
  - `goals + assists = points` and `ppPoints + shPoints ≤ points`;
  - `shootingPct` is null exactly when shots = 0, otherwise equals `goals/shots`;
  - `faceoffWinPct` is in [0, 1] or null, and present when there are faceoff wins;
  - `0 < toiPerGame ≤ 3600`;
  - against the previous same-season snapshot: an error below 90% of its count, a warning for any drop.
- **`scripts/refresh-data.ts`:** after writing the schedule and players, runs `refreshSkaterStats` (3 reports, about 8 pages each, through the existing retrying `getJson`). It saves each report's first page to `data-raw/` and writes the file only when it validates. It is wrapped so a failure can't block the rest (see §F).
- **Verified locally** with the whole refresh script against a mocked network:
  - success writes the file;
  - an HTTP 500 from the stats API keeps the previous file and still writes the schedule/players with exit 0;
  - invalid stats rows behave the same way.

  The live refresh runs in GitHub Actions.

**Open (data):** How quickly the stats API reflects completed games hasn't been measured; the snapshot's `fetchedAt` is the fetch time, not a "games through" date.

### Domain model and calculations (Implemented 2026-11-20, `src/domain/evaluator.ts`)

The module is pure and UI-independent. It takes the saved roster (`RosterEntry[]`), a resolver (`buildPlayerLookup().resolve`) and a stats index (`buildStatsIndex(skaters)`). It never reads or writes app state, and never changes the saved roster. Tests are in `src/domain/evaluator.test.ts`.

- **Statistics:**
  - `STAT_DEFINITIONS` lists every V1 statistic with its treatment (`scaled` / `unchanged`), unit and nullability.
  - `SCALED_STATS`: G, A, P, PPP, SHP, SOG, PIM, HIT, BLK, FOW.
  - `UNCHANGED_STATS`: GP, +/-, S%, FO%, TOI/GP.
- **`adjustedValue(actual, gp, benchmark)`:** returns `actual / gp * benchmark`, unrounded. It returns `null` instead of dividing when GP or the benchmark is missing, 0, negative or not a number.
- **`classifyRoster`:** splits the roster, in roster order, into goalies and skater subjects.
  - **Goalies:** a player whose effective, override-aware positions are all G. They are listed in `goalies` and left out of skater evaluation.
  - **Skater statuses:**
    - `ok`: matched by NHL id to a stats line.
    - `no-games`: has an NHL id but no stats line, i.e. no regular-season game in the snapshot.
    - `unmatched`: no NHL id (ESPN-only or custom player).
    - `unknown-player`: the saved id no longer resolves.
  - **Matching is by NHL id only, never by name.**
  - IR players are included (they are rostered skaters) and keep `onIr`.
  - Two saved ids that resolve to one player are listed once.
  - Players with no positions are treated as skaters.
- **`comparisonSubjects`:** adds external NHL skaters by NHL id, with names from the stats line. They are deduplicated. Ids already on the roster are reported in `alreadyOnRoster` and shown once, as roster players. An id with no stats gets `no-games`. Comparison players are never added to the saved roster.
- **`resolveBenchmark`:** every available benchmark carries a `basis` (`roster-max`, `league-max`, `player`, `custom`) so the UI can say which benchmark is in use.
  - `per-game` (added 2026-11-21): a built-in benchmark of exactly 1 GP, `basis: 'per-game'`, through the same formula (each counting stat ÷ GP). Saved like the other choices (`evaluatorPrefs.ts` accepts it).
  - `league-max` (the default, `DEFAULT_BENCHMARK`, since 2026-11-21): the highest GP among all skaters in the snapshot, whatever the roster (the snapshot holds skaters only, so goalies are never included). No player name: it is a league figure. Only an empty snapshot gives `available: false`, reason `no-stats`.
  - `roster-max`: the highest GP among roster skaters with stats, IR players included; on ties, the first in roster order. Comparison players are ignored.
  - **Roster max unavailable** (empty roster, or no rostered skater with stats): falls back to league max, `basis: 'league-max'` while `choice` stays `roster-max`, so the UI can say so.
  - `player`: any skater's GP from the snapshot.
  - `custom`: a whole number from 1 to `SEASON_GAMES` (84, the current season's regular-season games; the NHL season endpoint reported 84 for 20262027). Custom stays current-season only. The 2026-11-20 decision "current season only, no historical seasons" was superseded on 2026-11-22 by the owner's request for completed seasons (§I "Historical seasons"), which offer only Full season and Per game, so no 82-game custom limit is needed; update the constant if the NHL changes its format.
  - If the chosen player has no stats or the custom value is invalid, it returns `available: false` with a reason.
- **`evaluateSubject` / `evaluatePlayers`:** compute adjusted counting stats per subject. They return `adjusted: null` when the subject has no stats or the benchmark is unavailable. Actual totals, GP and unchanged stats always remain available through `stats`.
- **League-wide rankings: `rankPlayers(skaters, { stat, benchmarkGp, rosterNhlIds, minGamesPlayed, positions, direction, sortBy })`.** `sortBy` (added 2026-11-21) chooses the value that orders and ranks the rows: `normalized` (default, the existing behavior) or `actual` (the unadjusted total; ties and unavailable values handled the same way). Displayed values are identical either way.
  - Ranks every skater in the snapshot on one stat. `RANKING_STATS` lists the categories: every V1 stat except GP, including PIM and +/-.
  - `minGamesPlayed` defaults to `DEFAULT_RANKING_MIN_GP` = 10; pass a lower value to include more skaters. The minimum applies to rankings only; roster evaluation includes every rostered skater whatever their GP.
  - `positions` filters by NHL position code (C/L/R/D). `direction` is `desc` (highest first, the default) or `asc` (lowest first) for any stat: a ranking is a statistical ordering, not a claim that higher is better. Each row has its actual value, actual GP, normalized value and an `onRoster` flag for the blue-dot indicator.
  - Uses competition ranking: ties share a rank (1, 2, 2, 4) and are listed by GP descending, then name, then id.
  - `null` values (S% with no shots, FO% with no faceoffs) are listed last and unranked.
  - Scaled stats require a benchmark. **The benchmark changes the displayed values but never the order**, which is actual ÷ GP.
  - `rosterNhlIds(skaters)` supplies the roster flags.
  - Checked against the live snapshot: a sample roster gives McDavid as the 24 GP benchmark, Makar's 23 points over 19 GP become 29.05, Larkin is `unmatched`, Shesterkin is excluded as a goalie, and Sykora is `no-games`.

### Player Rankings (Confirmed 2026-11-20 as a required capability; presentation Open)

- **Confirmed requirements:**
  - Rank NHL skaters league-wide, not just the user's roster.
  - Rank on stats normalized to the selected benchmark (default or custom).
  - Support the available statistical categories.
  - Keep actual GP visible next to normalized values.
  - Mark players on the user's fantasy roster. Originally a small blue dot; **changed by the owner on 2026-11-21** to light-blue row shading in both Player Evaluator tables (no dots).
- **Product position (Confirmed):**
  - Rankings are an important, required part of Player Evaluator, but they are **not assumed to be its primary focus, landing view or defining feature**. Normalized rankings already exist on other fantasy sites; the value here is convenient packaging with the user's own roster highlighted.
  - Roster evaluation remains the central concept.
  - Navigation, prominence and presentation are left open for later product/design work.
- **Implemented:** `rankPlayers` (above) and a first prototype UI, the League Rankings view inside the Player Evaluator tab (below).
- **Dataset assessment for complete rankings:**
  - **Available:** every snapshot row has a stable NHL id, full name, NHL position (C/L/R/D), team(s) and all V1 stats. That's enough to list and rank every skater who has played.
  - **Gaps (not guessed):**
    - **Names aren't unique.** The 2026-11-20 snapshot has two "Elias Pettersson"s, both VAN (8480012 C, 8483678 D). Identity must use `nhlId`, and the display needs a disambiguator such as position.
    - **Blue dots require an NHL id match.** A rostered player whose directory entry has no `nhlId` (the 71 ESPN-only players at the latest snapshot) can't be flagged on the rankings, even though they appear there with stats. This is Confirmed as acceptable for now; these players are shown as unavailable in roster evaluation.
    - **Fantasy eligibility isn't in the stats snapshot.** It only has the NHL position code; fantasy positions (LW/RW, multi-position) exist only for directory-matched players.
    - **Team.** For the 9 traded players the snapshot lists several teams in an unverified order. The current team is only reliable from the directory.
    - **Skaters with 0 GP** have no row, so they can't be ranked; that's correct.
    - **No injury status** is in the snapshot.
    - **Low-GP skaters dominate normalized rankings.** 69 of 784 have ≤ 3 GP; a 1-GP skater with 1 goal ranks first in goals per GP. Handled by the 10-GP default minimum (Confirmed, below).

**Confirmed (owner decisions, 2026-11-20; Implemented as noted):**
- **Minimum GP:** league-wide rankings default to a 10-game minimum, adjustable by the user. Rankings only: rostered players appear in roster evaluation regardless of GP. (Implemented: `DEFAULT_RANKING_MIN_GP`; the adjustable control is a UI item.)
- **No-roster benchmark:** with no usable roster benchmark, use the highest GP among skaters in the league-wide stats dataset, and identify clearly which benchmark is in use. (Implemented: `basis: 'league-max'`.)
- **PIM and +/-:** both are ranking categories, sortable ascending and descending. Rankings are statistical ordering, not "higher is better". (Implemented: `RANKING_STATS`, `direction`.)
- **Position filter:** NHL position for V1; fantasy eligibility may be considered later. (Implemented: `positions`.)
- **Custom benchmark:** whole numbers from 1 through the current season's regular-season games (84 for 2026–27). Current season only (completed seasons have no Custom option, §I "Historical seasons"). Kept easy to update. (Implemented: `SEASON_GAMES`.)
- **IR players** count toward the roster-max benchmark. (Implemented.)
- **Default benchmark changed (2026-11-21):** league max, the highest GP among all NHL skaters in the current season's stats, is the default; roster max stays selectable. Users with no saved explicit benchmark get league max; explicit choices persist across visits and both destinations. If the selected source is unavailable the fallback is shown, not hidden. (Implemented.)
- **Persistence:** comparison players and explicitly selected benchmark settings are remembered between visits in local storage, separate from the saved fantasy roster; the default roster benchmark stays dynamic. The rankings minimum-GP selection is remembered too, also separately from the roster. (Implemented: `src/state/evaluatorPrefs.ts`, §E.)

**Confirmed (owner decisions for Step 4, 2026-11-20):**
- **Navigation:** Player Evaluator is initially a separate tab alongside the Lineup Planner tabs; the two tools stay distinct. *Revised 2026-11-21, below.*
- **Hierarchy:** roster evaluation is the central experience. League-wide rankings are secondary: accessible, but not the landing view or defining feature.
- **Mobile-first:** comfortable on a phone without an excessively wide table; player names stay visible; key stats easy to compare.
- **Stats loading:** only when Player Evaluator is opened, never on startup; a stats failure must not affect the rest of the app. Show the stats update time, with a proportionate stale warning.
- **Deliverable:** a working first prototype to test and react to, not a final design. Layout, hierarchy and interactions are expected to change after review.

**Confirmed (owner's prototype revisions, 2026-11-21):**
- **Two tool families in the navigation:** Playoff Planner (Schedules, Roster, Lineup, Trade Lab; unchanged) and Player Evaluator (Roster Evaluation, Player Rankings), visually distinguished with a restrained treatment, within one site.
- **Two peer destinations:** Roster Evaluation and Player Rankings. The shared benchmark control (the "Player Games Normalizer") sits above both and is not a third destination.
- **Roster Evaluation:** stat group defaults to All (order Scoring, Peripherals, Rates, All unchanged); comparison players are part of the roster table, first placed among rostered players by position, and sorted together with them; rostered rows have subtle light-blue shading, comparison rows stay white; no blue dots and no "compare" labels.
- **Player Rankings:** the same multi-column table as Roster Evaluation (same columns, groups, normalized/actual format, column sorting, shared benchmark), with rank positions, the existing min-GP and NHL-position filters, ascending/descending order, and the same row shading. Built on the existing ranking calculation.

**Confirmed (owner's second iteration, 2026-11-21):**
- **Navigation:** Playoff Planner and Player Evaluator are two equal-level primary product areas (compact inline, restrained; no uppercase label and divider, no cards or oversized segmented controls). The selected area's destinations, and only those, appear in a compact secondary row beneath. Replaces the "two tool families" arrangement above.
- **Player Rankings:** no Highest/Lowest control (the stat headers sort: click to sort, click again to reverse) and no summary sentence above the table.
- **Phone layout:** don't compress spacing or type to fit more rows; check after the removals and adjust only if still needed (checked: not needed).
- **Benchmark:** default league max; options League max, Roster max, comparison player, Custom (see above).
- **Benchmark explanation:** keep "Normalized to N GP" prominent; the source explanation lives behind the ⓘ; no player name in the default label.

### Player Evaluator prototype UI (spec Step 4; Implemented 2026-11-20, revised 2026-11-21, in the testing repo)

- **Navigation (2026-11-21, second iteration; labels renamed later that day):** the sticky tab bar has two rows at every width. Row 1 (`.area-row`): the product areas **"Games Optimizer"** and **"Player Normalizer"** as two equal compact buttons (`nav.areas`, `aria-current` on the selected one, which gets the accent-soft background), with League Settings at the right of the same row. On desktop and tablets each label is one line; at ≤600px each wraps onto two lines ("Games / Optimizer", "Player / Normalizer") so both fit beside League Settings at 360px. The sub-navigations' accessible names match ("Games Optimizer", "Player Normalizer"). **Owner decisions, 2026-11-21:** these labels replace "Playoff Planner" / "Normalizer" (earlier "Player Evaluator"); "Playoff Planner" stays the website name (brand, page title, branding unchanged); "Player Evaluator" remains the feature's working name in code and docs. Row 2 (`.tabbar-row`): the selected area's destinations only, in the existing tab style and with unchanged labels: Team Schedules (`#rankings`, "Schedules" on phones), Roster, Lineup, Trade Lab; or Roster Evaluation (`#evaluator`), Player Rankings (`#player-rankings`). Choosing an area opens the destination last used in it during this visit (else its first). Tab bar height: 78px desktop, 90px phones (two-line labels). No period bar or setup line on the evaluator destinations. GA counts each destination as a tab view.
- **One view, two destinations:** App renders a single `EvaluatorView` for both hashes, so the loaded stats and preferences carry over when switching; the benchmark bar is the same component above both.
- **Loading:** `EvaluatorView` calls `loadSkaterStats` (with the schedule's season) when the tab first opens, once per page load (a completed season's snapshot is fetched the first time that season is selected, also once per page load) (a failed request can be retried with "Try again"). The rest of the app never waits for or depends on it. Header shows "NHL stats updated <date>", or a small warning badge "Stats from <date>, may be outdated" after `STALE_AFTER_MS` (3 days, as for the schedule).
- **Benchmark bar:** "Normalized to N GP" and an ⓘ whose first line says how the benchmark was set ("League max: the highest GP among all NHL skaters this season (N).", "Roster max: the highest GP among your rostered skaters with stats (N, name).", "Per game: each counting stat per game played (benchmark 1 GP).", "Comparison player: name's GP (N).", "Custom: N GP, chosen by you.") followed by the normalization method. No permanent source sentence. Visible notes only when needed: "Roster max unavailable, using league max" (fallback) or "Choose a benchmark to see normalized stats." (no benchmark, e.g. a comparison player without stats or an invalid custom value). Benchmark select: League max (default), Roster max, Per game (added 2026-11-21, owner request; label capitalized "Per game" 2026-11-22 to match the others), each comparison player with stats, Custom… (number 1–84; out-of-range input is flagged and not saved). Removing the comparison player used as the benchmark returns it to the default, League max.
- **Roster Evaluation table:** rostered skaters (light-blue row shading `--roster-row`, IR badge, position · team) and comparison players (white rows, ✕ to remove) in one table: GP, then the chosen stat group: Scoring (G A P PPP SHP), Peripherals (SOG HIT BLK PIM FOW), Rates (+/- S% FO% TOI) or All (default at every width; on phones the table scrolls sideways inside its panel with the name column pinned). Counting stats show the normalized value (two decimals, or three under Per Game, trailing zeros kept, e.g. 8.80 / 0.900; owner decision 2026-11-21, via `adjustedDecimals`/`formatAdjusted` in `evaluatorFormat.ts`, also in Player Rankings; display only, sorting and ranks use full values; the full value in the cell title) with the actual total beneath it; rates show as reported. Default order (`mergeComparisons`): roster order, each comparison player after the last rostered skater with the same NHL position, else the same forward/defense group, else at the end. Column headers sort all players with stats together (desc → asc → default order, `sortRows`). Players without stats are listed last, with a one-line reason (no NHL games yet; not linked to an NHL player; not found). Excluded goalies are named under the table. Empty roster: a pointer to the Roster tab.
- **Comparison players:** "Compare an NHL skater…" searches the stats snapshot by name (`searchSkaters`, excluding rostered and already-added skaters). Never added to the saved roster. **"Clear comparison players"** (owner request, 2026-11-21) sits beside the search box only while comparison players are shown; it removes them all (`clearComparisons` in `evaluatorPrefs.ts`, so only the preferences key changes, never the roster). If the benchmark was one of them it returns to League max, with a toast saying so; other benchmarks are kept.
- **Player Rankings:** "All NHL skaters" in the same table format and stat groups (default All), with a pinned rank (#) and name column. Order and ranks come from `rankPlayers` on the sorted column (default Points, highest first; ties shared; unavailable values unranked "—" at the end); each row's other columns come from `evaluateSubject` with the shared benchmark. The stat headers are the only sort control: clicking one ranks on it (highest first), clicking it again flips the order (↓/↑ in the header). Filters: position (All/C/LW/RW/D, NHL position) and Min GP (persisted; default 10; an out-of-range entry shows a small "Min GP 1–84" badge beside the field). No summary line. Your rostered players get the same light-blue shading. 50 rows at a time, "Show 50 more".
- **Sort basis dropdown (owner request, 2026-11-21):** a compact dropdown in both tables' panel headers, left of the stat groups, reads "Normalized Stats" (default) with a small chevron, preceded by a small muted "Sort by:" label (12px, `.sort-basis-label`, added 2026-11-21; label and dropdown stay together and wrap as one, e.g. onto their own line under "All NHL skaters" at 360px); its menu offers Normalized Stats and Regular Stats, the selected one checked and in the accent color. It only chooses which value a clicked stat column sorts by: Normalized Stats sorts by the normalized value (unchanged behavior), Regular Stats by the actual total (`sortRows` with the actual value in Roster Evaluation; `rankPlayers` `sortBy: 'actual'` in Player Rankings, so the # ranks follow it). For +/-, S%, FO% and TOI both are the same. Header click behavior, the ↓/↑ indicator and the active column are unchanged. **Cells never change:** normalized value bold on top, actual value small beneath, whatever the basis. The choice is shared by both destinations for the visit and not saved (a reload starts on Normalized Stats).
- **Team shown:** the directory's current team when the player is in it, else the snapshot's team list.
- **Verified 2026-11-20 (local preview of the testing build, Playwright):** stats not requested on Schedules/Roster/Lineup and requested once when the tab opens; the saved roster key byte-for-byte unchanged after adding/removing comparisons, changing benchmark, sorting and using rankings; comparisons, custom benchmark and min GP restored after reload; a 500 on `skater-stats.json` shows the error while Lineup and Team Schedules keep working; no page-level horizontal scroll at 390px or 360px; Lineup works after using the evaluator.

**Open (for review of the prototype):**
- Layout, labels and copy are prototype choices (stat groups, cell format, label text).
- Verified 2026-11-21 (local preview, Playwright): navigation families, both destinations sharing the benchmark, all 14 stat columns and the four groups in Player Rankings, comparison players merged and sorted with roster players, shading colors, roster storage unchanged, preferences restored after reload, tab bar without overflow from 360px to 1280px, and the four Playoff Planner pages pixel-identical below the tab bar to the previous build (1280/768/390/360px).
- With All as the default on phones, the roster table needs sideways scrolling within its panel (the name column stays pinned).
- The rankings stat selector was replaced by column-header sorting. Ranking on a stat outside the shown group is still possible (switching groups keeps the sort), but with the summary line removed the active sort is visible only while its column is shown.
- Verified 2026-11-21 (second iteration, local preview, Playwright): product areas and their destinations at every width, League max default (25 GP on the 2026-11-20 snapshot) and Roster max / comparison player / custom values checked against `stat ÷ GP × benchmark`, the benchmark identical on both destinations and after reloads, version-1 preferences migrated, no Highest/Lowest control or summary line, header sort toggling, no overflow at 360/390/768/1040/1280px, roster storage unchanged. Player Rankings on a 390px or 360px phone: first player row at 570px (was 746px), four rows fully visible (was one), so no spacing change was made.
- NHL position (e.g. Matthew Tkachuk listed as LW by the NHL) can differ from fantasy eligibility shown elsewhere in the app.
- Benchmark options include comparison players only (spec §3.5); rostered players can't be picked as the benchmark.
- Evaluator preferences don't sync between open tabs; the roster does.
- Ranking rows for skaters on several teams show the directory team, or the snapshot's unverified team order when the player isn't in the directory.

### Historical seasons (owner request 2026-11-22; Implemented in testing, live since 2026-11-22)

- **Seasons (Confirmed):** 2024–25 (`20242025`) and 2025–26 (`20252026`) regular seasons, in addition to the current 2026–27 data. Listed in `HISTORICAL_SEASONS` (`src/data/format.ts`, newest first, each with its games per team: 82).
- **Data (Implemented):** one static snapshot per season, `public/data/skater-stats-<season>.json`, the same `SkaterStatsFile` format as the current season, keyed by NHL player id. Fetched by `scripts/fetch-historical-stats.ts` with the current-season reports, join and validation (`fetchStatsReport`, `joinSkaterStats`, `validateSkaterStats`), plus `completeSeasonGames`: the season is rejected unless some skater played every game (82). A season is written only if it passes; nothing is written on any failure. Run on demand by `historical-stats.yml` (§F), never by the frequent current-season refresh, which is unchanged. `check-data.ts` and the app's loader validate the files the same way.
- **First fetch (2026-11-22, run 45049015579):** 2024–25: 920 skaters, most GP 85 (traded players can exceed 82), 102 on more than one team, 639 in the current player directory; 2025–26: 940 skaters, most GP 83, 81 multi-team, 693 in the directory. Spot check: 2024–25 Kucherov 121 P in 78 GP; 2025–26 McDavid 138 P in 82 GP.
- **Season selector (Implemented):** a "Season" select (2026–27, 2025–26, 2024–25) in the shared benchmark bar, right of the Benchmark select (on phones each label and select wrap together, labels aligned). It applies to both Roster Evaluation and Player Rankings; it is not in the Games Optimizer. 2026–27 keeps the existing benchmark options (League max, Roster max, Per game, comparison players, Custom). A completed season replaces them with **Full season** (default) and **Per game**:
  - Full season (`{ kind: 'full-season' }`, basis `full-season`): actual season totals; `evaluateSubject` keeps the reported values and `rankPlayers` ranks on them (`benchmarkGp: 'own'`). Cells show the total only, the bar reads "Full-season totals", the legend "Actual <season> regular-season totals", and the Normalized/Regular sort menu is hidden (one value to sort by).
  - Per game: the existing 1 GP normalization.
- **Past-season details (Implemented):** the header reads "NHL <season> regular season (final)" (no stale warning); teams are the player's team(s) that season; a rostered or comparison player with no games that season shows "No NHL games in <season>" (a comparison player keeps their name from the current snapshot). Comparison players are shared across seasons (NHL ids); one added while viewing a past season is searched from that season's skaters.
- **Saved (owner decision 2026-11-22; Implemented):** the selected season (`season`, null = the current season) and the completed-season benchmark (`historicalBasis`: `full-season` default, or `per-game`) are kept in the evaluator preferences (`evaluatorPrefs.ts`), separate from the current-season `benchmark`. Visitors who never chose start at 2026–27; saves from before this change, or a season no longer offered, load as 2026–27 and Full season.
- **Owner decisions 2026-11-22 (Confirmed):** the Season select stays beside Benchmark; comparison players stay shared across seasons; historical rankings keep the 10-game minimum for now.

### Saved-roster integration (spec Step 3; Implemented 2026-11-20)

- `evaluateSavedRoster(saved, players, statsFile, prefs)` in `src/data/evaluatorData.ts` takes the persisted app state's `roster` and `customPlayers` (the same entries the Roster tab edits; the saved roster, not a Trade Lab proposal), the bundled player directory and the stats snapshot. It resolves ids with the existing `buildPlayerLookup` (so `espn-`/`nhl-` aliases and custom players work as elsewhere), builds the stats index and calls `evaluatePlayers` with the evaluator preferences. It returns the evaluation, the stats index and roster NHL ids for rankings, the season and `fetchedAt`.
- It only reads: no roster copy, no new roster fields, no change to `AppState`, `STORAGE_KEY` or the loaders. Roster edits flow in because it reads whatever the saved state holds.
- `loadSkaterStats(base)` fetches and validates `skater-stats.json` separately from `loadDataset`, so a stats problem can't stop the Lineup Planner from loading. The Player Evaluator tab calls it when opened (Confirmed: not on startup).
- **Visual/UX:** compact roster-wide table, actual and adjusted values side by side, grouped stat categories, mobile-first layout. Exact presentation and navigation remain open for prototype/review. Existing desktop Lineup Planner appearance must not regress.
- **Seasonal priority:** deliver a useful V1 promptly while GP gaps are comparatively large. Avoid delaying core evaluation for optional features.
- **Screenshot roster recognition (Implemented in testing 2026-11-21, live since 2026-11-22; V1, see §B "Roster input"):** Tesseract.js in the browser was chosen over PaddleOCR (PP-OCRv4 via `@gutenye/ocr-browser`/onnxruntime-web). On realistic synthetic screenshots (ESPN-, Yahoo-, Fantrax-style desktop tables, a dark-mode phone app split over two screens, an abbreviated-name phone layout, a low-quality JPEG) Tesseract read each in about 1.1–1.9 s in desktop Chromium and found every visible player with no wrong player added. PaddleOCR took 7–11 s, often dropped the spaces between English words ("ConnorMcDavidEdmC"), and needed more than 35 MB of downloads. Measured: engine start about 0.3 s from cache, about 2 s for the first screenshot including start-up from a local server, about 6.3 s at 9 Mbit/s with no cache (uncompressed; about 4.4 MB gzipped on Pages), then about 1.1 s per screenshot; three at once about 3 s with two workers. Follow-up (testing, 2026-11-21, owner report): Danil Tarasov at the bottom of a real screenshot and initials such as "T. Stützle" were missed. The directory spells him "Daniil Tarasov". Tesseract read "G D. Tarasov DET" correctly in synthetic screenshots even with the row touching the bottom edge or above a tab bar, so the exact miss was not reproduced; the likely causes were fixed instead: an initial with a misread last name ("T. Stiitzle") had no suggestion and was dropped silently, a slot merged into the initial ("GD. Tarasov") was not recognized, and initials were never resolved automatically. Added the dataset-driven initial lookup, umlaut variants and the 32px OCR margin (§B "Import", §C). **Open:** whether the owner's original screenshot now imports Tarasov is unconfirmed; not tested on real mobile Safari or on real fantasy-site screenshots (the dev container can reach neither); phone CPU timing is unmeasured.
- **Open:** final labels/navigation; final visual layout and presentation (the Step 4 prototype is for review); the data and decision items listed above.
- All implementation and experiments begin in `jmaser54/fantasy-hockey-schedule-optimizer-testing` (default branch `main`). Do not change the live repository until the owner reviews and approves the tested result.
