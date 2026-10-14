import { eachDate } from './dates.ts';
import type { ScheduleIndex } from './schedule.ts';
import type { ISODate, Period, TeamId } from './types.ts';

/**
 * A "light night" is a date on which at most half of the league's teams play
 * (8 or fewer games in a 32-team league). Games
 * on those dates compete with fewer of a manager's other players for lineup
 * slots, so they convert to usable games more often.
 */
export function isLightNight(gamesThatDay: number, teamCount: number): boolean {
  return gamesThatDay > 0 && gamesThatDay * 2 <= teamCount / 2;
}

export interface TeamRanking {
  team: TeamId;
  /** Games per period, in period order. */
  byPeriod: number[];
  total: number;
  lightNight: number;
}

export function rankTeams(
  schedule: ScheduleIndex,
  teams: readonly TeamId[],
  periods: readonly Pick<Period, 'start' | 'end'>[],
): TeamRanking[] {
  const counts = new Map<TeamId, TeamRanking>(
    teams.map((t) => [t, { team: t, byPeriod: periods.map(() => 0), total: 0, lightNight: 0 }]),
  );
  // Dates covered by more than one period still count once in the total.
  const totalDates = new Set<ISODate>();
  periods.forEach((p, pi) => {
    for (const d of eachDate(p.start, p.end)) {
      const games = schedule.gamesOn(d);
      const first = !totalDates.has(d);
      totalDates.add(d);
      const light = isLightNight(games.length, teams.length);
      for (const g of games) {
        for (const t of [g.home, g.away]) {
          const r = counts.get(t);
          if (!r) continue;
          r.byPeriod[pi]!++;
          if (first) {
            r.total++;
            if (light) r.lightNight++;
          }
        }
      }
    }
  });
  return [...counts.values()];
}
