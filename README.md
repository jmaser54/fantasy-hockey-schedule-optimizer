# Playoff Schedule Optimizer

**Live app:** https://jmaser54.github.io/fantasy-hockey-schedule-optimizer/

A fantasy hockey tool that finds the lineups that maximize **usable player-games** across your league's fantasy playoff rounds. It uses real NHL schedules, your league's daily lineup slots, and position eligibility.

- **Team schedules:** NHL team games per round and across the full playoffs.
- **Roster:** paste or search your roster, with ambiguous names resolved by you, never guessed.
- **Lineup:** the optimal daily lineup per date (via bipartite matching), what each player actually contributes, and why a game can't be used. You can override it and reset.
- **Trade lab:** test drops and adds against your current roster, with a before/after comparison.

## Develop

```bash
npm install
npm run dev        # app at http://localhost:5173
npm test           # unit tests
npm run typecheck
npm run build
```

## Data

`public/data/schedule.json` and `public/data/players.json` are snapshots built by `npm run data:refresh` (NHL web API, plus ESPN fantasy eligibility). The GitHub Actions workflow `refresh-data.yml` runs the refresh daily, validates it, and commits it. See [IMPLEMENTATION.md](IMPLEMENTATION.md) for sources, validation, assumptions, and status.

## Deploy

`.github/workflows/deploy-pages.yml` builds the app and publishes it to GitHub Pages at
`https://<owner>.github.io/<repo>/`, then smoke-tests the live site in headless Chromium.
It runs on every push to the default branch, on demand (Actions → Deploy to GitHub Pages → Run workflow),
and automatically after the daily data refresh commits a new snapshot.

One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions.**
(GitHub Pages for a private repository requires a paid GitHub plan; on GitHub Free the repository must be public.
The deployed site itself is public either way. It contains only the app and public NHL data; rosters stay in each visitor's browser.)
Until Pages is enabled, the workflow builds and validates the app but skips deployment with a warning.
