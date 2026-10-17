import { Palette } from './voxel.js';

// Emissive groups (driven per-frame in main.js):
//  1 baked lamp spill · 2 steady glow · 3 windows · 4-9 neon flicker variants
// 10 lanterns · 11 Tokyo Tower · 12 aviation blink · 13 sakura glow · 14 train
export const NEON_COLORS = {
  pink: '#ff3fae', cyan: '#3ff0ff', yellow: '#ffe13a', purple: '#b45cff', green: '#57ff8f',
  orange: '#ff8a2a', red: '#ff2f4f', white: '#fff4e6', blue: '#3f7dff',
};
export const PANEL_COLORS = {
  yellow: '#ffd23a', blue: '#2a9cff', pink: '#ff5cb6', white: '#f2ece2', purple: '#6a3cff',
  red: '#e8283a', teal: '#1fd1c8', orange: '#ff7a1a',
};

export function makePalette() {
  const p = new Palette();
  const A = (n, h, o) => p.add(n, h, o);

  // terrain
  A('grass', '#4c7a3f', { j: 0.12 }); A('grass2', '#5e8c46', { j: 0.12 }); A('grassDark', '#3a5f35', { j: 0.1 });
  A('moss', '#6d8d4c', { j: 0.12 }); A('dirt', '#6a4b3c', { j: 0.08 });
  A('stone', '#8a869b', { j: 0.1 }); A('stoneDark', '#5f5b72', { j: 0.08 }); A('stoneLight', '#aba6ba', { j: 0.06 });
  A('cobble', '#5d596d', { j: 0.12 }); A('cobble2', '#6e6a7e', { j: 0.1 }); A('gravel', '#bdb6c0', { j: 0.09 });
  A('asphalt', '#3a3849', { j: 0.05 }); A('line', '#d9d4cc', { j: 0.03 }); A('curb', '#7f7b8d', { j: 0.04 });
  A('sidewalk', '#6c687b', { j: 0.07 }); A('petalGround', '#ec9fc4', { j: 0.12 }); A('water', '#34407a', { j: 0.05 });

  // timber houses
  A('woodDark', '#3a2519', { j: 0.07 }); A('wood', '#5b3a25', { j: 0.08 }); A('woodLight', '#7c5236', { j: 0.08 });
  A('woodRed', '#6b2d22', { j: 0.07 }); A('plaster', '#d8ccb3', { j: 0.05 }); A('plasterDark', '#a5977f', { j: 0.05 });
  A('plasterWhite', '#ebe4d6', { j: 0.04 });
  A('roof', '#4a5577', { j: 0.07 }); A('roof2', '#3f4868', { j: 0.07 }); A('roofRidge', '#6a7498', { j: 0.05 });
  A('roofEdge', '#2c334c', { j: 0.05 });
  A('winWarm', '#ffc46b', { em: 1.9, grp: 3, j: 0.12 }); A('shoji', '#ffd99a', { em: 1.35, grp: 3, j: 0.1 });
  A('winDim', '#e89a50', { em: 1.1, grp: 3, j: 0.15 });
  A('noren', '#26356a', { j: 0.05 }); A('norenRed', '#9a2a2a', { j: 0.05 }); A('norenWhite', '#e8e2d4', { j: 0.03 });
  A('chochinRed', '#ff5236', { em: 2.6, grp: 10, j: 0.05 }); A('chochinWhite', '#ffe2ad', { em: 2.6, grp: 10, j: 0.05 });
  A('lampWarm', '#ffd28a', { em: 4.0, grp: 10, j: 0.03 }); A('fire', '#ffb04a', { em: 4.5, grp: 10, j: 0.08 });
  A('vending', '#e6f3ff', { em: 2.0, grp: 3, j: 0.05 }); A('vendingRed', '#d42838', { j: 0.03 }); A('vendingBlue', '#2a5ad4', { j: 0.03 });
  A('kanban', '#2a1e18', { j: 0.03 }); A('kanbanGold', '#e8b85a', { em: 0.8, grp: 2, j: 0.05 });

  // shrine
  A('vermilion', '#d6402b', { j: 0.05 }); A('vermilionDark', '#a42e22', { j: 0.05 });
  A('black', '#1c1922', { j: 0.03 }); A('gold', '#e8b84a', { em: 0.5, grp: 2, j: 0.06 });
  A('rope', '#d8c49a', { j: 0.05 }); A('shide', '#f4f0e8', { j: 0.02 });

  // pagoda
  A('pagodaRed', '#a13026', { j: 0.05 }); A('pagodaRedDark', '#6e1e1b', { j: 0.05 });
  A('pagodaWhite', '#e4d8c6', { j: 0.04 }); A('bracket', '#2c1c19', { j: 0.05 });
  A('pRoof', '#363c54', { j: 0.06 }); A('pRoof2', '#2e3349', { j: 0.06 }); A('pRoofEdge', '#20243a', { j: 0.04 });
  A('pRidge', '#5c6486', { j: 0.04 }); A('sorin', '#c99a3a', { em: 0.55, grp: 2, j: 0.06 });

  // nature
  A('trunk', '#4a3329', { j: 0.08 }); A('trunkDark', '#33241e', { j: 0.08 });
  A('sakura1', '#ffa8d2', { j: 0.06, em: 0.16, grp: 13, ao: 1 }); A('sakura2', '#ff8cc4', { j: 0.06, em: 0.14, grp: 13, ao: 1 }); A('sakura3', '#ffd2ea', { j: 0.05, em: 0.18, grp: 13, ao: 1 });
  A('sakura4', '#f07ab8', { j: 0.06, em: 0.1, grp: 13, ao: 1 }); A('sakura5', '#ffe6f3', { j: 0.04, em: 0.2, grp: 13, ao: 1 }); A('sakuraDeep', '#d4609e', { j: 0.06, em: 0.06, grp: 13, ao: 1 });
  A('sakuraGlow', '#ffb6dc', { em: 0.7, grp: 13, j: 0.08 });
  A('leaf1', '#3f7a3d', { j: 0.1 }); A('leaf2', '#4f8f46', { j: 0.1 }); A('leaf3', '#2f6334', { j: 0.1 });
  A('pine1', '#2b5034', { j: 0.08 }); A('pine2', '#36603b', { j: 0.08 });
  A('maple1', '#dd6a2c', { j: 0.08 }); A('maple2', '#c4472a', { j: 0.08 }); A('maple3', '#ec952f', { j: 0.08 });
  A('bush', '#3d6b3a', { j: 0.12 });

  // city concrete (lavender-greys like the painting)
  const conc = ['#8d87aa', '#7a7599', '#9e98b6', '#6d6889', '#aaa3be', '#5d5979', '#6f7aa4', '#a18b9b', '#8b97b5', '#b3a3b0'];
  conc.forEach((h, i) => A('conc' + i, h, { j: 0.05 }));
  A('concDark', '#46425c', { j: 0.04 }); A('glass', '#2f3762', { j: 0.05 }); A('glass2', '#3c4a7c', { j: 0.05 });
  A('winCool', '#bcd4ff', { em: 1.05, grp: 3, j: 0.15 }); A('winWarm2', '#ffcf8a', { em: 1.15, grp: 3, j: 0.15 });
  A('winTeal', '#94e6ff', { em: 0.95, grp: 3, j: 0.1 }); A('winOff', '#2b2f4e', { j: 0.08 });
  A('shopWhite', '#e8eeff', { em: 1.45, grp: 3, j: 0.06 }); A('shopWarm', '#ffd49a', { em: 1.4, grp: 3, j: 0.06 });
  A('shutter', '#77748a', { j: 0.03 }); A('rooftop', '#4a4662', { j: 0.05 }); A('ac', '#8c8b9a', { j: 0.05 });
  A('antenna', '#2b2938', { j: 0.03 }); A('aviation', '#ff2a2a', { em: 5, grp: 12, j: 0.02 });
  A('steel', '#4b4a5c', { j: 0.04 }); A('ledCrown', '#9ef0ff', { em: 2.0, grp: 2, j: 0.04 });

  // neon (each colour in six flicker groups)
  for (const [k, h] of Object.entries(NEON_COLORS))
    for (let g = 4; g <= 9; g++) A(`neon_${k}_${g}`, h, { em: 2.1, grp: g, j: 0.04 });
  for (const [k, h] of Object.entries(PANEL_COLORS)) A('panel_' + k, h, { em: 0.7, grp: 3, j: 0.05 });
  A('panelDark', '#1a1626', { j: 0.03 }); A('signFrame', '#2a2836', { j: 0.03 });

  // Tokyo Tower
  A('towerOrange', '#ff4a14', { em: 2.3, grp: 11, j: 0.05 }); A('towerAmber', '#ff8424', { em: 2.6, grp: 11, j: 0.06 });
  A('towerWhite', '#ffd8a8', { em: 1.9, grp: 11, j: 0.04 }); A('towerDeck', '#d8d0c6', { j: 0.03 });
  A('towerDeckWin', '#ffe3a8', { em: 3.4, grp: 11, j: 0.06 }); A('towerSteel', '#7a3a2a', { j: 0.04 });

  // railway + train
  A('viaduct', '#7d7895', { j: 0.05 }); A('viaductDark', '#5d5976', { j: 0.05 });
  A('girder', '#2f8276', { j: 0.05 }); A('girderDark', '#22605a', { j: 0.05 });
  A('rail', '#4a4a57', { j: 0.03 }); A('sleeper', '#3a302b', { j: 0.05 }); A('ballast', '#6d6672', { j: 0.12 });
  A('trainBody', '#cdd2d8', { j: 0.02 }); A('trainBodyDark', '#8b909c', { j: 0.02 });
  A('trainGreen', '#2f9a5a', { j: 0.02 }); A('trainYellow', '#e8c43a', { j: 0.02 });
  A('trainWin', '#ffd99a', { em: 1.3, grp: 14, j: 0.05 }); A('trainDark', '#25283a', { j: 0.02 });
  A('headlight', '#fff6d6', { em: 7, grp: 14, j: 0 }); A('taillight', '#ff3030', { em: 4, grp: 14, j: 0 });
  A('destLED', '#ffa030', { em: 3, grp: 14, j: 0.05 });

  // street furniture
  A('pole', '#8d8998', { j: 0.04 }); A('poleDark', '#5c586a', { j: 0.04 }); A('transformer', '#9c9aa8', { j: 0.04 });
  A('metal', '#3c3a48', { j: 0.03 });

  // clouds
  A('cloud', '#ffffff', { j: 0.05, ao: 0.8 }); A('cloud2', '#e9e4f2', { j: 0.05, ao: 0.8 });

  return p;
}
