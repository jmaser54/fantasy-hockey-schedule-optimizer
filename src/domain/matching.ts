/**
 * Maximum-cardinality bipartite matching (Kuhn's augmenting-path algorithm).
 *
 * Left vertices are players, right vertices are individual slot seats (a slot
 * with count 2 contributes two seats). Each player is matched to at most one
 * seat and each seat holds at most one player, so the matching size is the
 * maximum number of players that can be placed in the lineup simultaneously.
 *
 * Kuhn's algorithm is O(V·E); daily lineups are tiny (≈25 × 20), so this is
 * far below a millisecond per day. Optimality follows from Berge's lemma: the
 * search stops only when no augmenting path exists.
 */
export function maxBipartiteMatching(
  leftCount: number,
  rightCount: number,
  adjacency: readonly (readonly number[])[],
): { size: number; leftToRight: number[]; rightToLeft: number[] } {
  const leftToRight = new Array<number>(leftCount).fill(-1);
  const rightToLeft = new Array<number>(rightCount).fill(-1);

  const tryAugment = (u: number, visited: boolean[]): boolean => {
    for (const v of adjacency[u] ?? []) {
      if (visited[v]) continue;
      visited[v] = true;
      const owner = rightToLeft[v]!;
      if (owner === -1 || tryAugment(owner, visited)) {
        leftToRight[u] = v;
        rightToLeft[v] = u;
        return true;
      }
    }
    return false;
  };

  let size = 0;
  for (let u = 0; u < leftCount; u++) {
    if (tryAugment(u, new Array<boolean>(rightCount).fill(false))) size++;
  }
  return { size, leftToRight, rightToLeft };
}
