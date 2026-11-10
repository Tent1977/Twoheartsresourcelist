// Checks that every Reno Utopia maze is well-formed and can be finished.
const { ZONES, SOLID, ENEMY_CHARS } = require('../reno-utopia/zones');

function parse(zone) {
  const grid = zone.map.map((row) => row.split(''));
  let start = null;
  const exits = [];
  const enemies = [];
  grid.forEach((row, y) =>
    row.forEach((ch, x) => {
      if (ch === 'S') start = { x, y };
      if (ch === 'E') exits.push({ x, y });
      if (ENEMY_CHARS.includes(ch)) enemies.push({ x, y, ch });
    })
  );
  return { grid, start, exits, enemies };
}

function reachable(grid, start) {
  const h = grid.length;
  const w = grid[0].length;
  const seen = new Set([`${start.x},${start.y}`]);
  const queue = [start];
  while (queue.length) {
    const { x, y } = queue.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const key = `${nx},${ny}`;
      if (seen.has(key)) continue;
      const ch = grid[ny][nx];
      if (SOLID.includes(ch)) continue;
      seen.add(key);
      if (ch !== 'E') queue.push({ x: nx, y: ny }); // exits are endpoints
    }
  }
  return seen;
}

describe('Reno Utopia zones', () => {
  test('there are 7 zones ending in the boss fight', () => {
    expect(ZONES).toHaveLength(7);
    expect(ZONES[0].key).toBe('camp');
    expect(ZONES[6].boss).toBe(true);
  });

  test.each(ZONES.map((z) => [z.name, z]))('%s is a 30x20 grid', (_name, zone) => {
    expect(zone.map).toHaveLength(20);
    zone.map.forEach((row) => expect(row).toHaveLength(30));
  });

  test.each(ZONES.map((z) => [z.name, z]))(
    '%s has one start, an exit, and everything is reachable',
    (_name, zone) => {
      const { grid, start, exits, enemies } = parse(zone);
      expect(start).not.toBeNull();
      expect(zone.map.join('').split('S')).toHaveLength(2);
      expect(exits.length).toBeGreaterThan(0);
      expect(enemies.length).toBeGreaterThan(0);
      const seen = reachable(grid, start);
      expect(exits.some((e) => seen.has(`${e.x},${e.y}`))).toBe(true);
      enemies.forEach((e) => expect(seen.has(`${e.x},${e.y}`)).toBe(true));
    }
  );

  test('only the last zone has the Big Kahuna', () => {
    ZONES.forEach((z, i) => {
      const hasBoss = z.map.join('').includes('K');
      expect(hasBoss).toBe(i === ZONES.length - 1);
    });
  });

  test('the ranks show up in order as you go deeper', () => {
    const rank = 'fmcsaA';
    const firstZoneOf = {};
    ZONES.forEach((z, i) => {
      for (const ch of z.map.join('')) {
        if (rank.includes(ch) && firstZoneOf[ch] === undefined) firstZoneOf[ch] = i;
      }
    });
    const order = rank.split('').map((ch) => firstZoneOf[ch]);
    const sorted = [...order].sort((a, b) => a - b);
    expect(order).toEqual(sorted);
  });
});
