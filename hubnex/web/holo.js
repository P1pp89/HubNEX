// The hologram: Jarvis' core alone on black, for a Pepper's ghost reflector on the table
// (a sheet of plexiglass at 45° over a screen lying face up, or a four-sided pyramid).
// The smart speaker is the ears and the voice; this page is the face: it follows the voice
// satellite (listening, thinking, speaking), what Jarvis is doing, and shows what the speaker
// heard and what Jarvis answers. When the request is about something to look at, a
// "blueprint" takes the stage (holo-blueprint.js): the floor plan with the rooms and devices
// involved, a camera, a chart, a list, a card.
//
// Options in the address:
//   layout=single   one view (default): plexiglass sheet at 45°, or a holographic display
//   layout=pyramid  four views around the centre, for the four-sided pyramid
//   mirror=0        do not mirror (default mirrored: the reflection mirrors it back)
//   rotate=180      turn the view (single), when it comes out upside down
//   invert=1        pyramid: the views' bottom edge towards the outside instead of the centre
//   sat=assist_satellite.kitchen   follow only this speaker (default: any)
//   token=…         HQ token, outside Home Assistant
import { Orb, describeTool } from "./orb.js";
import { t, LANG, LOCALE } from "./i18n.js";
import { drawScene } from "./holo-blueprint.js";

const Q = new URLSearchParams(location.search);
const LAYOUT = Q.get("layout") === "pyramid" ? "pyramid" : "single";
const MIRROR = Q.get("mirror") !== "0";
const ROTATE = ((Number(Q.get("rotate")) || 0) * Math.PI) / 180;
const INVERT = Q.get("invert") === "1";
const SAT = Q.get("sat") || "";

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
const token = Q.get("token") || safeGet("hq_token") || "";
if (Q.get("token")) safeSet("hq_token", token);

const canvas = document.getElementById("holo");
const ctx = canvas.getContext("2d");
const orb = new Orb(document.getElementById("orb-src"));
const msgEl = document.getElementById("msg");
orb.show("idle", "");

// ------------------------------------------------------------------ what is going on
const S = {
  bossId: "jarvis",
  sat: "idle",       // the speaker: idle | wake_word | listening | processing | responding
  boss: "sleeping",  // Jarvis: sleeping | thinking | writing | working | searching | error
  bossDetail: null,
  text: "",          // what the speaker heard, or Jarvis' answer
  textKind: "",      // "heard" | "reply"
  textStart: 0,
  textUntil: 0,      // when the text fades away
  speakUntil: 0,     // answer spoken without a satellite (Assist in the app): speak this long
  scene: null,       // the blueprint on stage (floor plan, camera, chart, list, card)
  sceneStart: 0,
  sceneUntil: 0,
  mix: 0,            // 0 = the core alone, 1 = core small and the blueprint on stage
};

const SCENE_MS = 45000; // a blueprint stays this long after the last word about it

// The camera on stage: a fresh frame every 2 seconds.
const camImg = new Image();
let camTimer = null;
function watchCamera(entity) {
  clearInterval(camTimer);
  camTimer = null;
  if (!entity) return;
  const load = () => {
    const next = new Image();
    next.onload = () => { camImg.src = next.src; };
    next.src = `api/casa/camera/${encodeURIComponent(entity)}?token=${encodeURIComponent(token)}&t=${Date.now()}`;
  };
  camImg.removeAttribute("src");
  load();
  camTimer = setInterval(load, 2000);
}

function setScene(scene) {
  if (!scene || scene.kind === "clear") { S.sceneUntil = performance.now(); return; }
  const same = S.scene && S.scene.kind === scene.kind && S.scene.title === scene.title && performance.now() < S.sceneUntil;
  S.scene = scene;
  if (!same) S.sceneStart = performance.now(); // a new blueprint draws itself again
  S.sceneUntil = performance.now() + SCENE_MS;
  watchCamera(scene.kind === "camera" ? scene.entity : null);
}

const SAT_BUSY = new Set(["listening", "processing", "responding"]);

// One place decides the orb's state from the speaker (first) and Jarvis (then).
function update() {
  const now = performance.now();
  let state = "idle", caption = "";
  if (S.sat === "listening") state = "listening";
  else if (S.sat === "processing") state = "thinking";
  else if (S.sat === "responding" || now < S.speakUntil) state = "speaking";
  else if (S.boss === "thinking") state = "thinking";
  else if (S.boss === "writing") { state = "thinking"; caption = t("Formulo la risposta…"); }
  else if (S.boss === "working" || S.boss === "searching") { state = "working"; caption = describeTool(S.bossDetail) || ""; }
  if (state !== orb.state || (caption && caption !== orb.captionEl.textContent)) orb.show(state, caption || undefined);
}

function setText(kind, text) {
  S.text = String(text || "").replace(/\s+/g, " ").trim();
  S.textKind = kind;
  S.textStart = performance.now();
  // Long enough to read (or to be said: about 14 characters a second), then it fades.
  S.textUntil = S.textStart + Math.max(6000, (S.text.length / (kind === "reply" ? 14 : 30)) * 1000 + 5000);
}

function onEvent(ev) {
  if (ev.type === "snapshot") {
    S.bossId = ev.state?.boss?.id || S.bossId;
    const boss = ev.state?.agents?.find((a) => a.id === S.bossId);
    if (boss) { S.boss = boss.status; S.bossDetail = boss.detail; }
  } else if (ev.type === "agent" && ev.agent?.id === S.bossId) {
    S.boss = ev.agent.status;
    S.bossDetail = ev.agent.detail;
  } else if (ev.type === "satellite") {
    if (SAT && ev.e !== SAT) return;
    const prev = S.sat;
    S.sat = ev.state || "idle";
    if (S.sat === "listening" && prev !== "listening") S.text = ""; // a new question: clean slate
    if (S.sat === "responding") S.speakUntil = 0;
  } else if (ev.type === "holo") {
    setScene(ev.scene);
    return;
  } else if (ev.type === "ha") {
    // A device on the floor plan changed: its state follows live.
    const it = S.scene?.items?.find((i) => i.id === ev.e);
    if (it && ev.v) it.state = ev.v.s;
    return;
  } else if (ev.type === "voice") {
    setText(ev.phase, ev.text);
    // Assist without a speaker entity (the app, a browser): pretend to speak for a while.
    if (ev.phase === "reply" && !SAT_BUSY.has(S.sat)) S.speakUntil = performance.now() + Math.min(20000, 1500 + (S.text.length / 14) * 1000);
  } else return;
  update();
}

// ------------------------------------------------------------------ live connection
let retry = 1000;
function connect() {
  const url = new URL("ws", location.href);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  url.search = `?token=${encodeURIComponent(token)}&holo=1`;
  const ws = new WebSocket(url);
  ws.onopen = () => { retry = 1000; note(""); };
  ws.onmessage = (m) => { try { onEvent(JSON.parse(m.data)); } catch { /* not for us */ } };
  ws.onclose = (e) => {
    if (e.code === 4401) { note(t("Token mancante o errato: apri la pagina con ?token=…")); return; }
    setTimeout(connect, retry);
    retry = Math.min(retry * 2, 15000);
  };
}

function note(text, ms = 0) {
  msgEl.textContent = text;
  msgEl.classList.toggle("on", !!text);
  if (ms) setTimeout(() => { if (msgEl.textContent === text) note(""); }, ms);
}

// ------------------------------------------------------------------ drawing
let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(devicePixelRatio || 1, 2);
  W = innerWidth; H = innerHeight;
  canvas.width = W * DPR; canvas.height = H * DPR;
}
addEventListener("resize", resize);
resize();

function wrap(text, maxWidth, maxLines) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > maxWidth && line) { lines.push(line); line = w; } else line = next;
  }
  if (line) lines.push(line);
  // Too long: the last lines are the ones being said.
  return lines.length > maxLines ? lines.slice(lines.length - maxLines) : lines;
}

function glowText(text, x, y, color, blur) {
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 0;
}

const lerp = (a, b, m) => a + (b - a) * m;

// One view, drawn in a v×v box centred on the origin, the right way up. With a blueprint on
// stage the core steps aside (small, top left) and the panel takes the middle.
function drawView(v, now) {
  const [r, g, b] = orb.color.map(Math.round);
  const m = S.mix;
  const bob = Math.sin(now / 1400) * v * 0.012; // it floats
  const orbSize = v * lerp(0.62, 0.17, m);
  const orbX = -v * lerp(0, 0.37, m);
  const orbY = v * lerp(-0.14, -0.38, m) + bob;
  ctx.drawImage(orb.canvas, orbX - orbSize / 2, orbY - orbSize / 2, orbSize, orbSize);

  ctx.textBaseline = "middle";
  const caption = orb.captionEl.textContent;

  if (S.scene && m > 0.01) {
    // The blueprint's title next to the small core, the state under it.
    const tx = orbX + orbSize / 2 + v * 0.02;
    ctx.globalAlpha = m;
    ctx.textAlign = "left";
    ctx.font = `600 ${Math.round(v * 0.05)}px Rajdhani, sans-serif`;
    ctx.letterSpacing = `${(v * 0.004).toFixed(1)}px`;
    ctx.fillStyle = "rgba(235,252,255,0.97)";
    glowText(String(S.scene.title || "").toUpperCase().slice(0, 40), tx, orbY - v * 0.018, `rgba(${r},${g},${b},0.9)`, v * 0.02);
    ctx.font = `500 ${Math.round(v * 0.026)}px Rajdhani, sans-serif`;
    ctx.fillStyle = `rgba(${r},${g},${b},0.9)`;
    ctx.fillText((caption || "").toUpperCase(), tx, orbY + v * 0.03);
    ctx.letterSpacing = "0px";
    const p = Math.min(1, (now - S.sceneStart) / 1400) * m;
    drawScene(ctx, S.scene, { x: -v * 0.46, y: -v * 0.27, w: v * 0.92, h: v * 0.6 }, now, orb.color, p, camImg);
    ctx.globalAlpha = 1;
  }

  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  const solo = 1 - m;
  let y = orbY + orbSize / 2 + v * 0.03;
  // The state under the big core ("In ascolto…", "Cerco sul web…").
  if (caption && solo > 0.01) {
    ctx.globalAlpha = solo;
    ctx.font = `600 ${Math.round(v * 0.036)}px Rajdhani, sans-serif`;
    ctx.letterSpacing = `${(v * 0.006).toFixed(1)}px`;
    ctx.fillStyle = `rgba(${r},${g},${b},0.95)`;
    glowText(caption.toUpperCase(), 0, y, `rgba(${r},${g},${b},0.9)`, v * 0.02);
    ctx.letterSpacing = "0px";
    ctx.globalAlpha = 1;
  }
  y = lerp(y + v * 0.06, v * 0.39, m);

  // What the speaker heard (in quotes), or Jarvis' answer typed in step with his voice.
  if (S.text && now < S.textUntil) {
    const fade = Math.min(1, (S.textUntil - now) / 1200);
    let shown = S.text;
    if (S.textKind === "reply") shown = S.text.slice(0, Math.ceil(((now - S.textStart) / 1000) * 16));
    if (S.textKind === "heard") shown = `“${shown}”`;
    const size = Math.round(v * lerp(0.038, 0.03, m));
    ctx.font = `${S.textKind === "heard" ? "italic 300" : "400"} ${size}px "Saira Semi Condensed", sans-serif`;
    ctx.fillStyle = S.textKind === "heard" ? `rgba(200,230,255,${0.75 * fade})` : `rgba(230,250,255,${0.95 * fade})`;
    wrap(shown, v * 0.88, m > 0.5 ? 3 : 4).forEach((line, i) => glowText(line, 0, y + i * size * 1.3, `rgba(${r},${g},${b},${0.7 * fade})`, v * 0.015));
  } else if (orb.state === "idle" && solo > 0.01) {
    // At rest: the time, faint, under the core.
    const time = new Date().toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });
    ctx.globalAlpha = solo;
    ctx.font = `500 ${Math.round(v * 0.07)}px Rajdhani, sans-serif`;
    ctx.fillStyle = `rgba(${r},${g},${b},0.45)`;
    glowText(time, 0, y + v * 0.02, `rgba(${r},${g},${b},0.6)`, v * 0.02);
    ctx.globalAlpha = 1;
  }
}

function placeView(x, y, rot, v, now) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  if (MIRROR) ctx.scale(-1, 1);
  drawView(v, now);
  ctx.restore();
}

function frame(now) {
  requestAnimationFrame(frame);
  // Voice levels for the orb: the speaker's audio is not here, so it pulses on its own.
  if (orb.state === "speaking") orb.synthetic = 0.2 + 0.45 * Math.abs(Math.sin(now / 70) * Math.sin(now / 190));
  else if (orb.state === "listening") orb.synthetic = 0.12 + 0.25 * Math.abs(Math.sin(now / 90) * Math.sin(now / 230));
  if (S.speakUntil && now > S.speakUntil) { S.speakUntil = 0; update(); }
  // The blueprint stays while Jarvis talks about it, then fades and the core returns.
  if (S.scene && orb.state !== "idle") S.sceneUntil = Math.max(S.sceneUntil, now + 20000);
  const on = S.scene && now < S.sceneUntil;
  S.mix += ((on ? 1 : 0) - S.mix) * 0.06;
  if (!on && S.scene && S.mix < 0.01) { S.scene = null; watchCamera(null); }

  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2;
  if (LAYOUT === "pyramid") {
    // The classic cross: four views around an empty centre, bottom edge towards it.
    const v = Math.min(W, H) / 3;
    const flip = INVERT ? Math.PI : 0;
    placeView(cx, cy - v, flip, v, now);                 // top
    placeView(cx + v, cy, Math.PI / 2 + flip, v, now);   // right
    placeView(cx, cy + v, Math.PI + flip, v, now);       // bottom
    placeView(cx - v, cy, -Math.PI / 2 + flip, v, now);  // left
  } else {
    placeView(cx, cy, ROTATE, Math.min(W, H), now);
  }
}
requestAnimationFrame(frame);

// ------------------------------------------------------------------ a screen that stays on
let lock = null;
async function keepAwake() {
  try { if (!lock && document.visibilityState === "visible") { lock = await navigator.wakeLock.request("screen"); lock.addEventListener("release", () => { lock = null; }); } } catch { /* not supported */ }
}
document.addEventListener("visibilitychange", keepAwake);
keepAwake();

// A tap: full screen (the browser only allows it after a gesture).
addEventListener("click", () => { document.documentElement.requestFullscreen?.().catch(() => {}); keepAwake(); });
if (!document.fullscreenElement) note(t("Tocca per lo schermo intero"), 5000);
document.documentElement.lang = LANG;

connect();
