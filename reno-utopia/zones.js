/*
 * Reno Utopia — zone (level) data.
 *
 * Each map is 30 x 20 tiles. Legend:
 *   .  floor              ~  filth puddle (walkable, slows you down)
 *   S  player start       E  exit door (locked until the zone is cleared)
 *   #  wall               x  chain-link fence
 *   P  Safe Camp pod      B  bunk bed          C  cubby / locker
 *   W  washer / dryer     T  table             L  serving line
 *   D  desk + computer    F  file cabinet      H  shower stall
 *   o  toilet             R  reception desk
 * Enemy spawns (lowest to highest rank):
 *   f  Facility Assistant (mop / broom)
 *   m  Maintenance        (hurls wrenches)
 *   c  Caseworker         (hurls notebooks)
 *   s  Supervisor         (finger beebees, some turn to fire)
 *   a  Assistant Administrator (ruler)
 *   A  Administrator      (staplers + pens)
 *   K  THE BIG KAHUNA     (boss)
 *
 * The layout follows the public descriptions of the campus: Safe Camp's
 * pod rows, the restroom/shower and laundry building, the big "Sprung"
 * tent dorm with bunks and cubbies, the dining hall, admin offices, and
 * the Welcome Center at the front entrance.
 */
(function (root) {
  const SOLID = '#xPBCWTLDFHRo';
  const ENEMY_CHARS = 'fmcsaAK';

  const ZONES = [
    {
      key: 'camp',
      name: 'SAFE CAMP',
      sub: 'Rows of 8x8 pods behind the fence. Facility Assistants on patrol.',
      map: [
        'xxxxxxxxxxxxxxxxxxxxxxxxxxxEEx',
        'x............................x',
        'x.PP..PP..PP..PP..PP..PP..f..x',
        'x.PP..PP..PP..PP..PP..PP.....x',
        'x............................x',
        'x..f.........xxxxxxx.........x',
        'x.PP..PP..PP.x.....x..PP..PP.x',
        'x.PP..PP..PP.x..f..x..PP..PP.x',
        'x............x.....x.........x',
        'x.....f......xxx.xxx....f....x',
        'x.PP..PP..PP..........PP..PP.x',
        'x.PP..PP..PP..PP..PP..PP..PP.x',
        'x.............PP..PP.........x',
        'x..xxxxxxxx..........xxxxxx..x',
        'x..x......x...f......x...f...x',
        'x..x.PP...x..........x.PP....x',
        'x..x.PP......PP..PP..x.PP....x',
        'x..x.........PP..PP..........x',
        'x.S..........................x',
        'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      ],
    },
    {
      key: 'shower',
      name: 'THE SHOWERS',
      sub: 'Filthy. Watch your step — the puddles slow you down.',
      map: [
        '##############################',
        '#S....~~.....H.H.H.H.H.......#',
        '#.....~~.....H.H.H.H.H...f...#',
        '#..####......................#',
        '#..#o.o.o#..~~~...~~.....m...#',
        '#..#.....#..~~~..............#',
        '#..#..f..#.......#######..####',
        '#..##.####.......#~~~~~#.....#',
        '#..............m.#~~f~~#..~..#',
        '#######..........#~~~~~#.....#',
        '#.....#..H.H.H...###.###.....#',
        '#..f..#..H.H.H...........f...#',
        '#.....#..........~~..........#',
        '#..~..####..####.~~..#########',
        '#......................#.....E',
        '#..m....~~~......f.....#..m..E',
        '#.......~~~............#.....#',
        '#####..######..#####...###.###',
        '#~~......o.o.o.o....~~.......#',
        '##############################',
      ],
    },
    {
      key: 'laundry',
      name: 'LAUNDRY ROOM',
      sub: 'Half the dryers are out of order. Maintenance is "on it."',
      map: [
        '##############################',
        '#S.......WWWW....WWWW........#',
        '#........WWWW....WWWW...m....#',
        '#..TTTT..................c...#',
        '#..........######..######....#',
        '#..m.......#....#..#....#....#',
        '#....WWWW..#.c..#..#..c.#....#',
        '#....WWWW..#....####....#....#',
        '#..........#............#....#',
        '######.#####..TTTTTTT...###.##',
        '#..........#............#....#',
        '#..c.......#..TTTTTTT...#..m.#',
        '#..........#............#....#',
        '#..WWWW....####.....#####....#',
        '#..WWWW.......#..c..#........#',
        '#.............#.....#..WWWW..#',
        '#..TTTT..m...........m.WWWW..#',
        '#.......................c....#',
        '#############EE###############',
        '##############################',
      ],
    },
    {
      key: 'sprung',
      name: 'GENERAL SLEEPING AREA',
      sub: 'The big tent. Bunks, cubbies, and caseworkers who want your paperwork.',
      map: [
        '##############################',
        '#S..BBBBBB..BBBBBB..BBBBBB...#',
        '#............................#',
        '#..BBBBBB..BBBBBB..BBBBBB..c.#',
        '#............................#',
        '#..CCCC.CCCC.CCCC.CCCC.CCCC..#',
        '#..C..C.C..C.C..C.C..C.C..C..#',
        '#..C.cC.C..C.C.sC.C..C.C.cC..#',
        '#..C..C.C..C.C..C.C..C.C..C..#',
        '#..CC.C.CC.C.CC.C.CC.C.CC.C..#',
        '#..........s.................#',
        '#..BBBBBB..BBBBBB..BBBBBB....#',
        '#.....................c......#',
        '#..BBBBBB..BBBBBB..BBBBBB..s.#',
        '#............................#',
        '#.c..CCCC..CCCC..CCCC..CCCC..#',
        '#....C........C..C........C..#',
        '#.s..C...c....C..C...s....C..#',
        '#....C........C..C........C..E',
        '###########################..E',
      ],
    },
    {
      key: 'cafe',
      name: 'THE CAFETERIA',
      sub: 'Mystery slop on the line. Supervisors and Assistant Admins on the floor.',
      map: [
        '##############################',
        '#LLLLLLLLLLLLLLLLLLLL....s...#',
        '#............................#',
        '#..a......................a..#',
        '#..TTT..TTT..TTT..TTT..TTT...#',
        '#............................#',
        '#..TTT..TTT..TTT..TTT..TTT...#',
        '#....s.................s.....#',
        '#..TTT..TTT..TTT..TTT..TTT...#',
        '#............................#',
        '#######.########.#######.#####',
        '#.....#........#.#.....#.....#',
        '#..a..#...s....#.#..a..#..s..#',
        '#.....#........#.......#.....#',
        '#.....####.#####.###.###.....#',
        '#............................#',
        '#..TTT..TTT..TTT..TTT..TTT...#',
        '#S.........a.........s.......E',
        '#............................E',
        '##############################',
      ],
    },
    {
      key: 'admin',
      name: 'ADMIN OFFICES',
      sub: 'Cubicle maze. You need FIVE throwers to face the Big Kahuna.',
      map: [
        '##############################',
        '#S...#......#.....#.....#..A.#',
        '#....#..DD..#..DD.#..DD.#....#',
        '#....#..a...#..A..#.....#....#',
        '#....##.#####.#####.###.##.###',
        '#............................#',
        '#.FFFF.FFFF.FFFF.FFFF.FFFF...#',
        '#............................#',
        '###.####.#######.#######.#####',
        '#......#.......#.......#.....#',
        '#..DD..#..DD...#..DD...#..A..#',
        '#..a...#...A...#...a...#.....#',
        '#......#.......#.......#.....#',
        '####.#####.#######.#######.###',
        '#............................#',
        '#..A...FFFFFF....FFFFFF...a..#',
        '#............................#',
        '#######.###########.##########',
        '#..a...........A.............E',
        '##############################',
      ],
    },
    {
      key: 'lobby',
      name: 'WELCOME CENTER',
      sub: 'The front entrance. The Big Kahuna is waiting.',
      boss: true,
      map: [
        '##############EE##############',
        '#............................#',
        '#............................#',
        '#....##..............##......#',
        '#....##..............##......#',
        '#............................#',
        '#..........RRRRRRRR..........#',
        '#............K...............#',
        '#............................#',
        '#....##..............##......#',
        '#....##..............##......#',
        '#............................#',
        '#............................#',
        '#..f......................f..#',
        '#............................#',
        '#....##..............##......#',
        '#....##..............##......#',
        '#............................#',
        '#.............S..............#',
        '##############################',
      ],
    },
  ];

  const data = { ZONES, SOLID, ENEMY_CHARS };
  if (typeof module !== 'undefined' && module.exports) module.exports = data;
  else root.RU_DATA = data;
})(typeof window !== 'undefined' ? window : this);
