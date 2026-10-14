import { eachDate, inRange } from './dates.ts';
import type { Game, ISODate, Player, TeamId, TeamStint } from './types.ts';

/**
 * Indexed, de-duplicated schedule. Each game id appears once and a team plays
 * at most once per date (validated at load time; see data/validate.ts).
 */
export class ScheduleIndex {
  readonly games: readonly Game[];
  private byDate = new Map<ISODate, Game[]>();
  private byTeamDate = new Map<string, Game>();

  constructor(games: readonly Game[]) {
    const seen = new Set<string>();
    const unique: Game[] = [];
    for (const g of games) {
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      unique.push(g);
      const list = this.byDate.get(g.date) ?? [];
      list.push(g);
      this.byDate.set(g.date, list);
      this.byTeamDate.set(`${g.home}|${g.date}`, g);
      this.byTeamDate.set(`${g.away}|${g.date}`, g);
    }
    unique.sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date < b.date ? -1 : 1));
    this.games = unique;
  }

  gamesOn(date: ISODate): readonly Game[] {
    return this.byDate.get(date) ?? [];
  }

  teamGameOn(team: TeamId, date: ISODate): Game | undefined {
    return this.byTeamDate.get(`${team}|${date}`);
  }

  teamGames(team: TeamId, start: ISODate, end: ISODate): Game[] {
    return this.games.filter((g) => (g.home === team || g.away === team) && inRange(g.date, start, end));
  }

  /** Number of NHL games on each date in the range (league-wide). */
  gamesPerDate(start: ISODate, end: ISODate): Map<ISODate, number> {
    const m = new Map<ISODate, number>();
    for (const d of eachDate(start, end)) m.set(d, this.gamesOn(d).length);
    return m;
  }

  get firstDate(): ISODate | undefined {
    return this.games[0]?.date;
  }

  get lastDate(): ISODate | undefined {
    return this.games[this.games.length - 1]?.date;
  }
}

/**
 * The team a player belongs to on a given date. Stints are inclusive; when
 * none covers the date we fall back to the player's current team, which is
 * the best available information for future dates.
 */
export function teamOnDate(player: Pick<Player, 'team' | 'stints'>, date: ISODate): TeamId {
  const stints: TeamStint[] | undefined = player.stints;
  if (stints && stints.length > 0) {
    for (const s of stints) {
      if ((s.from === undefined || date >= s.from) && (s.to === undefined || date <= s.to)) return s.team;
    }
  }
  return player.team;
}

/**
 * The game a player can appear in on a date, or undefined. Because each date
 * resolves to exactly one team, a traded player is never credited with games
 * from both teams on the same date, and never double-counted across a trade.
 */
export function playerGameOn(
  schedule: ScheduleIndex,
  player: Pick<Player, 'team' | 'stints'>,
  date: ISODate,
): Game | undefined {
  return schedule.teamGameOn(teamOnDate(player, date), date);
}

export function playerGames(
  schedule: ScheduleIndex,
  player: Pick<Player, 'team' | 'stints'>,
  start: ISODate,
  end: ISODate,
): Game[] {
  const out: Game[] = [];
  for (const d of eachDate(start, end)) {
    const g = playerGameOn(schedule, player, d);
    if (g) out.push(g);
  }
  return out;
}

export function opponent(game: Game, team: TeamId): { team: TeamId; home: boolean } {
  return game.home === team ? { team: game.away, home: true } : { team: game.home, home: false };
}
