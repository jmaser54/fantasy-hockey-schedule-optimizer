# CLAUDE.md — Playoff Planner

Vite + React + TypeScript single-page app, deployed to GitHub Pages. The canonical detailed reference is **`docs/PROJECT_SOURCE_OF_TRUTH.md`**: product requirements, architecture, business rules, persistence, testing, regression lessons and open questions.

## Before changing anything
1. Read `docs/PROJECT_SOURCE_OF_TRUTH.md` before any change that could affect documented product behavior, business rules, architecture, data flow, persistence or other regression-sensitive areas.
2. Inspect the relevant current code and tests; don't rely only on the doc, assumptions or conversation history. The doc can go stale. If it disagrees with the code, investigate and say so; don't silently pick one.
3. Check `git status` first and preserve any existing changes. Don't commit unrelated work.

## Scope
- Do only what the user asked. These instructions don't authorize broader work.
- Make the smallest maintainable change. No unrelated refactoring, redesign, cleanup or feature work.
- Preserve confirmed product requirements and existing functionality unless the user explicitly authorizes a change. If a request conflicts with a documented requirement, flag the conflict rather than changing the requirement or unrelated functionality.
- "Text-only" or "UI-only" changes must not alter handlers, conditions, data or calculations. Confirm this in the diff.
- If a change needs a functional or data-model change the user didn't ask for, stop and ask.

## Verify and report honestly
- Run what's relevant: `npm run typecheck`, `npm test`, `npm run build` and the data check (`node --experimental-strip-types --no-warnings scripts/check-data.ts`). For UI work, also check in a browser (`npm run build && npx vite preview`) at desktop and phone widths (390px and 360px).
- Fix any regression you introduce. Report what you verified and what you couldn't. Never claim live-site or email delivery checks you didn't perform.
- This dev container can't reach the NHL/ESPN APIs, `github.io` or `formsubmit.co`. Live checks happen only in the GitHub Actions smoke test.
- Copy in the Lineup heading, the Roster tab and the paste label is asserted by `scripts/smoke-test.mjs`. Update it if you change that copy.

## Git and deployment
- Work on the default branch `claude/practical-faraday-ti8p02` unless told otherwise.
- **Every push to the default branch redeploys the live site** (`.github/workflows/deploy-pages.yml`), and CI runs on every push.
- A bot commits daily data refreshes to this branch, so `git pull --rebase` before pushing.
- Commit only the files the task touched.

## Keep the source of truth current
- Update `docs/PROJECT_SOURCE_OF_TRUTH.md` in the same change whenever work materially changes documented requirements, architecture, business rules, persistence, workflows or regression lessons. Mark items Confirmed, Implemented or Open as that document does.
- Keep documentation out of the deployed website. Never add docs to `public/`, import them into the app, or link them from the site's UI or navigation. The repository is public, so don't put secrets in docs.
