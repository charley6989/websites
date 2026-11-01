/**
 * Тест реакции — игровая логика.
 *
 * Механика: появляется точка, игрок жмёт её как быстрее;
 * после каждого попадания следующая точка появляется РАНЬШЕ
 * и исчезает БЫСТРЕЕ предыдущей. Промедлил — игра окончена.
 * Результаты (топ-10) хранятся в localStorage, без базы данных.
 */
'use strict';

/* ================================================================
 * Конфигурация и формулы сложности
 * ================================================================ */

var CFG = {
  firstDelay: 700,        // пауза перед первой точкой после отсчёта, мс
  delayBase: 800,         // задержка перед появлением 1-й точки, мс
  delayFactor: 0.965,     // каждое попадание ускоряет появление
  delayMin: 120,          // предел ускорения появления, мс
  lifeBase: 1700,         // время жизни 1-й точки, мс
  lifeFactor: 0.97,       // каждое попадание ускоряет исчезновение
  lifeMin: 320,           // предел времени жизни, мс
  sizeBase: 74,           // диаметр 1-й точки, px
  sizeStep: 1.1,          // точка мельчает с каждым попаданием
  sizeMin: 34,
  countdownFrom: 3,
  countdownTick: 650,     // мс между цифрами отсчёта
  levelStep: 5,           // очков на уровень
  maxRecords: 10,
  storageKey: 'reactionGame.records.v1',
  muteKey: 'reactionGame.muted.v1'
};

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

/** Задержка перед следующей точкой — убывает с каждым попаданием. */
function delayFor(hits) {
  return Math.max(CFG.delayMin, Math.round(CFG.delayBase * Math.pow(CFG.delayFactor, hits)));
}
/** Время жизни точки — убывает с каждым попаданием. */
function lifeFor(hits) {
  return Math.max(CFG.lifeMin, Math.round(CFG.lifeBase * Math.pow(CFG.lifeFactor, hits)));
}
/** Диаметр точки — мельчает. */
function sizeFor(hits) {
  return Math.max(CFG.sizeMin, Math.round(CFG.sizeBase - CFG.sizeStep * hits));
}
/** Уровень сложности. */
function levelFor(hits) { return 1 + Math.floor(hits / CFG.levelStep); }

function avg(arr) {
  if (!arr.length) return null;
  var s = 0;
  for (var i = 0; i < arr.length; i++) s += arr[i];
  return Math.round(s / arr.length);
}

/* ================================================================
 * Хранилище результатов (localStorage, без базы)
 * ================================================================ */

function loadRecords() {
  try {
    var raw = JSON.parse(localStorage.getItem(CFG.storageKey));
    if (!Array.isArray(raw)) return [];
    return raw.filter(function (r) {
      return r && Number.isFinite(r.hits) && Number.isFinite(r.avg) && Number.isFinite(r.best);
    });
  } catch (e) {
    return [];
  }
}

function persistRecords(list) {
  try {
    localStorage.setItem(CFG.storageKey, JSON.stringify(list));
  } catch (e) { /* приватный режим и т.п. — просто играем без сохранения */ }
}

/**
 * Сохраняет результат, возвращает позицию в таблице (-1 — не попал).
 */
function saveRecord(rec) {
  rec.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  var list = loadRecords();
  list.push(rec);
  // Сортировка: больше очков — выше; при равенстве — быстрее средняя реакция
  list.sort(function (a, b) { return b.hits - a.hits || a.avg - b.avg; });
  var top = list.slice(0, CFG.maxRecords);
  persistRecords(top);
  for (var i = 0; i < top.length; i++) {
    if (top[i].id === rec.id) return i; // 0 = новый рекорд
  }
  return -1;
}

/* ================================================================
 * Звук (WebAudio, без файлов)
 * ================================================================ */

var audioCtx = null;
var muted = (function () {
  try { return localStorage.getItem(CFG.muteKey) === '1'; } catch (e) { return false; }
})();

function ensureAudio() {
  if (muted) return;
  try {
    if (!audioCtx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audioCtx = new AC();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) { audioCtx = null; }
}

function tone(freq, dur, type, gain, delay) {
  if (muted || !audioCtx) return;
  try {
    var t0 = audioCtx.currentTime + (delay || 0);
    var osc = audioCtx.createOscillator();
    var g = audioCtx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain || 0.05, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  } catch (e) { /* игнорируем сбой аудио */ }
}

var sfx = {
  tick:   function () { tone(440, 0.07, 'square', 0.035); },
  go:     function () { tone(660, 0.12, 'sine', 0.055); },
  hit:    function (n) {
    var base = 500 + Math.min(n, 40) * 9; // тон растёт со счётом
    tone(base, 0.06, 'sine', 0.05);
    tone(base * 1.5, 0.07, 'sine', 0.035, 0.045);
  },
  miss:   function () { tone(150, 0.35, 'sawtooth', 0.05); },
  record: function () {
    tone(523, 0.1, 'sine', 0.05);
    tone(659, 0.1, 'sine', 0.05, 0.1);
    tone(784, 0.16, 'sine', 0.05, 0.2);
  }
};

/* ================================================================
 * DOM
 * ================================================================ */

var $ = function (id) { return document.getElementById(id); };

var field = $('field');
var overlay = $('overlay');
var panels = {
  menu: $('panel-menu'),
  count: $('panel-count'),
  pause: $('panel-pause'),
  over: $('panel-over')
};
var countNum = $('count-num');

var hud = {
  score: $('hud-score'),
  level: $('hud-level'),
  last: $('hud-last'),
  avg: $('hud-avg'),
  best: $('best-score')
};

var overEls = {
  title: $('over-title'),
  flag: $('record-flag'),
  score: $('over-score'),
  level: $('over-level'),
  avg: $('over-avg'),
  best: $('over-best')
};

var recordsBody = $('records-body');
var recordsNote = $('records-note');
var muteBtn = $('mute-btn');

/* ================================================================
 * Состояние игры
 * ================================================================ */

var S = {
  mode: 'menu',       // menu | countdown | playing | paused | over
  resumeMode: null,   // куда возвращаться с паузы
  hits: 0,
  times: [],          // время реакции каждого попадания, мс
  lastRt: null,
  dot: null,          // активная точка { el, bornAt, u, v, size }
  lastPx: null,       // позиция прошлой точки (для равномерного разброса)
  cdShown: null       // текущая цифра отсчёта (для паузы)
};

/* --- Планировщик: один отложенный вызов, умеет паузироваться --- */

var pend = { id: null, fn: null, due: 0 };

function schedule(fn, ms) {
  clearPending();
  pend.fn = fn;
  pend.due = performance.now() + ms;
  pend.id = setTimeout(function () {
    pend.id = null;
    var f = pend.fn;
    pend.fn = null;
    if (f) f();
  }, ms);
}

function clearPending() {
  if (pend.id !== null) { clearTimeout(pend.id); pend.id = null; }
  pend.fn = null;
}

/** «Замораживает» текущий таймер, возвращает остаток мс. */
function freezePending() {
  if (pend.id === null) return 0;
  var rest = Math.max(0, pend.due - performance.now());
  clearTimeout(pend.id);
  pend.id = null;
  var fn = pend.fn;
  pend.fn = null;
  pend.rest = rest;
  pend.frozenFn = fn;
  return rest;
}

/** Возобновляет замороженный таймер. */
function thawPending() {
  if (pend.id === null && pend.frozenFn) {
    var fn = pend.frozenFn;
    pend.frozenFn = null;
    schedule(fn, pend.rest || 0);
  }
}

/* ================================================================
 * Оверлеи, HUD, таблица
 * ================================================================ */

function showPanel(name) {
  for (var k in panels) panels[k].hidden = (k !== name);
  overlay.hidden = (name === null);
}

function updateHud() {
  hud.score.textContent = S.hits;
  hud.level.textContent = levelFor(S.hits);
  hud.last.textContent = S.lastRt !== null ? S.lastRt + ' мс' : '—';
  var a = avg(S.times);
  hud.avg.textContent = a !== null ? a + ' мс' : '—';
  var recs = loadRecords();
  hud.best.textContent = recs.length ? recs[0].hits : 0;
}

function formatDate(t) {
  try {
    return new Date(t).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  } catch (e) { return '—'; }
}

function renderRecords(justSavedId) {
  var list = loadRecords();
  recordsBody.innerHTML = '';
  recordsNote.hidden = list.length > 0;

  list.forEach(function (r, i) {
    var tr = document.createElement('tr');
    if (i === 0) tr.className = 'top1';
    if (justSavedId && r.id === justSavedId) tr.className += ' just-saved';

    var rank = document.createElement('td');
    rank.className = 'rank';
    rank.textContent = i + 1;

    var date = document.createElement('td');
    date.textContent = formatDate(r.t);

    var hits = document.createElement('td');
    hits.className = 'num';
    hits.textContent = r.hits;

    var level = document.createElement('td');
    level.textContent = r.level;

    var a = document.createElement('td');
    a.textContent = r.avg;

    var b = document.createElement('td');
    b.textContent = r.best;

    tr.appendChild(rank); tr.appendChild(date); tr.appendChild(hits);
    tr.appendChild(level); tr.appendChild(a); tr.appendChild(b);
    recordsBody.appendChild(tr);
  });
}

/* ================================================================
 * Игровой процесс
 * ================================================================ */

function resetRun() {
  clearPending();
  removeDot();
  S.hits = 0;
  S.times = [];
  S.lastRt = null;
  S.lastPx = null;
  S.cdShown = null;
  updateHud();
}

function startGame() {
  if (S.mode === 'countdown' || S.mode === 'playing' || S.mode === 'paused') return;
  ensureAudio();
  resetRun();
  S.mode = 'countdown';
  runCountdown(CFG.countdownFrom);
}

/** Отсчёт 3–2–1, затем первая точка. */
function runCountdown(n) {
  S.cdShown = n;
  showPanel('count');
  if (n > 0) {
    countNum.textContent = n;
    sfx.tick();
    schedule(function () { runCountdown(n - 1); }, CFG.countdownTick);
  } else {
    countNum.textContent = 'Старт';
    sfx.go();
    schedule(beginPlay, 500);
  }
}

function beginPlay() {
  showPanel(null);
  S.mode = 'playing';
  schedule(spawnDot, CFG.firstDelay);
}

/** Следующая точка: появляется раньше и живёт меньше предыдущей. */
function spawnDot() {
  if (S.mode !== 'playing') return;

  var rect = field.getBoundingClientRect();
  var size = sizeFor(S.hits);
  var margin = size / 2 + 12;
  var w = rect.width, h = rect.height;

  // Равномерный разброс: не ближе 1.5 диаметров к прошлой точке
  var u = 0.5, v = 0.5, x = 0, y = 0;
  for (var tries = 0; tries < 20; tries++) {
    u = Math.random();
    v = Math.random();
    x = clamp(margin + u * (w - 2 * margin), margin, Math.max(margin, w - margin));
    y = clamp(margin + v * (h - 2 * margin), margin, Math.max(margin, h - margin));
    if (!S.lastPx) break;
    var dx = x - S.lastPx.x, dy = y - S.lastPx.y;
    if (Math.sqrt(dx * dx + dy * dy) > size * 1.5) break;
  }

  var el = document.createElement('button');
  el.type = 'button';
  el.className = 'dot';
  el.setAttribute('aria-label', 'Точка — жми!');
  el.style.width = size + 'px';
  el.style.height = size + 'px';
  placeDot(el, x, y);
  field.appendChild(el);

  var life = lifeFor(S.hits);
  S.dot = { el: el, bornAt: performance.now(), u: u, v: v, size: size, x: x, y: y };
  S.lastPx = { x: x, y: y };

  try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }

  schedule(onExpire, life);
}

function placeDot(el, x, y) {
  el.style.left = x + 'px';
  el.style.top = y + 'px';
}

function removeDot() {
  if (S.dot && S.dot.el && S.dot.el.parentNode) S.dot.el.parentNode.removeChild(S.dot.el);
  S.dot = null;
}

/** Попадание: замеряем реакцию, ускоряем следующую точку. */
function hit() {
  if (S.mode !== 'playing' || !S.dot) return;

  var rt = Math.round(performance.now() - S.dot.bornAt);
  var pos = { x: S.dot.x, y: S.dot.y, size: S.dot.size };

  clearPending();
  removeDot();

  S.hits++;
  S.times.push(rt);
  S.lastRt = rt;

  spawnBurst(pos);
  sfx.hit(S.hits);
  updateHud();

  // Следующая точка появляется раньше предыдущей
  schedule(spawnDot, delayFor(S.hits));
}

/** Точка не была нажата вовремя — промах, конец игры. */
function onExpire() {
  if (!S.dot) return;
  var pos = { x: S.dot.x, y: S.dot.y, size: S.dot.size };
  removeDot();
  spawnMissMark(pos);
  sfx.miss();
  gameOver();
}

function gameOver() {
  clearPending();
  S.mode = 'over';

  var a = avg(S.times);
  var best = S.times.length ? Math.min.apply(null, S.times) : null;
  var level = levelFor(S.hits);

  var savedIndex = -1;
  var savedId = null;
  if (S.hits > 0) {
    var rec = { t: Date.now(), hits: S.hits, level: level, avg: a, best: best };
    savedIndex = saveRecord(rec);
    savedId = rec.id;
  }

  // Панель итогов
  overEls.title.textContent = savedIndex === 0 ? 'Новый рекорд!' : 'Игра окончена';
  if (savedIndex === 0) {
    overEls.flag.hidden = false;
    overEls.flag.textContent = '🏆 Это лучший результат';
    sfx.record();
  } else if (savedIndex > 0) {
    overEls.flag.hidden = false;
    overEls.flag.textContent = 'Попал в таблицу: #' + (savedIndex + 1);
  } else {
    overEls.flag.hidden = true;
  }

  overEls.score.textContent = S.hits;
  overEls.level.textContent = level;
  overEls.avg.textContent = a !== null ? a + ' мс' : '—';
  overEls.best.textContent = best !== null ? best + ' мс' : '—';

  showPanel('over');
  renderRecords(savedId);
  updateHud();
  var againBtn = $('again-btn');
  if (againBtn) { try { againBtn.focus({ preventScroll: true }); } catch (e) { againBtn.focus(); } }
}

function toMenu() {
  resetRun();
  S.mode = 'menu';
  showPanel('menu');
  var startBtn = $('start-btn');
  if (startBtn) { try { startBtn.focus({ preventScroll: true }); } catch (e) { startBtn.focus(); } }
}

/* --- Пауза: замораживает таймер появления/исчезновения точки --- */

var pauseStartedAt = 0;

function togglePause() {
  if (S.mode === 'playing' || S.mode === 'countdown') {
    S.resumeMode = S.mode;
    freezePending();
    pauseStartedAt = performance.now();
    S.mode = 'paused';
    showPanel('pause');
    var r = $('resume-btn');
    if (r) { try { r.focus({ preventScroll: true }); } catch (e) { r.focus(); } }
  } else if (S.mode === 'paused') {
    S.mode = S.resumeMode || 'playing';
    // Компенсируем время паузы в замере реакции
    if (S.dot) S.dot.bornAt += performance.now() - pauseStartedAt;
    thawPending();
    if (S.mode === 'playing') {
      showPanel(null);
      if (S.dot) { try { S.dot.el.focus({ preventScroll: true }); } catch (e) { S.dot.el.focus(); } }
    } else {
      showPanel('count');
      countNum.textContent = S.cdShown;
    }
  }
}

/* --- Эффекты --- */

function spawnBurst(pos) {
  var b = document.createElement('div');
  b.className = 'burst';
  b.style.width = b.style.height = pos.size + 'px';
  b.style.left = pos.x + 'px';
  b.style.top = pos.y + 'px';
  field.appendChild(b);
  setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 400);
}

function spawnMissMark(pos) {
  var m = document.createElement('div');
  m.className = 'miss-mark';
  m.textContent = '✕';
  m.style.left = pos.x + 'px';
  m.style.top = pos.y + 'px';
  field.appendChild(m);
  setTimeout(function () { if (m.parentNode) m.parentNode.removeChild(m); }, 650);
}

/* ================================================================
 * Ввод: мышь/тач, клавиатура, ресайз
 * ================================================================ */

// Клик/тап по точке (pointerdown — минимальная задержка)
field.addEventListener('pointerdown', function (e) {
  var dot = e.target.closest ? e.target.closest('.dot') : null;
  if (dot) {
    e.preventDefault();
    hit();
  }
}, { passive: false });

// Клик, порождённый клавиатурой (Enter/Space на кнопке-точке)
field.addEventListener('click', function (e) {
  var dot = e.target.closest ? e.target.closest('.dot') : null;
  if (dot) hit();
});

// Меню контекстного меню на поле (долгое нажатие на мобильных)
field.addEventListener('contextmenu', function (e) { e.preventDefault(); });

window.addEventListener('keydown', function (e) {
  // Старт: пробел/ввод в меню или в итогах
  if ((S.mode === 'menu' || S.mode === 'over') &&
      (e.code === 'Space' || e.code === 'Enter') && e.target === document.body) {
    e.preventDefault();
    if (!e.repeat) startGame();
    return;
  }
  // Пауза: Esc или P
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (S.mode === 'playing' || S.mode === 'countdown' || S.mode === 'paused') {
      e.preventDefault();
      togglePause();
    }
    return;
  }
  // Не даём пробелу скроллить страницу во время игры
  if (e.code === 'Space' && S.mode === 'playing') e.preventDefault();
});

// Кнопки интерфейса
$('start-btn').addEventListener('click', startGame);
$('again-btn').addEventListener('click', startGame);
$('resume-btn').addEventListener('click', togglePause);
$('restart-btn').addEventListener('click', function () {
  resetRun();
  S.mode = 'menu';
  startGame();
});
$('menu-btn').addEventListener('click', toMenu);
$('menu-btn-2').addEventListener('click', toMenu);
$('pause-btn').addEventListener('click', togglePause);

$('clear-btn').addEventListener('click', function () {
  if (!confirm('Удалить все сохранённые результаты?')) return;
  try { localStorage.removeItem(CFG.storageKey); } catch (e) { /* нет хранилища */ }
  renderRecords();
  updateHud();
});

// Звук
function renderMuteBtn() {
  muteBtn.textContent = muted ? '🔇' : '🔊';
  muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
}
muteBtn.addEventListener('click', function () {
  muted = !muted;
  try { localStorage.setItem(CFG.muteKey, muted ? '1' : '0'); } catch (e) { /* нет хранилища */ }
  if (!muted) { ensureAudio(); sfx.tick(); }
  renderMuteBtn();
});

// Ресайз: переставляем активную точку, чтобы она не уехала за край
window.addEventListener('resize', function () {
  if (!S.dot) return;
  var rect = field.getBoundingClientRect();
  var size = S.dot.size;
  var margin = size / 2 + 12;
  var x = clamp(margin + S.dot.u * (rect.width - 2 * margin), margin, Math.max(margin, rect.width - margin));
  var y = clamp(margin + S.dot.v * (rect.height - 2 * margin), margin, Math.max(margin, rect.height - margin));
  S.dot.x = x; S.dot.y = y;
  placeDot(S.dot.el, x, y);
});

// Страница скрыта — автоматическая пауза (чтобы не «проигрывать» в фоне)
document.addEventListener('visibilitychange', function () {
  if (document.hidden && (S.mode === 'playing' || S.mode === 'countdown')) togglePause();
});

/* ================================================================
 * Инициализация
 * ================================================================ */

renderMuteBtn();
renderRecords();
updateHud();
showPanel('menu');
