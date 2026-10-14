import { describe, expect, it } from 'vitest';
import { buildPlayerIndex, matchName, parseRosterText, searchPlayers } from './rosterImport.ts';
import type { Player } from './types.ts';

const P = (id: string, name: string, team: string, positions: Player['positions'] = ['C']): Player => ({
  id,
  name,
  team,
  positions,
  eligibilitySource: 'nhl',
});
const players = [
  P('1', 'Connor McDavid', 'EDM'),
  P('2', 'Elias Pettersson', 'VAN'),
  P('3', 'Elias Pettersson', 'VAN', ['D']),
  P('4', 'Tim Stützle', 'OTT'),
  P('5', 'Mitch Marner', 'VGK', ['RW']),
  P('6', 'Jack Hughes', 'NJD'),
  P('7', 'Quinn Hughes', 'VAN', ['D']),
];
const index = buildPlayerIndex(players);
const teams = new Set(['EDM', 'VAN', 'OTT', 'VGK', 'NJD']);

describe('parseRosterText', () => {
  it('splits lines and strips slot labels, teams, positions and tags', () => {
    const parsed = parseRosterText('C  Connor McDavid  EDM  C\nRW Mitch Marner VGK RW DTD\n\nBench\nTim Stützle (OTT - C)', teams);
    expect(parsed.map((p) => [p.name, p.teamHint])).toEqual([
      ['Connor McDavid', 'EDM'],
      ['Mitch Marner', 'VGK'],
      ['Tim Stützle', undefined],
    ]);
  });

  it('handles comma lists and Last, First', () => {
    expect(parseRosterText('Connor McDavid, Mitch Marner, Jack Hughes', teams).map((p) => p.name)).toEqual([
      'Connor McDavid',
      'Mitch Marner',
      'Jack Hughes',
    ]);
    expect(parseRosterText('McDavid, Connor', teams)[0]!.name).toBe('Connor McDavid');
    expect(parseRosterText('1. Connor McDavid\n2) Jack Hughes', teams).map((p) => p.name)).toEqual(['Connor McDavid', 'Jack Hughes']);
  });
});

describe('matchName', () => {
  it('accepts exact matches regardless of accents and case', () => {
    expect(matchName('tim stutzle', index)).toEqual({ status: 'matched', player: players[3] });
  });

  it('reports same-name players as ambiguous instead of guessing', () => {
    const r = matchName('Elias Pettersson', index);
    expect(r.status).toBe('ambiguous');
    expect(r.status === 'ambiguous' && r.candidates.map((c) => c.id)).toEqual(['2', '3']);
  });

  it('never auto-accepts typos or partial names', () => {
    expect(matchName('Conor McDavid', index)).toMatchObject({ status: 'suggested', candidates: [players[0]] });
    expect(matchName('Hughes', index)).toMatchObject({ status: 'suggested' });
    expect(matchName('C. McDavid', index)).toMatchObject({ status: 'suggested', candidates: [players[0]] });
    expect(matchName('Wayne Gretzky', index)).toEqual({ status: 'unmatched' });
  });

  it('uses a team hint to rank suggestions but not to override names', () => {
    const r = matchName('Hughes', index, 'VAN');
    expect(r.status === 'suggested' && r.candidates[0]!.id).toBe('7');
  });
});

describe('searchPlayers', () => {
  it('prefix-matches name tokens', () => {
    expect(searchPlayers('hug', index).map((p) => p.id)).toEqual(['6', '7']);
    expect(searchPlayers('q hu', index).map((p) => p.id)).toEqual(['7']);
    expect(searchPlayers('x', index)).toEqual([]);
  });
});
