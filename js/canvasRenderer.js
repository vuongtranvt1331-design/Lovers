import { spriteURL } from "./catalog.js";

export const CanvasRenderer = (() => {
  const BACKGROUND = '#f4f8f3';
  const LOGICAL_SIZE = 80;
  const FALLBACK_SIZE = 160;
  const CACHE_LIMIT = 16;
  const sheets = new Map();

  function context(canvas) {
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    return ctx;
  }

  function surface(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  function rect(ctx, color, x, y, width = 1, height = 1) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width, height);
  }

  function polygon(ctx, color, points) {
    const ys = points.map(point => point[1]);
    ctx.fillStyle = color;
    for (let y = Math.min(...ys); y < Math.max(...ys); y++) {
      const edges = [];
      for (let i = 0; i < points.length; i++) {
        const [x1, y1] = points[i];
        const [x2, y2] = points[(i + 1) % points.length];
        const scan = y + 0.5;
        if ((y1 <= scan && scan < y2) || (y2 <= scan && scan < y1)) {
          edges.push(x1 + (x2 - x1) * (scan - y1) / (y2 - y1));
        }
      }
      edges.sort((a, b) => a - b);
      for (let i = 0; i < edges.length; i += 2) {
        const left = Math.ceil(edges[i] - 0.5);
        ctx.fillRect(left, y, Math.ceil(edges[i + 1] - 0.5) - left, 1);
      }
    }
  }

  function oval(ctx, color, x, y, width, height) {
    ctx.fillStyle = color;
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    for (let row = 0; row < height; row++) {
      const vertical = (row + 0.5 - halfHeight) / halfHeight;
      const span = Math.sqrt(1 - vertical * vertical) * halfWidth;
      const left = Math.ceil(x + halfWidth - span - 0.5);
      const right = Math.ceil(x + halfWidth + span - 0.5);
      ctx.fillRect(left, y + row, right - left, 1);
    }
  }

  function strokePixels(ctx, color, points, width) {
    for (let i = 1; i < points.length; i++) {
      const [x1, y1] = points[i - 1];
      const [x2, y2] = points[i];
      const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1);
      const inset = Math.floor(width / 2);
      for (let step = 0; step <= steps; step++) {
        const x = Math.round(x1 + (x2 - x1) * step / steps);
        const y = Math.round(y1 + (y2 - y1) * step / steps);
        rect(ctx, color, x - inset, y - inset, width, width);
      }
    }
  }

  function spark(ctx, x, y, color) {
    rect(ctx, color, x - 1, y, 3);
    rect(ctx, color, x, y - 1, 1, 3);
    rect(ctx, '#fff2be', x, y);
  }

  function glasses(ctx, y) {
    const ink = '#442e3b';
    for (const x of [31, 42]) {
      rect(ctx, ink, x + 1, y, 7);
      rect(ctx, ink, x, y + 1, 1, 6);
      rect(ctx, ink, x + 8, y + 1, 1, 6);
      rect(ctx, ink, x + 1, y + 7, 7);
      rect(ctx, '#e2c2ac', x + 1, y + 1, 2);
    }
    rect(ctx, ink, 40, y + 2, 2);
    rect(ctx, ink, 28, y + 2, 3);
    rect(ctx, ink, 51, y + 2, 3);
  }

  function character(ctx, role, key, phase) {
    const ppa = role === 'ppa';
    const running = key === 'tbv_out_running';
    const ink = '#30313a';
    const skin = ppa ? '#efbd9c' : '#d3976d';
    const warm = ppa ? '#d99b82' : '#a96850';
    const hair = ppa ? '#643747' : '#302c36';
    const hairLight = ppa ? '#8c4e61' : '#4b424f';
    const jacket = ppa ? '#647f91' : '#737983';
    const blink = phase === 3;
    const lift = running && (phase === 2 || phase === 5) ? -2 : 0;
    const step = running ? [3, 5, 2, -3, -5, -2][phase % 6] : 0;

    oval(ctx, '#d9e1d4', 20, 70, 39, 4);
    ctx.save();
    ctx.translate(0, lift);

    polygon(ctx, ink, [[27, 49], [52, 49], [53 + step, 67], [44 + step, 70], [39, 57], [36 - step, 70], [27 - step, 70]]);
    polygon(ctx, running ? '#bc9675' : '#52677a', [[29, 49], [50, 49], [51 + step, 66], [45 + step, 68], [40, 56], [38, 56], [34 - step, 68], [29 - step, 68]]);
    if (running) {
      rect(ctx, skin, 29 - step, 62, 5, 5);
      rect(ctx, skin, 45 + step, 61, 5, 6);
      rect(ctx, '#f2e8dc', 29 - step, 66, 5, 2);
      rect(ctx, '#f2e8dc', 45 + step, 66, 5, 2);
    }
    rect(ctx, ink, 26 - step, 68, 11, 4);
    rect(ctx, ink, 43 + step, 68, 11, 4);
    rect(ctx, ppa || running ? '#464650' : '#ae7282', 27 - step, 68, 8, 2);
    rect(ctx, ppa || running ? '#464650' : '#ae7282', 45 + step, 68, 8, 2);
    rect(ctx, '#c9c3bc', 27 - step, 71, 8);
    rect(ctx, '#c9c3bc', 45 + step, 71, 8);

    if (ppa) {
      polygon(ctx, '#482b38', [[24, 20], [54, 17], [58, 28], [57, 43], [53, 50], [48, 47], [44, 50], [28, 50], [22, 44], [23, 34]]);
      polygon(ctx, hair, [[25, 26], [53, 22], [55, 28], [54, 43], [50, 47], [46, 43], [28, 47], [24, 43]]);
    }
    polygon(ctx, ink, [[33, 37], [46, 37], [54, 40], [58, 50], [55, 55], [51, 55], [51, 58], [29, 58], [28, 54], [24, 54], [22, 50], [26, 41]]);
    polygon(ctx, running ? '#f0e9da' : jacket, [[33, 38], [47, 38], [53, 41], [56, 50], [53, 53], [50, 51], [50, 57], [30, 57], [29, 51], [26, 53], [24, 50], [27, 42]]);
    rect(ctx, running ? '#fdf5e7' : ppa ? '#8099a5' : '#979ba2', 30, 41, 3, 13);
    rect(ctx, running ? '#e0cbbc' : ppa ? '#4f687b' : '#535965', 47, 43, 3, 13);
    polygon(ctx, running ? '#f9f4e7' : '#e5d8c9', [[34, 39], [46, 39], [44, 44], [44, 56], [35, 56], [35, 44]]);
    if (running) {
      rect(ctx, '#b05257', 29, 40, 7);
      rect(ctx, '#cc925a', 45, 40, 6);
      rect(ctx, '#af5350', 43, 45, 3, 2);
    } else {
      rect(ctx, ppa ? '#ad7f7c' : '#596272', 35, 48, 9, 2);
      rect(ctx, ppa ? '#ad7f7c' : '#596272', 35, 53, 9, 2);
    }
    oval(ctx, skin, 24, 50, 5, 5);
    oval(ctx, skin, 52, 50, 5, 5);
    rect(ctx, warm, 37, 36, 6, 5);

    polygon(ctx, ink, [[29, 19], [34, 15], [47, 15], [53, 19], [55, 25], [54, 34], [49, 39], [43, 41], [36, 41], [30, 37], [26, 31], [26, 25]]);
    polygon(ctx, warm, [[30, 20], [35, 17], [46, 17], [51, 20], [53, 26], [52, 34], [48, 38], [43, 40], [37, 40], [31, 36], [28, 31], [28, 25]]);
    polygon(ctx, skin, [[31, 20], [36, 18], [46, 18], [51, 22], [52, 31], [49, 36], [43, 38], [37, 38], [32, 35], [30, 31]]);
    polygon(ctx, ink, [[25, 24], [25, 17], [30, 12], [36, 10], [41, 12], [45, 10], [52, 13], [56, 17], [56, 24], [53, 30], [50, 25], [47, 24], [41, 18], [37, 22], [33, 24], [30, 29], [27, 29]]);
    polygon(ctx, hair, [[27, 23], [27, 18], [31, 14], [36, 12], [41, 14], [45, 12], [51, 15], [54, 18], [54, 24], [52, 27], [47, 22], [41, 17], [36, 21], [32, 24], [29, 27]]);
    polygon(ctx, hairLight, [[28, 20], [32, 15], [36, 14], [40, 15], [35, 18], [30, 23]]);
    polygon(ctx, hairLight, [[43, 15], [46, 14], [51, 17], [53, 22], [50, 20], [47, 18]]);
    if (ppa) {
      rect(ctx, hairLight, 25, 31, 2, 10);
      rect(ctx, hairLight, 54, 29, 2, 12);
    }
    rect(ctx, '#4e343e', 34, 27, 4);
    rect(ctx, '#4e343e', 44, 27, 4);
    rect(ctx, ink, 35, 30, 3, blink ? 1 : 2);
    rect(ctx, ink, 45, 30, 3, blink ? 1 : 2);
    if (!blink) {
      rect(ctx, '#f7e6d0', 35, 30);
      rect(ctx, '#f7e6d0', 45, 30);
    }
    rect(ctx, warm, 39, 33, 3);
    rect(ctx, '#985d64', 39, 36, 4);
    if (ppa) glasses(ctx, 27);
    ctx.restore();
  }

  function plantPad(ctx, x, y, width, height, dry, flowering) {
    const shade = dry ? ['#54523e', '#77755a', '#9d976f'] : ['#425a45', '#62825c', '#8aa46d'];
    oval(ctx, shade[0], x, y + 2, width, height);
    oval(ctx, shade[1], x + 1, y, width - 2, height);
    oval(ctx, shade[2], x + 3, y + 1, width - 7, Math.max(2, Math.floor(height / 2)));
    rect(ctx, shade[0], x + Math.round(width * 0.66), y + height - 1, 3);
    rect(ctx, shade[2], x + Math.round(width * 0.53), y + 2, 3, 2);
    if (flowering) {
      const petals = dry ? '#a17f83' : '#dba3af';
      for (const flower of [[x + 5, y + 3], [x + width - 7, y + 5]]) {
        rect(ctx, petals, flower[0] - 1, flower[1], 3);
        rect(ctx, petals, flower[0], flower[1] - 1, 1, 3);
        rect(ctx, dry ? '#bea298' : '#f9ddc7', flower[0], flower[1]);
      }
    }
  }

  function bonsai(ctx, key, phase) {
    const match = /^bonsai_0([1-5])_(healthy|dry)$/.exec(key);
    const stage = match ? Number(match[1]) : 1;
    const dry = match?.[2] === 'dry';
    const baseY = 61;
    const potWidth = [0, 27, 35, 40, 43, 47][stage];
    const potX = 40 - Math.floor(potWidth / 2);
    const sway = dry ? 0 : [0, 1, 1, 0, 0][phase % 5];
    oval(ctx, '#d9e1d4', potX - 3, 71, potWidth + 6, 4);
    if (stage === 1) {
      oval(ctx, '#735345', 50, 61, 10, 10);
      oval(ctx, BACKGROUND, 52, 63, 5, 5);
    }
    const clay = stage >= 3 ? ['#435d5f', '#6f8c83', '#9daf98'] : ['#845b4e', '#bc8870', '#deb393'];
    polygon(ctx, clay[0], [[potX, baseY], [potX + potWidth, baseY], [potX + potWidth - 3, 71], [potX + 3, 71]]);
    polygon(ctx, clay[1], [[potX + 2, baseY], [potX + potWidth - 2, baseY], [potX + potWidth - 4, 69], [potX + 4, 69]]);
    rect(ctx, clay[2], potX + 5, 65, potWidth - 10, 2);
    rect(ctx, clay[0], potX + 5, 71, 4);
    rect(ctx, clay[0], potX + potWidth - 9, 71, 4);
    oval(ctx, clay[0], potX, 55, potWidth, 9);
    oval(ctx, clay[2], potX + 1, 55, potWidth - 2, 7);
    oval(ctx, dry ? '#a8977c' : '#594537', potX + 3, 56, potWidth - 6, 5);
    if (dry) {
      strokePixels(ctx, '#786957', [[34, 57], [36, 59], [33, 60]], 1);
      strokePixels(ctx, '#786957', [[46, 56], [43, 58], [46, 60]], 1);
      if (stage >= 3) {
        rect(ctx, '#a88963', 31, 59, 4);
        rect(ctx, '#b08873', 46, 58, 3);
      }
    } else if (stage >= 3) {
      rect(ctx, '#a7a28d', 29, 57, 4, 2);
      rect(ctx, '#c0b49a', 47, 57, 4, 2);
    }

    if (stage === 1) {
      const tipY = dry ? 49 : 43;
      strokePixels(ctx, dry ? '#777650' : '#537748', [[40, 58], [40, 51], [40 + sway, tipY]], 2);
      if (dry) {
        polygon(ctx, '#9e9b70', [[40, 49], [35, 47], [31, 51], [33, 55], [37, 53]]);
        polygon(ctx, '#9e9b70', [[40, 49], [45, 48], [49, 52], [47, 56], [43, 54]]);
        rect(ctx, '#a3a48d', 40, 39);
        rect(ctx, '#b5b39d', 39, 40, 1, 2);
        rect(ctx, '#b5b39d', 41, 40, 1, 2);
        rect(ctx, '#a3a48d', 40, 42);
      } else {
        polygon(ctx, '#6c8d5e', [[40 + sway, 46], [35 + sway, 46], [31 + sway, 43], [30 + sway, 39], [36 + sway, 40], [39 + sway, 43]]);
        polygon(ctx, '#74975f', [[40 + sway, 46], [42 + sway, 41], [46 + sway, 38], [50 + sway, 38], [49 + sway, 42], [45 + sway, 45]]);
        rect(ctx, '#a4bb78', 33 + sway, 41, 4);
        rect(ctx, '#bed096', 45 + sway, 40, 3);
        if (phase < 4) rect(ctx, phase === 1 ? '#fffefa' : '#e8c982', 27, 42 - (phase > 1 ? 1 : 0));
        if (phase === 2 || phase === 3) rect(ctx, '#f3dfae', 41, 34 - (phase === 3 ? 1 : 0));
      }
      return;
    }

    const high = [0, 0, 31, 24, 20, 16][stage] + (dry ? 4 : 0);
    const bend = dry ? 5 : sway;
    const points = [[40, 57], [37, 49], [40, 43], [45, 38], [42 + bend, high + 5], [39 + bend, high]];
    const bark = stage > 3 ? '#6f473d' : '#825640';
    strokePixels(ctx, '#493c34', points, stage - 1);
    strokePixels(ctx, bark, points, Math.max(1, stage - 2));
    strokePixels(ctx, '#af7b56', [[41, 57], [38, 49], [41, 43], [46, 38], [43 + bend, high + 6]], 1);
    const spread = 14 + stage * 2;
    strokePixels(ctx, bark, [[40, 45], [35, 42], [40 - spread / 2 | 0, 37 + (dry ? 4 : 0)]], 2);
    strokePixels(ctx, bark, [[44, 39], [48, 37], [40 + spread / 2 | 0, 32 + (dry ? 4 : 0)]], 2);
    const padWidth = 10 + stage * 2;
    const padHeight = 5 + Math.floor(stage / 2);
    plantPad(ctx, 31 + bend, high - 3, padWidth + 2, padHeight, dry, stage >= 4);
    plantPad(ctx, 29 - Math.floor(spread / 3), 36 + (dry ? 5 : 0), padWidth, padHeight, dry, stage >= 4);
    plantPad(ctx, 43, 31 + (dry ? 5 : 0), padWidth + 1, padHeight, dry, stage >= 4);
    if (stage >= 3) {
      plantPad(ctx, 25 - stage, 23 + (dry ? 5 : 0), padWidth + 2, padHeight, dry, stage >= 4);
      strokePixels(ctx, bark, [[40, 45], [36, 36], [32, 27]], 1);
    }
    if (stage === 5) {
      const tagX = 53 + (dry ? 0 : [0, 1, 1, -1, 0][phase % 5]);
      strokePixels(ctx, '#866556', [[52, 36], [tagX, 42]], 1);
      rect(ctx, '#765b43', tagX - 2, 42, 5, 4);
      rect(ctx, dry ? '#a79160' : '#e2bb78', tagX - 1, 43, 3, 2);
    }
    if (!dry && phase !== 4) {
      spark(ctx, 31 + sway, high - 3, '#e6bd79');
      if (phase > 0) spark(ctx, 61, 31 - phase, '#edc990');
      if (stage >= 4 && phase >= 2) rect(ctx, '#dba3af', 26, 42 + phase * 2, 2);
    }
  }

  function fittedSurface(canvas, width, height) {
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    return context(canvas);
  }

  function loadSheet(url) {
    const cached = sheets.get(url);
    if (cached) {
      sheets.delete(url);
      sheets.set(url, cached);
      return cached;
    }
    const pending = new Promise(resolve => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = url;
    }).catch(() => null);
    sheets.set(url, pending);
    if (sheets.size > CACHE_LIMIT) sheets.delete(sheets.keys().next().value);
    pending.then(sheet => {
      if (!sheet && sheets.get(url) === pending) sheets.delete(url);
    });
    return pending;
  }

  function create(canvas, role, { transparent = false } = {}) {
    const fallback = transparent ? null : surface(LOGICAL_SIZE, LOGICAL_SIZE);
    const fallbackCtx = fallback && context(fallback);
    let key = role === 'plant' ? 'bonsai_01_healthy' : '';
    let sprite = null;
    let offset = 0;
    let latestTick = 0;
    let requestId = 0;
    let lastFrame = -1;
    let disposed = false;

    function frameCount() {
      if (sprite) return sprite.columns * sprite.rows;
      if (transparent) return 1;
      if (role !== 'plant') return 6;
      return key.endsWith('_dry') ? 1 : 5;
    }

    function draw(tick) {
      if (disposed) return;
      latestTick = tick;
      const elapsed = Math.max(0, tick - offset);
      const index = elapsed % frameCount();
      if (index === lastFrame) return;
      lastFrame = index;
      if (sprite) {
        const { sheet, columns, width, height } = sprite;
        const ctx = fittedSurface(canvas, width, height);
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(sheet, (index % columns) * width, Math.floor(index / columns) * height,
          width, height, 0, 0, width, height);
      } else if (fallback) {
        const ctx = fittedSurface(canvas, FALLBACK_SIZE, FALLBACK_SIZE);
        rect(fallbackCtx, BACKGROUND, 0, 0, LOGICAL_SIZE, LOGICAL_SIZE);
        if (role === 'plant') {
          bonsai(fallbackCtx, key, index);
        } else {
          character(fallbackCtx, role, key, index);
        }
        ctx.drawImage(fallback, 0, 0, FALLBACK_SIZE, FALLBACK_SIZE);
      }
    }

    function restart(tick) {
      offset = tick;
      lastFrame = -1;
    }

    async function load(nextKey, columns, rows, url = spriteURL(nextKey)) {
      if (disposed || !Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1) {
        return false;
      }
      const id = ++requestId;
      key = nextKey;
      sprite = null;
      restart(latestTick);
      if (!url) return false;

      const pending = loadSheet(url);
      const sheet = await pending;
      if (!sheet || id !== requestId || disposed) return false;
      const width = sheet.naturalWidth / columns;
      const height = sheet.naturalHeight / rows;
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
        if (sheets.get(url) === pending) sheets.delete(url);
        return false;
      }
      sprite = { sheet, columns, rows, width, height };
      lastFrame = -1;
      return true;
    }

    function dispose() {
      disposed = true;
      requestId++;
      sprite = null;
      if (transparent) context(canvas).clearRect(0, 0, canvas.width, canvas.height);
    }

    return {
      load, draw, restart, dispose,
      get animated() { return !disposed && frameCount() > 1; },
    };
  }

  return { create };
})();

export const AnimationManager = (() => {
  const interval = 1000 / 3;
  let active = false;
  let epoch = 0;
  let renderedTick = -1;
  let request = null;
  let render;

  const frameAt = now => Math.floor(Math.max(0, now - epoch) / interval);

  function schedule() {
    if (active && request === null) request = requestAnimationFrame(advance);
  }

  function advance(now) {
    request = null;
    if (!active) return;
    const next = frameAt(now);
    try {
      if (next !== renderedTick) {
        renderedTick = next;
        render(next);
      }
    } finally {
      schedule();
    }
  }

  function setActive(enabled) {
    if (active === enabled || !render) return;
    active = enabled;
    if (active) {
      schedule();
    } else if (request !== null) {
      cancelAnimationFrame(request);
      request = null;
    }
  }

  function redraw() {
    if (!active) return;
    renderedTick = frameAt(performance.now());
    render(renderedTick);
  }

  return {
    start(drawCallback, enabled = true) {
      if (render) return;
      render = drawCallback;
      epoch = performance.now();
      setActive(enabled);
      redraw();
    },
    setActive,
    redraw,
    get tick() {
      return render ? frameAt(performance.now()) : 0;
    },
  };
})();
