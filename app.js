'use strict';

const READY_SECS = 3;      // lead-in before set 1
const WARN_SECS = 3;       // beeps at 3, 2, 1 seconds left in a set
const DEFAULT_REST = 3;
const STORE_KEY = 'intervals.favs.v1';
const SETTINGS_KEY = 'intervals.settings.v1';

const $ = (id) => document.getElementById(id);

// ---------- Settings ----------
const DEFAULT_SETTINGS = { tick: false, half: false, voice: false, mix: false, volume: 0.8 };
function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY)) }; } catch { return { ...DEFAULT_SETTINGS }; }
}
let settings = loadSettings();
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
}
for (const k of ['tick', 'half', 'voice', 'mix']) {
  const el = $('opt-' + k);
  el.checked = settings[k];
  el.onchange = () => { settings[k] = el.checked; saveSettings(); if (k === 'mix') applyAudioSession(); };
}
$('opt-volume').value = Math.round(settings.volume * 100);
$('opt-volume').oninput = () => {
  settings.volume = Number($('opt-volume').value) / 100;
  saveSettings();
  if (master) master.gain.value = settings.volume;
};

// ---------- Favorites ----------
function loadFavs() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { return []; }
}
function saveFavs(favs) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(favs)); } catch {}
}
function fmtLen(s) {
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
}
function describe(c) {
  return `${fmtLen(c.secs)} × ${c.sets}` + (c.sets > 1 ? (c.rest ? ` · ${fmtLen(c.rest)} rest` : ' · no rest') : '');
}
function renderFavs() {
  const favs = loadFavs();
  const ul = $('favs');
  ul.replaceChildren();
  $('no-favs').hidden = favs.length > 0;
  favs.forEach((f, i) => {
    const cfg = { secs: f.secs, sets: f.sets, rest: f.rest ?? DEFAULT_REST };
    const li = document.createElement('li');
    li.className = 'fav';
    li.innerHTML = `
      <button class="fav-main"><div class="fav-name"></div><div class="fav-meta"></div></button>
      <div class="fav-actions"><button class="edit">Edit</button><button class="del">Delete</button></div>`;
    li.querySelector('.fav-name').textContent = f.name;
    li.querySelector('.fav-meta').textContent = describe(cfg);
    li.querySelector('.fav-main').onclick = () => start(cfg, f.name);
    li.querySelector('.edit').onclick = () => {
      $('secs').value = cfg.secs; $('sets').value = cfg.sets; $('rest').value = cfg.rest; $('fav-name').value = f.name;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    li.querySelector('.del').onclick = () => {
      if (li.dataset.confirm) {
        const all = loadFavs(); all.splice(i, 1); saveFavs(all); renderFavs();
      } else {
        li.dataset.confirm = '1';
        const b = li.querySelector('.del'); b.textContent = 'Sure?';
        setTimeout(() => { if (b.isConnected) { delete li.dataset.confirm; b.textContent = 'Delete'; } }, 3000);
      }
    };
    ul.appendChild(li);
  });
}

function readInputs() {
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v) || 0)));
  const secs = clamp($('secs').value, 1, 3600);
  const sets = clamp($('sets').value, 1, 99);
  const rest = clamp($('rest').value, 0, 600);
  $('secs').value = secs; $('sets').value = sets; $('rest').value = rest;
  return { secs, sets, rest };
}

document.querySelectorAll('[data-step]').forEach((b) => {
  b.onclick = () => {
    const input = $(b.dataset.step);
    const delta = Number(b.dataset.delta);
    const cur = Number(input.value) || 0;
    const min = Number(input.min);
    let v = cur + delta;
    // seconds stepper moves by 5, but steps by 1 below 5
    if (b.dataset.step === 'secs' && (v < 5 || cur < 5)) v = cur + Math.sign(delta);
    input.value = Math.max(min, v);
  };
});

$('save').onclick = () => {
  const cfg = readInputs();
  const name = $('fav-name').value.trim() || describe(cfg);
  const favs = loadFavs();
  const existing = favs.findIndex((f) => f.name.toLowerCase() === name.toLowerCase());
  const fav = { name, ...cfg };
  if (existing >= 0) favs[existing] = fav; else favs.push(fav);
  saveFavs(favs);
  $('fav-name').value = '';
  renderFavs();
};

$('start').onclick = () => start(readInputs(), '');

// ---------- Audio ----------
let ctx = null;
let master = null;
function applyAudioSession() {
  // 'playback' = plays through the silent switch but pauses other audio.
  // 'ambient'  = mixes with music/podcasts but is muted by the silent switch.
  try { if (navigator.audioSession) navigator.audioSession.type = settings.mix ? 'ambient' : 'playback'; } catch {}
}
function initAudio() {
  applyAudioSession();
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.connect(ctx.destination);
  }
  master.gain.value = settings.volume;
  if (ctx.state !== 'running') ctx.resume();
  tone(440, 0.02, 0.0001); // silent blip to unlock audio on iOS within the tap
  if (settings.voice && 'speechSynthesis' in window) {
    const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u);
  }
}
function tone(freq, dur, vol = 0.5, type = 'square', when = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(vol, t + 0.005);
  gain.gain.setValueAtTime(vol, t + Math.max(0.005, dur - 0.03));
  gain.gain.linearRampToValueAtTime(0, t + dur);
  osc.connect(gain).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}
const sound = {
  ready: () => tone(660, 0.15, 0.4, 'sine'),                                   // get-ready 3,2,1
  warn: () => tone(880, 0.12, 0.35),                                           // set ending 3,2,1
  half: () => { tone(1047, 0.08, 0.3, 'sine'); tone(1047, 0.08, 0.3, 'sine', 0.14); },
  tick: () => tone(1800, 0.03, 0.12, 'sine'),                                  // quiet each second
  rest: () => { tone(784, 0.18, 0.4, 'triangle'); tone(523, 0.3, 0.4, 'triangle', 0.2); }, // set over
  restTick: () => tone(392, 0.15, 0.4, 'triangle'),                            // rest countdown
  go: () => tone(1320, 0.45, 0.45),                                            // set starts
  done: () => { tone(784, 0.25, 0.4, 'square', 0); tone(988, 0.25, 0.4, 'square', 0.28); tone(1319, 0.7, 0.4, 'square', 0.56); },
};
function say(text) {
  if (!settings.voice || !('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.volume = settings.volume; u.rate = 1.05;
    speechSynthesis.speak(u);
  } catch {}
}

document.querySelectorAll('[data-test]').forEach((b) => {
  b.onclick = () => {
    initAudio();
    const k = b.dataset.test;
    if (k === 'voice') { const v = settings.voice; settings.voice = true; say('Set 2 of 5'); settings.voice = v; }
    else sound[k]();
  };
});

// ---------- Wake lock ----------
let wakeLock = null;
async function lockScreen() {
  try { if ('wakeLock' in navigator && !wakeLock) {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } } catch {}
}
function unlockScreen() { try { wakeLock && wakeLock.release(); } catch {} wakeLock = null; }

// ---------- Timer ----------
// Timeline: [ready] [set 1] [rest] [set 2] [rest] ... [set N]
let run = null;

function buildSegments({ secs, sets, rest }) {
  const segs = [{ type: 'ready', len: READY_SECS }];
  for (let i = 1; i <= sets; i++) {
    segs.push({ type: 'work', set: i, len: secs });
    if (i < sets && rest > 0) segs.push({ type: 'rest', set: i, len: rest });
  }
  let at = 0;
  for (const s of segs) { s.start = at; at += s.len; }
  return segs;
}

function start(cfg, name) {
  initAudio();
  lockScreen();
  if (run) clearInterval(run.timer);
  run = { cfg, name, segs: buildSegments(cfg), startedAt: performance.now(), pausedAt: null, pausedTotal: 0, last: null, timer: null };
  $('home').hidden = true;
  $('run').hidden = false;
  $('run-name').textContent = name || describe(cfg);
  $('pause').textContent = 'Pause';
  run.timer = setInterval(tick, 50);
  tick();
}

function elapsed() {
  const now = run.pausedAt ?? performance.now();
  return (now - run.startedAt - run.pausedTotal) / 1000;
}

// Where are we on the timeline at time t (seconds)? null = finished.
function position(t) {
  for (let i = 0; i < run.segs.length; i++) {
    const s = run.segs[i];
    if (t < s.start + s.len) return { i, seg: s, left: Math.ceil(s.start + s.len - t) };
  }
  return null;
}

function tick() {
  if (!run || run.finished) return;
  const p = position(elapsed());
  if (!p) { sound.done(); say('Done'); finish(); return; }
  const prev = run.last;
  if (prev && prev.i === p.i && prev.left === p.left) return;
  run.last = p;

  const s = p.seg;
  const entered = !prev || prev.i !== p.i;
  const N = run.cfg.sets;
  if (s.type === 'ready') {
    sound.ready();
    if (entered) say('Get ready');
  } else if (s.type === 'rest') {
    if (entered) { sound.rest(); say('Rest'); }
    else sound.restTick();
  } else { // work
    if (entered) { sound.go(); say(N > 1 ? `Set ${s.set} of ${N}` : 'Go'); }
    else if (p.left <= WARN_SECS) sound.warn();
    else if (settings.half && s.len >= 8 && p.left === Math.floor(s.len / 2)) sound.half();
    else if (settings.tick) sound.tick();
  }
  render(p);
}

function fmtClock(n) {
  return n >= 60 ? `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}` : String(n);
}

function render(p) {
  const s = p.seg;
  const N = run.cfg.sets;
  const cls = ['screen', s.type];
  if (s.type === 'work' && p.left <= WARN_SECS) cls.push('warning');
  if (run.pausedAt) cls.push('paused');
  $('run').className = cls.join(' ');
  $('phase').textContent = run.pausedAt ? 'Paused' : { ready: 'Get ready', work: 'Go', rest: 'Rest' }[s.type];
  $('clock').textContent = fmtClock(p.left);
  $('setinfo').textContent =
    s.type === 'ready' ? describe(run.cfg) :
    s.type === 'rest' ? `Next: set ${s.set + 1} of ${N}` :
    `Set ${s.set} of ${N}`;
}

function finish() {
  clearInterval(run.timer);
  run.finished = true;
  $('run').className = 'screen done';
  $('phase').textContent = 'Done';
  $('clock').textContent = '✓';
  $('setinfo').textContent = `${run.cfg.sets} × ${fmtLen(run.cfg.secs)} complete`;
  $('pause').textContent = 'Again';
  unlockScreen();
}

$('pause').onclick = () => {
  if (!run) return;
  if (run.finished) { start(run.cfg, run.name); return; }
  if (run.pausedAt) {
    initAudio();
    run.pausedTotal += performance.now() - run.pausedAt;
    run.pausedAt = null;
    $('pause').textContent = 'Pause';
    lockScreen();
  } else {
    run.pausedAt = performance.now();
    $('pause').textContent = 'Resume';
    try { speechSynthesis.cancel(); } catch {}
  }
  if (run.last) render(run.last);
};

$('stop').onclick = () => {
  if (run) clearInterval(run.timer);
  run = null;
  try { speechSynthesis.cancel(); } catch {}
  unlockScreen();
  $('run').hidden = true;
  $('home').hidden = false;
};

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && run && !run.finished) {
    if (ctx && ctx.state !== 'running') ctx.resume();
    if (!run.pausedAt) lockScreen();
  }
});

renderFavs();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
