'use strict';

// ── Constants ──────────────────────────────────────────────────────────────
const PRONOUNS    = ['je', 'tu', 'il/elle', 'nous', 'vous', 'ils/elles'];
const STORAGE_KEY = 'francais_progress_v1';
const REPEAT_SOON   = 3;
const REPEAT_NORMAL = 50;

// ── State ──────────────────────────────────────────────────────────────────
let data          = null;
let activeTopic   = null;   // 'conditionnel' | 'conditionnel_passe' | 'mixte'
let phrases       = [];     // active phrase list
let progress      = {};
let cardNum       = 0;
let queue         = [];
let cur           = null;
let step          = 0;
let phraseHadError = false;
let sessionCorrect = 0;
let sessionErrors  = 0;
let sessionStreak  = 0;

// ── DOM refs ───────────────────────────────────────────────────────────────
const elSelector  = document.getElementById('topic-selector');
const elMain      = document.getElementById('main-area');
const elPBWrap    = document.getElementById('progress-bar-wrap');
const elPhrase    = document.getElementById('phrase-text');
const elHint      = document.getElementById('blank-hint');
const elGrid      = document.getElementById('choices-grid');
const elProgress  = document.getElementById('progress-bar');
const elStreak    = document.getElementById('streak-val');
const elScore     = document.getElementById('score-val');
const elErrors    = document.getElementById('errors-val');
const elTopicTitle= document.getElementById('topic-title');
const elOverlayDone= document.getElementById('overlay-done');
const elCycleStats = document.getElementById('cycle-stats');
const elOverlayMenu= document.getElementById('overlay-menu');
const elGlobalStats= document.getElementById('global-stats');
const elTopicTabs  = document.getElementById('topic-tabs');

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  try {
    data = await fetch('data/phrases.json').then(r => r.json());
  } catch(e) {
    document.body.innerHTML = '<div style="color:#ff5252;padding:40px;font-family:sans-serif">Erreur de chargement : ' + e.message + '<br><br><a href="javascript:location.reload()" style="color:#4fc3f7">Réessayer</a></div>';
    return;
  }
  loadProgress();
  showSelector();

  // Topic selector buttons
  document.querySelectorAll('.ts-card').forEach(btn => {
    btn.addEventListener('click', () => selectTopic(btn.dataset.topic));
  });

  // Tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => selectTopic(btn.dataset.topic));
  });

  document.getElementById('btn-next').addEventListener('click', () => {
    document.getElementById('btn-next').classList.add('hidden');
    onPhraseCorrect(cur.id);
  });
  document.getElementById('btn-menu').addEventListener('click', openMenu);
  document.getElementById('btn-close-menu').addEventListener('click', closeMenu);
  document.getElementById('btn-change-topic').addEventListener('click', () => { closeMenu(); showSelector(); });
  document.getElementById('btn-continue').addEventListener('click', () => {
    elOverlayDone.classList.add('hidden');
    buildQueue();
    nextPhrase();
  });
  document.getElementById('btn-reset-progress').addEventListener('click', () => {
    if (confirm('Réinitialiser toute la progression ?')) {
      progress = {}; cardNum = 0;
      saveProgress();
      closeMenu();
      buildQueue();
      nextPhrase();
    }
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(regs => {
      regs.forEach(r => r.unregister());
    }).then(() => {
      navigator.serviceWorker.register('sw.js?v=12').catch(() => {});
    });
  }
}

// ── Topic selection ────────────────────────────────────────────────────────
function showSelector() {
  elSelector.style.display  = '';
  elMain.style.display      = 'none';
  elPBWrap.style.display    = 'none';
  elTopicTabs.style.display = 'none';
  elStreak.textContent = '0';
  elScore.textContent  = '0';
  elErrors.textContent = '0';
}

function selectTopic(topicId) {
  try {
    activeTopic = topicId;

    if (topicId === 'mixte') {
      phrases = [
        ...data.topics.conditionnel.phrases.map(p => ({ ...p, _topicId: 'conditionnel' })),
        ...data.topics.conditionnel_passe.phrases.map(p => ({ ...p, _topicId: 'conditionnel_passe' }))
      ];
      elTopicTitle.textContent = 'Les deux · Conditionnel';
    } else {
      const topic = data.topics[topicId];
      phrases = topic.phrases.map(p => ({ ...p, _topicId: topicId }));
      elTopicTitle.textContent = topic.title;
    }

    sessionCorrect = 0; sessionErrors = 0; sessionStreak = 0;
    updateHeaderStats();

    elSelector.style.display  = 'none';
    elMain.style.display      = 'flex';
    elPBWrap.style.display    = '';
    elTopicTabs.style.display = '';
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.topic === topicId);
    });

    buildQueue();
    nextPhrase();
  } catch(e) {
    document.body.innerHTML = '<div style="color:#ff5252;padding:40px;font-family:sans-serif;font-size:14px">Erreur: ' + e.message + '<br><br><a href="javascript:location.reload()" style="color:#4fc3f7">Recharger</a></div>';
  }
}

// ── Progress persistence ───────────────────────────────────────────────────
function loadProgress() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    cardNum  = raw._cardNum || 0;
    progress = raw.phrases  || {};
  } catch { progress = {}; cardNum = 0; }
}

function saveProgress() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ _cardNum: cardNum, phrases: progress }));
}

function getPhraseProg(id) {
  return progress[id] || { attempts: 0, errors: 0, nextDue: 0 };
}

// ── Queue management ───────────────────────────────────────────────────────
function buildQueue() {
  const due = [], later = [];
  for (const p of phrases) {
    const pg = getPhraseProg(p.id);
    (pg.nextDue <= cardNum ? due : later).push(p.id);
  }
  due.sort((a, b) => errorRate(b) - errorRate(a));
  shuffle(due);
  if (due.length === 0) {
    later.sort((a, b) => getPhraseProg(a).nextDue - getPhraseProg(b).nextDue);
    due.push(...later.splice(0, Math.min(5, later.length)));
  }
  queue = due;
}

function errorRate(id) {
  const pg = getPhraseProg(id);
  return pg.attempts > 0 ? pg.errors / pg.attempts : 0;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function onPhraseCorrect(id) {
  const pg = getPhraseProg(id);
  pg.attempts = (pg.attempts || 0) + 1;
  pg.nextDue  = cardNum + (pg.errors / pg.attempts > 0.4 ? REPEAT_SOON : REPEAT_NORMAL);
  progress[id] = pg;
  cardNum++;
  saveProgress();
  queue.shift();
  if (queue.length === 0) showCycleDone();
  else nextPhrase();
}

function onPhraseError(id) {
  const pg = getPhraseProg(id);
  pg.errors = (pg.errors || 0) + 1;
  progress[id] = pg;
  saveProgress();
  const head = queue.shift();
  queue.splice(Math.min(REPEAT_SOON - 1, queue.length), 0, head);
}

// ── Phrase rendering ───────────────────────────────────────────────────────
function nextPhrase() {
  if (queue.length === 0) buildQueue();
  const id = queue[0];
  cur  = phrases.find(p => p.id === id);
  step = 0;
  phraseHadError = false;
  renderPhrase();
  renderHint();
  renderChoices();
  updateProgressBar();
  updateGrammarSchema();
}

function updateGrammarSchema() {
  const el = document.getElementById('grammar-schema');
  if (!el) return;
  const topicId = cur._topicId || activeTopic;
  if (topicId === 'conditionnel') {
    el.innerHTML =
      'Si + <span class="gs-tense">imparfait</span>' +
      ' &rarr; <span class="gs-tense">conditionnel présent</span>';
  } else {
    el.innerHTML =
      'Si + <span class="gs-tense">plus-que-parfait</span>' +
      ' &rarr; <span class="gs-tense">conditionnel passé</span>' +
      '<div class="gs-sub">(avoir / être + p.p.) &rarr; (avoir / être + p.p.)</div>';
  }
}

function renderPhrase() {
  const inf1 = cur.blanks[0].verb;
  const inf2 = cur.blanks[1].verb;
  let html = escapeHtml(cur.text);
  html = html.replace(/\{1\}/g,
    `<span id="blank-1" class="blank active"> <em class="binf">(${inf1})</em> </span>`);
  html = html.replace(/\{2\}/g,
    `<span id="blank-2" class="blank locked"> <em class="binf">(${inf2})</em> </span>`);
  const tr = cur.translation ? `<div class="phrase-translation">${escapeHtml(cur.translation)}</div>` : '';
  elPhrase.innerHTML = html + tr;
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function setBlankText(spanId, text, cls) {
  const el = document.getElementById(spanId);
  if (el) { el.textContent = text; el.className = `blank ${cls}`; }
}

function getBlankLabels() {
  const topicId = cur._topicId || activeTopic;
  return data.topics[topicId].blankLabels;
}

function renderHint() {
  const blank  = cur.blanks[step];
  const labels = getBlankLabels();
  elHint.innerHTML = `<strong>${labels[step]}</strong> · ${PRONOUNS[blank.person]}`;
}

// ── Choices ────────────────────────────────────────────────────────────────
function renderChoices() {
  const blank   = cur.blanks[step];
  const correct = getForm(blank.verb, blank.tense, blank.person);
  const distractor = getDistractor(blank, correct);
  const opts = [correct, distractor];
  shuffle(opts);

  elGrid.innerHTML = '';
  elGrid.className = 'choices-2';
  opts.forEach(opt => {
    const btn = document.createElement('button');
    btn.className   = 'choice-btn';
    btn.textContent = opt;
    btn.addEventListener('click', () => onChoice(btn, opt, correct));
    elGrid.appendChild(btn);
  });
}

function getForm(verb, tense, person) {
  return data.verbs[verb].formes[tense][person];
}

function getDistractor(blank, correct) {
  // Always contrast imparfait ↔ conditionnel, same verb & person
  const otherTense = blank.tense === 'imparfait' ? 'conditionnel' : 'imparfait';
  const candidate  = getForm(blank.verb, otherTense, blank.person);
  // Fallback: if forms happen to be identical, try another person
  if (candidate === correct) {
    const otherPerson = blank.person === 0 ? 2 : 0;
    return getForm(blank.verb, otherTense, otherPerson);
  }
  return candidate;
}

// ── Interaction ────────────────────────────────────────────────────────────
function onChoice(btn, chosen, correct) {
  const allBtns = elGrid.querySelectorAll('.choice-btn');

  if (chosen === correct) {
    btn.classList.add('correct');
    allBtns.forEach(b => b.disabled = true);
    sessionCorrect++;
    sessionStreak++;
    updateHeaderStats();

    if (step === 0) {
      setBlankText('blank-1', correct, 'correct');
      setTimeout(() => {
        step = 1;
        const inf2 = cur.blanks[1].verb;
        const el2 = document.getElementById('blank-2');
        if (el2) { el2.className = 'blank active'; el2.innerHTML = ` <em class="binf">(${inf2})</em> `; }
        renderHint();
        renderChoices();
      }, 400);
    } else {
      setBlankText('blank-2', correct, 'correct');
      elGrid.innerHTML = '';
      elHint.innerHTML = '';
      document.getElementById('btn-next').classList.remove('hidden');
    }
  } else {
    btn.classList.add('wrong');
    sessionErrors++;
    sessionStreak = 0;
    updateHeaderStats();
    if (!phraseHadError) { phraseHadError = true; onPhraseError(cur.id); }
    setTimeout(() => { btn.classList.remove('wrong'); btn.disabled = false; }, 600);
  }
}

// ── Stats & UI ─────────────────────────────────────────────────────────────
function updateHeaderStats() {
  elStreak.textContent = sessionStreak;
  elScore.textContent  = sessionCorrect;
  elErrors.textContent = sessionErrors;
}

function updateProgressBar() {
  const total = phrases.length;
  const done  = phrases.filter(p => {
    const pg = getPhraseProg(p.id);
    return pg.attempts > 0 && pg.nextDue > cardNum;
  }).length;
  elProgress.style.width = `${Math.round((done / total) * 100)}%`;
}

// ── Cycle done overlay ─────────────────────────────────────────────────────
function showCycleDone() {
  const hard = phrases.filter(p => errorRate(p.id) > 0.4).length;
  elCycleStats.innerHTML =
    `<strong>${phrases.length}</strong> phrases parcourues · ` +
    `<strong>${hard}</strong> à retravailler · ` +
    `Série max : <strong>${sessionStreak}</strong>`;
  elOverlayDone.classList.remove('hidden');
}

// ── Menu overlay ───────────────────────────────────────────────────────────
function openMenu() {
  const total    = phrases.length;
  const seen     = phrases.filter(p => getPhraseProg(p.id).attempts > 0).length;
  const hard     = phrases.filter(p => errorRate(p.id) > 0.4).length;
  const totalAtt = phrases.reduce((s, p) => s + getPhraseProg(p.id).attempts, 0);
  const totalErr = phrases.reduce((s, p) => s + getPhraseProg(p.id).errors, 0);
  const pct = totalAtt > 0 ? Math.round((1 - totalErr / totalAtt) * 100) + ' %' : '—';

  elGlobalStats.innerHTML =
    `<div>Phrases vues : <strong>${seen} / ${total}</strong></div>` +
    `<div>Phrases difficiles : <strong>${hard}</strong></div>` +
    `<div>Précision globale : <strong>${pct}</strong></div>` +
    `<div>Cartes jouées : <strong>${cardNum}</strong></div>`;

  elOverlayMenu.classList.remove('hidden');
}

function closeMenu() { elOverlayMenu.classList.add('hidden'); }

// ── Boot ───────────────────────────────────────────────────────────────────
init();
