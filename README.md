# Playoff Schedule Optimizer

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
