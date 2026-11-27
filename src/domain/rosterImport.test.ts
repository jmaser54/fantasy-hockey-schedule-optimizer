import { describe, expect, it } from 'vitest';
import { buildPlayerIndex, extractRosterNames, matchName, parseRosterText, searchPlayers } from './rosterImport.ts';
import { normalizeName } from './names.ts';
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

describe('extractRosterNames (whole roster pages, pasted or from screenshots)', () => {
  const ids = (ps: Player[]) => ps.map((p) => p.id);
  // An ESPN-style page copied whole: menus, headings, slot labels, opponents, times, stats.
  const espnPage = [
    'ESPN Fantasy\tHockey\tMy Team\tLeague\tPlayers',
    'The Puck Stops Here',
    '7-3-1 · 2nd in Division · Waiver Position 6',
    'SLOT\tPLAYER\tACTION\tOPP\tSTATUS\tG\tA\tSOG\t+/-\tFPTS',
    'C\tConnor McDavid Edm C\tMOVE\t@VAN\t7:00 PM\t0\t31\t5\t-9\t79',
    'RW\tMitch Marner Vgk RW DTD\tMOVE\t@OTT\t7:00 PM\t3\t4\t38\t1\t52',
    'D\tQuinn Hughes Van D\tMOVE\t@NJD\t7:00 PM\t28\t19\t33\t6\t47',
    'BN\tTim Stützle Ott C,LW\tMOVE\t@EDM\t7:00 PM\t12\t13\t47\t4\t31',
    'Totals · Scoring Period 47 · Last updated 2 min ago',
  ].join('\n');

  it('finds exact names inside full rows and ignores everything else', () => {
    const r = extractRosterNames(espnPage, index, teams);
    expect(ids(r.matched)).toEqual(['1', '5', '7', '4']);
    expect(r.review).toEqual([]);
    expect(r.unrecognized).toEqual([]);
    expect(r.ignored).toBe(5);
  });

  it('never takes an opponent code ("@VAN", "vs Ott") as the player’s team', () => {
    const r = extractRosterNames('Elias Pettersson Van C @EDM\nConnor McDavid vs Ott', index, teams);
    expect(r.review[0]!.teamHint).toBe('VAN');
    expect(ids(r.matched)).toEqual(['1']);
  });

  it('accepts a unique exact name whatever the nearby team says', () => {
    expect(ids(extractRosterNames('Mitch Marner TOR', index, teams).matched)).toEqual(['5']);
  });

  it('de-duplicates players found more than once (overlapping screenshots)', () => {
    const r = extractRosterNames('Connor McDavid EDM\nJack Hughes\nConnor McDavid EDM · C · Final\nMcDavid, Connor (EDM)', index, teams);
    expect(ids(r.matched)).toEqual(['1', '6']);
  });

  it('reads "Last, First", comma lists and one-name-per-line lists', () => {
    expect(ids(extractRosterNames('McDavid, Connor (EDM)\nHughes, Jack (NJD)', index, teams).matched)).toEqual(['1', '6']);
    expect(ids(extractRosterNames('Connor McDavid, Mitch Marner, Jack Hughes', index, teams).matched)).toEqual(['1', '5', '6']);
    expect(ids(extractRosterNames('Connor McDavid\nTim Stutzle\nJack Hughes', index, teams).matched)).toEqual(['1', '4', '6']);
  });

  it('sends same-name players to review instead of guessing', () => {
    const r = extractRosterNames('Elias Pettersson VAN', index, teams);
    expect(r.matched).toEqual([]);
    expect(r.review).toHaveLength(1);
    expect(r.review[0]!.result.status).toBe('ambiguous');
    expect(r.review[0]!.preselect).toBeUndefined();
  });

  it('sends near matches (typos, OCR errors in other letters) to review, pre-selecting a single candidate', () => {
    const r = extractRosterNames('Conor McDavid\nMitch Marmer VGK', index, teams);
    expect(r.matched).toEqual([]);
    expect(r.review.map((x) => [x.name, x.result.status, x.preselect])).toEqual([
      ['Conor McDavid', 'suggested', '1'],
      ['Mitch Marmer', 'suggested', '5'],
    ]);
  });

  it('resolves a unique first initial + last name automatically, using the directory', () => {
    const r = extractRosterNames('C   C. McDavid  EDM - C  0 31\nD Q. Hughes VAN - D\nUTIL J. Hughes NJD - C\nM.Marner VGK-RW\nJ Hughes NJD', index, teams);
    expect(ids(r.matched)).toEqual(['1', '7', '6', '5']);
    expect(r.review).toEqual([]);
  });

  it('asks when several players share the first initial + last name, never guessing', () => {
    const r = extractRosterNames('IR E. Pettersson VAN - C', index, teams);
    expect(r.matched).toEqual([]);
    expect(r.review.map((x) => [x.name, x.result.status, x.result.status === 'ambiguous' && x.result.candidates.map((c) => c.id), x.preselect])).toEqual([
      ['E. Pettersson', 'ambiguous', ['2', '3'], undefined],
    ]);
    // A team that singles one out pre-selects it, but the user still confirms.
    const raty = buildPlayerIndex([P('a', 'Aatu Raty', 'TOR'), P('b', 'Aku Raty', 'EDM')]);
    const t = extractRosterNames('A. Raty TOR - C', raty, new Set(['TOR', 'EDM']));
    expect(t.matched).toEqual([]);
    expect([t.review[0]!.result.status, t.review[0]!.preselect]).toEqual(['ambiguous', 'a']);
  });

  it('reads an initial run into the slot label ("GD. Tarasov") and keeps slot letters without a dot cautious', () => {
    const goalies = buildPlayerIndex([...players, P('9', 'Daniil Tarasov', 'DET', ['G'])]);
    expect(ids(extractRosterNames('GD. Tarasov DET - G 27', goalies, teams).matched)).toEqual(['9']);
    expect(ids(extractRosterNames('G D. Tarasov DET -G 27', goalies, teams).matched)).toEqual(['9']);
    // Without a dot, an initial resolves only next to a team code ("J Hughes NJD"); alone it is suggested.
    const bare = extractRosterNames('J Hughes said', index, teams);
    expect(bare.matched).toEqual([]);
    expect([bare.review[0]!.result.status, bare.review[0]!.preselect]).toEqual(['suggested', '6']);
    // "C McDavid": C is also a slot label, so without a dot it is only suggested.
    const c = extractRosterNames('C McDavid EDM', index, teams);
    expect(c.matched).toEqual([]);
    expect(c.review[0]!.preselect).toBe('1');
  });

  it('accepts umlaut names read with the usual variants (Stützle as Stiitzle, Stitzle, Stutzle, Stuetzle)', () => {
    for (const line of ['D  Tim Stiitzle  Ott C', 'b Tim Stitzle on cow MOVE @NYR', 'Tim Stuetzle', 'D T. Stutzle o17-c,Lw 12 13', 'T. Stiitzle OTT - C', 'Stiitzle, Tim (OTT)', 'Tim Stützle']) {
      expect([line, ids(extractRosterNames(line, index, teams).matched)]).toEqual([line, ['4']]);
    }
    // Only names that have an umlaut get this tolerance.
    expect(extractRosterNames('Mitch Mirner', index, teams).matched).toEqual([]);
  });

  it('screenshot noise around an initial (2026-11-27): "§" for S, junk glued to it, a comma for its dot', () => {
    const more = buildPlayerIndex([...players, P('10', 'Shayne Gostisbehere', 'CAR', ['D'])]);
    const t = new Set([...teams, 'CAR']);
    // The OCR lines seen for an ESPN roster screenshot ("S. Gostisbehere", "T. Stutzle").
    for (const [line, id] of [
      ['D 2 §. Gostisbehere DTD', '10'],
      ['co §. Gostisbehere', '10'],
      ['$. Gostisbehere Car D', '10'],
      ['D 2 $: Gostisbehere DTD', '10'],
      ['Co S-Gostisbehere', '10'],
      ['D Co S-Gostisbehere Car D', '10'],
      ['T-Stutzle', '4'],
      ['C T-Stutzle Ott C, LW', '4'],
      ['T-Stiitzle', '4'],
      ['coS. Gostisbehere', '10'],
      ['co S. Gostisbehere', '10'],
      ['S, Gostisbehere CAR', '10'],
      ['c¢ T. Stutzle', '4'],
      ['cT. Stutzle Ott', '4'],
      ['T, Stutzle Ott C, LW', '4'],
    ] as const) {
      expect([line, ids(extractRosterNames(line, more, t).matched)]).toEqual([line, [id]]);
    }
    // Not looser than before: the rest must still name exactly one player, and "$" is S only before ". Name".
    const two = extractRosterNames('coE. Pettersson VAN', more, t);
    expect([two.matched, two.review[0]!.result.status]).toEqual([[], 'ambiguous']);
    expect(extractRosterNames('Price $. 5\nCost $.99 Gostisbehere', more, t).matched).toEqual([]);
    // Real hyphenated names are untouched by the hyphen-initial rule.
    const hy = buildPlayerIndex([...players, P('13', 'Oliver Ekman-Larsson', 'TOR', ['D']), P('14', 'Jean-Gabriel Pageau', 'NYI')]);
    expect(ids(extractRosterNames('Oliver Ekman-Larsson TOR\nJean-Gabriel Pageau', hy, new Set([...teams, 'TOR', 'NYI'])).matched).sort()).toEqual(['13', '14']);
  });

  it("the owner's ESPN screenshot as the app's OCR read it (2026-11-27): Stützle, Gostisbehere and a stat heading together", () => {
    const more = buildPlayerIndex([...players, P('10', 'Shayne Gostisbehere', 'CAR', ['D']), P('11', 'Leon Draisaitl', 'EDM')]);
    // Real OCR lines: the C slot pill ran into "T." and its dot was lost ("BT"); the dot after S read as a hyphen.
    const ocr = ['EDIT SKATERS OPP G', 'L. Draisaitl I }', '\u00ae.c', 'BT Stutzle |', '@ C, LW', '(Co) &  S-Gostisbehere | i', 'w @D', 'Power Play Shorthanded'].join('\n');
    const r = extractRosterNames(ocr, more, teams);
    // "BT": not a team code or slot label, T + Stutzle fits one player and nobody else is called Stützle → added.
    expect(ids(r.matched).sort()).toEqual(['10', '11', '4']);
    expect(r.review).toEqual([]);
    expect(r.unrecognized).toEqual([]);
    // A team code is not a slot + initial ("OTT Stutzle" is not "T. Stutzle"), and nothing is added from it.
    expect(extractRosterNames('OTT Stutzle', more, teams).review.map((x) => x.name)).not.toContain('T. Stutzle');
    expect(extractRosterNames('OTT Stutzle', more, teams).matched).toEqual([]);
  });

  it('adds a slot run into a dotless initial only when the surname is unique; labels and shared surnames stay cautious', () => {
    const idx = buildPlayerIndex([...players, P('16', 'Will Smithers', 'BUF'), P('17', 'T.J. Hughes', 'MIN')]);
    const t = new Set([...teams, 'BUF', 'MIN']);
    expect(ids(extractRosterNames('CW Smithers', idx, t).matched)).toEqual(['16']);
    // A slot label itself ("LW", "RW", "BN"): its last letter is the label's, not an initial.
    for (const line of ['LW Smithers', 'RW Smithers']) expect([line, extractRosterNames(line, idx, t).matched]).toEqual([line, []]);
    // A shared surname (Jack and Quinn Hughes, T.J. Hughes): a stray letter could name the wrong one, so confirm.
    const h = extractRosterNames('BJ Hughes', idx, t);
    expect(h.matched).toEqual([]);
    expect([h.review[0]!.result.status, h.review[0]!.preselect]).toEqual(['suggested', '6']);
    // A two-initial first name read whole is an exact name, not slot + initial: "TJ Hughes" is T.J., not Jack.
    expect(ids(extractRosterNames('TJ Hughes', idx, t).matched)).toEqual(['17']);
  });

  it('ignores ESPN stat column headings but still lists unknown names and matches Owen Power (2026-11-27)', () => {
    const pw = buildPlayerIndex([...players, P('15', 'Owen Power', 'BUF', ['D'])]);
    const r = extractRosterNames('Power Play Shorthanded\nOwen Power BUF\nO. Power BUF D\nZed Unknownson', pw, new Set([...teams, 'BUF']));
    expect(ids(r.matched)).toEqual(['15']);
    expect(r.unrecognized).toEqual(['Zed Unknownson']);
  });

  it('matches names regardless of accents, including letters Unicode does not decompose (ø, æ, ł, ß)', () => {
    expect(['Tim Stützle', 'Frédérick Gaudreau', 'Mads Søgaard', 'Æsa Lærke', 'Łukasz Kępa', 'Weiß'].map(normalizeName)).toEqual([
      'tim stutzle',
      'frederick gaudreau',
      'mads sogaard',
      'aesa laerke',
      'lukasz kepa',
      'weiss',
    ]);
    const acc = buildPlayerIndex([...players, P('11', 'Mads Søgaard', 'OTT', ['G']), P('12', 'Frédérick Gaudreau', 'VAN')]);
    for (const [line, id] of [
      ['Mads Sogaard', '11'],
      ['M. Sogaard OTT', '11'],
      ['Sogaard, Mads', '11'],
      ['Frederick Gaudreau', '12'],
      ['F. Gaudreau VAN', '12'],
      ['Tim Stutzle', '4'],
      ['T. Stutzle', '4'],
    ] as const) {
      expect([line, ids(extractRosterNames(line, acc, teams).matched)]).toEqual([line, [id]]);
    }
    expect(matchName('Mads Søgaard', acc)).toEqual({ status: 'matched', player: acc.byName.get('mads sogaard')![0] });
  });

  it('lists a player once for review however differently the screenshots show the name', () => {
    const r = extractRosterNames('Elias Pettersson VAN\nPettersson, Elias (VAN)\nE. Pettersson VAN - C\nMitch Marmer VGK\nMitch Marmer', index, teams);
    expect(r.review.map((x) => x.name)).toEqual(['Elias Pettersson', 'Mitch Marmer']);
  });

  it('drops a near match whose player was found exactly elsewhere', () => {
    const r = extractRosterNames('Tim Stiitzle Ott C\nTim Stützle OTT', index, teams);
    expect(ids(r.matched)).toEqual(['4']);
    expect(r.review).toEqual([]);
  });

  it('still offers a lone surname typed on its own line', () => {
    expect(extractRosterNames('Hughes', index, teams).review[0]!.result.status).toBe('suggested');
  });

  it('lists name-like text that matches nobody as unrecognized, never imported', () => {
    const r = extractRosterNames('Wayne Gretzky EDM\nEdit Lineup\nPoints League\nMOVE @TOR 7:00 PM', index, teams);
    expect(r.matched).toEqual([]);
    expect(r.review).toEqual([]);
    expect(r.unrecognized).toEqual(['Wayne Gretzky']);
    expect(r.ignored).toBe(4);
  });
});
