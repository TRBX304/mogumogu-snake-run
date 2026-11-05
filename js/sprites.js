// ドット絵の定義。1文字 = 1ドット、'.' は透明
const APPLE_ROWS = [
  '.....gg...',
  '....bgg...',
  '..rrbrrr..',
  '.rhrrrrrr.',
  'rhhrrrrrrR',
  'rhrrrrrrrR',
  'rrrrrrrrRR',
  'rrrrrrrrRR',
  '.rrrrrrRR.',
  '..rRR.RR..',
];

const POISON_ROWS = [
  '.....dd...',
  '....bdd...',
  '..ppbppp..',
  '.pppppppp.',
  'pwwpppwwpP',
  'pwwpppwwpP',
  'ppppppppPP',
  'pppppppPPP',
  '.pwpwpwPP.',
  '..pPP.PP..',
];

const DEFS = {
  red: {
    rows: APPLE_ROWS,
    pal: { r: '#ff595e', R: '#d63c41', h: '#ffc2c3', b: '#7a4a2a', g: '#52b83a' },
  },
  gold: {
    rows: APPLE_ROWS,
    pal: { r: '#ffcf33', R: '#e09a00', h: '#fff7cc', b: '#7a4a2a', g: '#52b83a' },
  },
  poison: {
    rows: POISON_ROWS,
    pal: { p: '#7b2cbf', P: '#4f1787', w: '#f3e8ff', b: '#4a3a30', d: '#8a8466' },
  },
};

export const SPR = {};

for (const [key, def] of Object.entries(DEFS)) {
  const h = def.rows.length;
  const w = def.rows[0].length;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d');
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = def.rows[y][x];
      if (ch === '.') continue;
      c.fillStyle = def.pal[ch];
      c.fillRect(x, y, 1, 1);
    }
  }
  SPR[key] = { canvas: cv, w, h };
}

export function drawSprite(ctx, key, x, y, dot = 4) {
  const s = SPR[key];
  ctx.drawImage(s.canvas, Math.round(x), Math.round(y), s.w * dot, s.h * dot);
}

// HTML側で使うアイコン（ホーム画面のルール説明など）
export function spriteIcon(key, dot = 3) {
  const s = SPR[key];
  const cv = document.createElement('canvas');
  cv.width = s.w * dot;
  cv.height = s.h * dot;
  cv.className = 'pixel-icon';
  const c = cv.getContext('2d');
  c.imageSmoothingEnabled = false;
  c.drawImage(s.canvas, 0, 0, cv.width, cv.height);
  return cv;
}

// スネークの色
export const SNAKE = {
  body: '#3a86ff',
  shade: '#2667d6',
  scale: '#79acff',
  eye: '#ffffff',
  pupil: '#1f2a44',
  cheek: '#ff8fab',
  tongue: '#ff4d6d',
};

// 頭（7x7ドット）。w=白目, c=ほっぺ, S=影
export const HEAD_ROWS = [
  '.HHHHH.',
  'HHHHHHS',
  'HwwHwwS',
  'HwwHwwS',
  'HcHHHcS',
  'HHHHHHS',
  'HHHHHHS',
];
