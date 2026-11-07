// The hologram's "blueprints": the panel that follows the request, drawn as glowing lines on
// black (the floor plan in 3D with the rooms and devices involved, a camera, a chart, a list,
// a card). Everything is drawn on a canvas, so the page can mirror and rotate it for the
// reflector like the rest.
import { t, LOCALE } from "./i18n.js";

const MONO = '"JetBrains Mono", monospace';
const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

const STATE_WORDS = {
  on: t("acceso"), off: t("spento"), open: t("aperto"), closed: t("chiuso"), opening: t("in apertura"),
  closing: t("in chiusura"), locked: t("chiusa a chiave"), unlocked: t("aperta"), home: t("in casa"),
  not_home: t("fuori"), playing: t("in riproduzione"), paused: t("in pausa"), idle: t("a riposo"),
  heat: t("riscalda"), cool: t("raffresca"), auto: "auto", unavailable: t("non disponibile"),
};

export function stateText(item) {
  if (item.state == null) return "";
  const n = Number(item.state);
  if (item.state !== "" && Number.isFinite(n)) return `${n.toLocaleString(LOCALE, { maximumFractionDigits: 1 })}${item.unit ? " " + item.unit : ""}`;
  return STATE_WORDS[item.state] || String(item.state).replace(/_/g, " ");
}

const isOn = (s) => ["on", "open", "opening", "playing", "unlocked", "heat", "cool", "home"].includes(s);

function line(ctx, pts, close = false) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  if (close) ctx.closePath();
}

// Corner brackets and a faint grid: the "blueprint" frame.
function frame(ctx, x, y, w, h, rgb, p, gridStep) {
  ctx.save();
  ctx.globalAlpha = p;
  if (gridStep) {
    ctx.strokeStyle = `rgba(${rgb},0.07)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = x; gx <= x + w + 0.5; gx += gridStep) { ctx.moveTo(gx, y); ctx.lineTo(gx, y + h); }
    for (let gy = y; gy <= y + h + 0.5; gy += gridStep) { ctx.moveTo(x, gy); ctx.lineTo(x + w, gy); }
    ctx.stroke();
  }
  const c = Math.min(w, h) * 0.08;
  ctx.strokeStyle = `rgba(${rgb},0.9)`;
  ctx.lineWidth = Math.max(1.5, w / 260);
  ctx.shadowColor = `rgba(${rgb},0.9)`;
  ctx.shadowBlur = c * 0.4;
  for (const [cx, cy, dx, dy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
    line(ctx, [[cx + dx * c, cy], [cx, cy], [cx, cy + dy * c]]);
    ctx.stroke();
  }
  ctx.restore();
}

function label(ctx, text, x, y, size, color, align = "left", weight = 400) {
  ctx.font = `${weight} ${Math.round(size)}px ${MONO}`;
  ctx.textAlign = align;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function fit(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  while (text.length > 1 && ctx.measureText(text + "…").width > max) text = text.slice(0, -1);
  return text + "…";
}

// ------------------------------------------------------------------ the house in 3D
function drawHouse(ctx, sc, box, now, rgb, p) {
  const { x, y, w, h } = box;
  const aspect = sc.aspect || 1.4;
  const wall = 0.09;
  const tilt = 0.95; // radians from the vertical: a three-quarter view
  const yaw = -0.35 + Math.sin(now / 5200) * 0.3; // it turns slowly, back and forth
  const r = Math.hypot(aspect / 2, 0.5);
  const legendW = sc.items.length ? w * 0.3 : 0;
  const pw = w - legendW;
  const scale = Math.min(pw / (2 * r), h / (2 * (r * Math.cos(tilt) + wall))) * 1.08;
  const cx = x + pw / 2, cy = y + h / 2;
  const grow = ease(p * 1.2); // walls rise as it appears
  const proj = (px, pz, py) => {
    const X = (px / 100 - 0.5) * aspect, Z = py / 100 - 0.5;
    const xr = X * Math.cos(yaw) - Z * Math.sin(yaw);
    const zr = X * Math.sin(yaw) + Z * Math.cos(yaw);
    const f = 1 / (1 - zr * 0.25); // a touch of perspective: nearer is bigger
    return [cx + xr * scale * f, cy + (zr * Math.cos(tilt) - pz * wall * grow * Math.sin(tilt) * 2.2) * scale * f];
  };
  const focus = new Set(sc.focus || []);
  const pulse = 0.5 + 0.5 * Math.sin(now / 380);
  ctx.save();
  ctx.lineJoin = "round";
  const rooms = [...sc.rooms].sort((a, b) => focus.has(a.id) - focus.has(b.id)); // lit rooms on top
  for (const rm of rooms) {
    const lit = focus.has(rm.id);
    const corners = [[rm.x, rm.y], [rm.x + rm.w, rm.y], [rm.x + rm.w, rm.y + rm.h], [rm.x, rm.y + rm.h]];
    const floor = corners.map(([a, b]) => proj(a, 0, b));
    const top = corners.map(([a, b]) => proj(a, 1, b));
    ctx.fillStyle = lit ? `rgba(${rgb},${0.12 + 0.12 * pulse})` : `rgba(${rgb},0.025)`;
    line(ctx, floor, true);
    ctx.fill();
    ctx.strokeStyle = `rgba(${rgb},${lit ? 0.95 : 0.3})`;
    ctx.lineWidth = Math.max(1, scale / (lit ? 160 : 260));
    ctx.shadowColor = `rgba(${rgb},${lit ? 0.9 : 0})`;
    ctx.shadowBlur = lit ? scale * 0.03 : 0;
    line(ctx, floor, true); ctx.stroke();
    line(ctx, top, true); ctx.stroke();
    ctx.beginPath();
    floor.forEach(([a, b], i) => { ctx.moveTo(a, b); ctx.lineTo(...top[i]); });
    ctx.stroke();
    ctx.shadowBlur = 0;
    const [lx, ly] = proj(rm.x + rm.w / 2, 1.4, rm.y + rm.h / 2);
    label(ctx, rm.name.toUpperCase(), lx, ly, scale * 0.045, `rgba(${lit ? "230,250,255" : rgb},${lit ? 0.95 : 0.45})`, "center", lit ? 500 : 400);
  }
  // Devices: a beacon in their room, rising to a label with the state.
  const perRoom = {};
  sc.items.forEach((it, i) => {
    const rm = sc.rooms.find((r) => r.id === it.area);
    if (!rm) return;
    const k = (perRoom[rm.id] = (perRoom[rm.id] || 0) + 1) - 1;
    const px = rm.x + rm.w * (k % 2 ? 0.7 : 0.3), pz = rm.y + rm.h * (0.35 + 0.3 * (Math.floor(k / 2) % 2));
    const [bx, by] = proj(px, 0, pz);
    const [tx, ty] = proj(px, 3.2 + k * 0.9, pz);
    const on = isOn(it.state);
    const a = ease((p - 0.3 - i * 0.08) * 2);
    if (a <= 0) return;
    ctx.globalAlpha = a;
    ctx.strokeStyle = `rgba(${rgb},0.8)`;
    ctx.lineWidth = 1;
    line(ctx, [[bx, by], [tx, ty]]); ctx.stroke();
    ctx.beginPath(); ctx.arc(bx, by, scale * 0.012, 0, Math.PI * 2);
    ctx.fillStyle = on ? "rgba(255,230,150,1)" : `rgba(${rgb},1)`; ctx.fill();
    ctx.beginPath(); ctx.arc(bx, by, scale * (0.015 + 0.03 * ((now / 1200 + i * 0.3) % 1)), 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${on ? "255,230,150" : rgb},${0.8 * (1 - ((now / 1200 + i * 0.3) % 1))})`; ctx.stroke();
    label(ctx, `${it.name} · ${stateText(it)}`.toUpperCase(), tx, ty - scale * 0.01, scale * 0.038, on ? "rgba(255,236,180,0.95)" : "rgba(220,245,255,0.9)", "center", 500);
    ctx.globalAlpha = 1;
  });
  // Legend: every device involved, with its state (live).
  if (legendW) {
    const lx = x + pw + legendW * 0.08, size = Math.min(h / 18, legendW / 12);
    ctx.font = `400 ${Math.round(size)}px ${MONO}`;
    sc.items.slice(0, 8).forEach((it, i) => {
      const a = ease((p - 0.4 - i * 0.07) * 2);
      if (a <= 0) return;
      ctx.globalAlpha = a;
      const ly = y + h * 0.12 + i * size * 2.6;
      ctx.fillStyle = `rgba(${rgb},0.9)`;
      ctx.fillRect(lx, ly - size * 0.9, 2, size * 2.1);
      label(ctx, fit(ctx, it.name.toUpperCase(), legendW * 0.85), lx + size * 0.6, ly, size * 0.85, `rgba(${rgb},0.7)`);
      label(ctx, fit(ctx, stateText(it) + (it.room ? ` · ${it.room}` : ""), legendW * 0.85), lx + size * 0.6, ly + size * 1.05, size, isOn(it.state) ? "rgba(255,236,180,0.95)" : "rgba(230,250,255,0.95)", "left", 500);
    });
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// ------------------------------------------------------------------ a sensor over time
function drawChart(ctx, sc, box, now, rgb, p) {
  const { x, y, w, h } = box;
  const pts = (sc.points || []).map(([tt, v]) => [Date.parse(tt), Number(v)]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  if (pts.length < 2) return;
  const size = h / 16;
  const left = x + w * 0.1, right = x + w * 0.98, top = y + h * 0.18, bottom = y + h * 0.86;
  const t0 = pts[0][0], t1 = pts[pts.length - 1][0];
  let lo = Math.min(...pts.map((q) => q[1])), hi = Math.max(...pts.map((q) => q[1]));
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
  const X = (tt) => left + ((tt - t0) / Math.max(1, t1 - t0)) * (right - left);
  const Y = (v) => bottom - ((v - lo) / (hi - lo)) * (bottom - top);
  ctx.save();
  ctx.strokeStyle = `rgba(${rgb},0.25)`;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const gy = top + ((bottom - top) * i) / 4;
    line(ctx, [[left, gy], [right, gy]]); ctx.stroke();
    label(ctx, (hi - ((hi - lo) * i) / 4).toLocaleString(LOCALE, { maximumFractionDigits: 1 }), left - size * 0.4, gy + size * 0.3, size * 0.75, `rgba(${rgb},0.6)`, "right");
  }
  label(ctx, `-${sc.hours || 24}h`, left, bottom + size * 1.4, size * 0.75, `rgba(${rgb},0.6)`);
  label(ctx, t("ora"), right, bottom + size * 1.4, size * 0.75, `rgba(${rgb},0.6)`, "right");
  // The curve draws itself from left to right.
  const n = Math.max(2, Math.ceil(pts.length * ease(p * 1.3)));
  const shown = pts.slice(0, n).map(([a, b]) => [X(a), Y(b)]);
  const grad = ctx.createLinearGradient(0, top, 0, bottom);
  grad.addColorStop(0, `rgba(${rgb},0.35)`);
  grad.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = grad;
  line(ctx, [...shown, [shown[shown.length - 1][0], bottom], [shown[0][0], bottom]], true);
  ctx.fill();
  ctx.strokeStyle = `rgba(${rgb},1)`;
  ctx.lineWidth = Math.max(2, w / 220);
  ctx.shadowColor = `rgba(${rgb},1)`;
  ctx.shadowBlur = size * 0.8;
  line(ctx, shown); ctx.stroke();
  const [ex, ey] = shown[shown.length - 1];
  ctx.beginPath(); ctx.arc(ex, ey, size * 0.3, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill();
  ctx.shadowBlur = 0;
  const nowText = stateText({ state: sc.now ?? pts[pts.length - 1][1], unit: sc.unit });
  ctx.font = `600 ${Math.round(size * 2)}px Rajdhani, sans-serif`;
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(235,252,255,0.95)";
  ctx.fillText(nowText, right, y + size * 1.6);
  ctx.restore();
}

// ------------------------------------------------------------------ list and card
function drawList(ctx, sc, box, now, rgb, p) {
  const { x, y, w, h } = box;
  const items = sc.items || [];
  const size = Math.min(h / Math.max(8, items.length * 2.3), w / 26);
  ctx.save();
  items.forEach((it, i) => {
    const a = ease((p - i * 0.08) * 2.5);
    if (a <= 0) return;
    ctx.globalAlpha = a;
    const ly = y + h * 0.08 + i * size * 2.3;
    const off = (1 - a) * w * 0.05;
    label(ctx, String(i + 1).padStart(2, "0"), x + w * 0.04 - off, ly + size, size * 0.9, `rgba(${rgb},0.9)`, "left", 500);
    ctx.font = `400 ${Math.round(size)}px "Saira Semi Condensed", sans-serif`;
    ctx.fillStyle = "rgba(235,250,255,0.95)";
    ctx.textAlign = "left";
    ctx.fillText(fit(ctx, it, w * 0.82), x + w * 0.13 - off, ly + size);
    ctx.strokeStyle = `rgba(${rgb},0.25)`;
    ctx.lineWidth = 1;
    line(ctx, [[x + w * 0.04, ly + size * 1.7], [x + w * 0.96, ly + size * 1.7]]); ctx.stroke();
  });
  ctx.restore();
}

function wrapLines(ctx, text, max, lines) {
  const out = [];
  let cur = "";
  for (const word of String(text).split(/\s+/)) {
    const next = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(next).width > max && cur) { out.push(cur); cur = word; } else cur = next;
  }
  if (cur) out.push(cur);
  if (out.length > lines) { out.length = lines; out[lines - 1] += "…"; }
  return out;
}

function drawCard(ctx, sc, box, now, rgb, p) {
  const { x, y, w, h } = box;
  const fields = sc.fields || [];
  const size = Math.min(h / Math.max(9, fields.length * 2.2 + (sc.text ? 6 : 0)), w / 24);
  ctx.save();
  let ly = y + h * 0.08;
  fields.forEach(([k, v], i) => {
    const a = ease((p - i * 0.07) * 2.5);
    ctx.globalAlpha = Math.max(0, a);
    label(ctx, String(k).toUpperCase(), x + w * 0.05, ly + size, size * 0.8, `rgba(${rgb},0.8)`);
    ctx.font = `600 ${Math.round(size * 1.25)}px Rajdhani, sans-serif`;
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(235,252,255,0.97)";
    ctx.fillText(fit(ctx, String(v), w * 0.55), x + w * 0.95, ly + size * 1.05);
    ctx.strokeStyle = `rgba(${rgb},0.25)`;
    ctx.lineWidth = 1;
    line(ctx, [[x + w * 0.05, ly + size * 1.6], [x + w * 0.95, ly + size * 1.6]]); ctx.stroke();
    ly += size * 2.2;
  });
  if (sc.text) {
    ctx.globalAlpha = ease((p - 0.3) * 2);
    ctx.font = `300 ${Math.round(size)}px "Saira Semi Condensed", sans-serif`;
    ctx.fillStyle = "rgba(220,242,255,0.92)";
    ctx.textAlign = "left";
    const maxLines = Math.max(1, Math.floor((y + h - ly) / (size * 1.35)) - 1);
    wrapLines(ctx, sc.text, w * 0.9, maxLines).forEach((l, i) => ctx.fillText(l, x + w * 0.05, ly + size * (1.6 + i * 1.35)));
  }
  ctx.restore();
}

// ------------------------------------------------------------------ a camera
function drawCamera(ctx, sc, box, now, rgb, p, img) {
  const { x, y, w, h } = box;
  ctx.save();
  if (img && img.naturalWidth) {
    const s = Math.min(w / img.naturalWidth, h / img.naturalHeight);
    const iw = img.naturalWidth * s, ih = img.naturalHeight * s;
    const ix = x + (w - iw) / 2, iy = y + (h - ih) / 2;
    ctx.globalAlpha = ease(p * 1.5);
    ctx.drawImage(img, ix, iy, iw, ih);
    // Scan lines and a cool tint: a projection, not a TV.
    ctx.globalAlpha = 1;
    ctx.fillStyle = `rgba(${rgb},0.08)`;
    ctx.fillRect(ix, iy, iw, ih);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    for (let sy = iy; sy < iy + ih; sy += 3) ctx.fillRect(ix, sy, iw, 1);
    const sweep = iy + ((now / 2600) % 1) * ih;
    ctx.fillStyle = `rgba(${rgb},0.18)`;
    ctx.fillRect(ix, sweep, iw, 2);
    frame(ctx, ix, iy, iw, ih, rgb, 1, 0);
    const size = Math.max(10, ih / 22);
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(now / 300);
    ctx.beginPath(); ctx.arc(ix + size, iy + size * 1.2, size * 0.35, 0, Math.PI * 2); ctx.fillStyle = "#ff4d6a"; ctx.fill();
    ctx.globalAlpha = 1;
    label(ctx, "LIVE", ix + size * 1.7, iy + size * 1.5, size, "rgba(255,255,255,0.9)", "left", 500);
    label(ctx, sc.entity, ix + iw - size * 0.6, iy + ih - size * 0.6, size * 0.8, `rgba(${rgb},0.85)`, "right");
  } else {
    label(ctx, t("Collegamento alla telecamera…"), x + w / 2, y + h / 2, h / 16, `rgba(${rgb},${0.5 + 0.4 * Math.sin(now / 250)})`, "center");
  }
  ctx.restore();
}

// ------------------------------------------------------------------ entry point
// box: the panel's rectangle in the view; p: 0→1 while it appears (and back while it goes).
export function drawScene(ctx, sc, box, now, color, p, img) {
  ctx.textBaseline = "alphabetic";
  const rgb = color.map(Math.round).join(",");
  if (sc.kind !== "camera") frame(ctx, box.x, box.y, box.w, box.h, rgb, p, box.w / 24);
  const inner = { x: box.x + box.w * 0.03, y: box.y + box.h * 0.04, w: box.w * 0.94, h: box.h * 0.92 };
  ctx.save();
  ctx.textBaseline = "alphabetic";
  ctx.globalAlpha = Math.min(1, p * 1.5);
  if (sc.kind === "house") drawHouse(ctx, sc, inner, now, rgb, p);
  else if (sc.kind === "chart") drawChart(ctx, sc, inner, now, rgb, p);
  else if (sc.kind === "list") drawList(ctx, sc, inner, now, rgb, p);
  else if (sc.kind === "card") drawCard(ctx, sc, inner, now, rgb, p);
  else if (sc.kind === "camera") drawCamera(ctx, sc, box, now, rgb, p, img);
  ctx.restore();
}
