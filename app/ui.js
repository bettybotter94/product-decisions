import { EPISODES, CASES, byId, variantsOf, keyMetric } from '../scenarios/index.js';
import { createSession, openSource, commitAction, step, checkpointNote,
         pendingCheckpoint, fingerprint, finish } from '../engine/session.js';
import { evaluateContract } from '../engine/contracts.js';
import { buildDebrief } from '../engine/debrief.js';
import { loadProfile, saveProfile, summarise, addRun, profileCalibration, trend, byCase }
  from '../engine/profile.js';

/**
 * Ступени самостоятельности по модели SSDL (Grow, 1991).
 * Смысл модели: беда не в том, что помощи много или мало, а в том, что она
 * не совпадает со ступенью. Зависимому ученику при самостоятельном режиме —
 * растерянность; самостоятельному при опеке — раздражение.
 * Поэтому объём интерфейса и подсказок здесь не настройка «для красоты»,
 * а то, что должно совпадать с человеком.
 */
const STAGES = [
  { n: 1, name: 'Веду за руку',
    who: 'первый раз в тренажёре',
    what: 'На каждом шаге написано, что делать. Перед решением — вопросы, ' +
          'которые стоит себе задать. Лишние экраны спрятаны.' },
  { n: 2, name: 'Подсказываю, если спросишь',
    who: 'проходил раз-другой',
    what: 'Подсказки есть, но открывать их надо самому. Появляются графики: ' +
          'видно, как показатель шёл по неделям.' },
  { n: 3, name: 'Не мешаю',
    who: 'знаешь, как это устроено',
    what: 'Ни подсказок, ни вопросов перед решением. Только ситуация, ' +
          'источники и твой контракт.' }
];
const STAGE_KEY = 'antilopa:stage';

/* ---------- состояние ---------- */
const CUR = 'antilopa:current';
const runKey = id => `antilopa:run:${id}`;

let scenario = byId(localStorage.getItem(CUR)) || EPISODES[0];
let session = loadRun(scenario) || createSession(scenario);
let profile = loadProfile();
// Если заход уже начат — открываемся на нём, а не на списке эпизодов:
// человек продолжает работу, а не выбирает её заново.
let stage = Number(localStorage.getItem(STAGE_KEY)) || 0; // 0 — ступень ещё не выбрана
let tab = 'welcome';
let formError = null;
let noteDraft = { confidence: '', note: '' };
let draft = blankDraft();
if (stage && session.journal.length) tab = 'situation';
else if (stage) tab = 'episodes';

function blankDraft() {
  return { actionId: '', hypothesisId: '', expectation: '', metricId: '',
           direction: 'down', target: '', confidence: 60, dueWeek: '' };
}
let staleRunNotice = null;

function loadRun(sc) {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(runKey(sc.id))); } catch { return null; }
  if (!saved) return null;
  // Содержание переписали, а в браузере остался незаконченный заход:
  // доигрывать его нельзя — половина хода прошла по старым правилам.
  if (saved.scenarioFingerprint !== fingerprint(sc)) {
    try { localStorage.removeItem(runKey(sc.id)); } catch { /* приватное окно */ }
    if (saved.journal?.length) staleRunNotice = sc.id;
    return null;
  }
  return saved;
}
/**
 * Начать всё заново: забыть ступень, незаконченные заходы и историю.
 * Нужна именно кнопка: иначе единственный способ — лезть в хранилище браузера.
 */
function resetEverything() {
  if (!confirm(
    'Начать с самого начала?\n\n' +
    'Сотрётся всё: выбранная ступень, незаконченные заходы и история ' +
    'пройденных прогонов. Это нельзя отменить.'
  )) return;
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('antilopa:')) localStorage.removeItem(k);
    }
  } catch { /* приватное окно */ }
  stage = 0;
  scenario = EPISODES[0];
  session = createSession(scenario);
  profile = loadProfile();
  compared = [];
  staleRunNotice = null;
  draft = blankDraft();
  formError = null;
  tab = 'situation';
  render();
}

function setStage(n) {
  stage = n;
  try { localStorage.setItem(STAGE_KEY, String(n)); } catch { /* приватное окно */ }
  const allowed = tabsFor().map(t => t[0]);
  if (!allowed.includes(tab)) tab = 'episodes';
  render();
}

function save() {
  try {
    localStorage.setItem(runKey(scenario.id), JSON.stringify(session));
    localStorage.setItem(CUR, scenario.id);
  } catch { /* приватное окно */ }
}
function pick(sc, { restart = false } = {}) {
  scenario = sc;
  session = (!restart && loadRun(sc)) || createSession(sc);
  draft = blankDraft(); formError = null;
  tab = 'situation';
  save(); render();
}

/* ---------- мелочи ---------- */
const el = (t, a = {}, ...kids) => {
  const n = document.createElement(t);
  for (const [k, v] of Object.entries(a)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== false && v !== undefined) n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) n.append(kid.nodeType ? kid : String(kid));
  return n;
};
const fmt = (id, v) => v === undefined ? '—' : Number(v).toFixed(scenario.metrics[id].decimals);
const pct = x => x === null || x === undefined ? '—' : Math.round(x * 100) + '%';
/** «1 неделя, 2 недели, 5 недель» — иначе интерфейс выглядит машинным. */
const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
};
const wk = n => `${n} ${plural(n, 'неделя', 'недели', 'недель')}`;

function evaluated() {
  return session.contracts.map(c =>
    session.world.week >= c.dueWeek ? evaluateContract(c, session.world, scenario)
                                  : { ...c, verdict: 'pending' });
}
const atCheckpoint = () => pendingCheckpoint(session, scenario);
function recordRun(d) {
  if (session.recorded) return;
  profile = addRun(profile, summarise(session, scenario, d));
  saveProfile(profile);
  session.recorded = true;
  save();
}

/**
 * Ход показателя по неделям — крошечный график прямо в шапке.
 * Это не скрытые сведения: свою приборную панель продакт видит всегда.
 * Скрыты причины, а не след метрики.
 */
function sparkline(metricId) {
  if (stage < 2) return null;
  const h = session.world.history;
  if (h.length < 3) return null;
  const vals = h.map(x => x.metrics[metricId]);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 1e-9) return null;

  const W = 104, H = 26, pad = 2;
  const x = i => pad + (i / (vals.length - 1)) * (W - pad * 2);
  const y = v => H - pad - ((v - lo) / (hi - lo)) * (H - pad * 2);
  const d = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');

  const better = scenario.metrics[metricId].better;
  const moved = vals[vals.length - 1] - vals[0];
  const good = (moved < 0) === (better === 'down');
  const stroke = Math.abs(moved) < 1e-9 ? 'var(--muted)' : good ? 'var(--ok)' : 'var(--warn)';

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'spark');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label',
    `ход показателя: от ${vals[0].toFixed(1)} до ${vals[vals.length - 1].toFixed(1)}`);

  const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  line.setAttribute('d', d);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', stroke);
  line.setAttribute('stroke-width', '1.5');
  line.setAttribute('stroke-linejoin', 'round');
  svg.append(line);

  const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  dot.setAttribute('cx', x(vals.length - 1).toFixed(1));
  dot.setAttribute('cy', y(vals[vals.length - 1]).toFixed(1));
  dot.setAttribute('r', '2');
  dot.setAttribute('fill', stroke);
  svg.append(dot);

  return svg;
}

/* ---------- что делать прямо сейчас ---------- */
/**
 * Одна подсказка на весь экран: что от человека требуется в этот момент.
 * Без неё шапка выглядит приборной панелью, с которой непонятно, что делать.
 * Порядок проверок — от самого срочного к обычному ходу игры.
 */
function nextStep() {
  if (stage >= 3) return null;
  const notStarted = !session.journal.length && session.world.week === 0;

  if (session.finished || session.world.week >= scenario.horizonWeeks) {
    return { text: 'Эпизод кончился. Разбор — то, ради чего всё это и делалось.',
             tab: 'debrief', label: 'Открыть разбор' };
  }
  if (atCheckpoint()) return null; // об этом говорит отдельная жёлтая карточка

  if (notStarted) {
    return tab === 'situation'
      ? { text: 'Прочитал — теперь запрашивай сведения. Каждый запрос стоит недель, ' +
                'открыть всё не получится.',
          tab: 'sources', label: 'К источникам' }
      : { text: 'Начни с ситуации: там сказано, что произошло и какие версии ' +
                'называют вокруг.',
          tab: 'situation', label: 'Читать ситуацию' };
  }

  const last = session.contracts[session.contracts.length - 1];

  if (!last) {
    return session.openedSources.length
      ? { text: 'Когда поймёшь, что происходит, — зафиксируй решение. Действие без контракта не принимается.',
          tab: 'decision', label: 'К решению' }
      : { text: 'Запроси сведения. Каждый запрос стоит недель, открыть всё не получится.',
          tab: 'sources', label: 'К источникам' };
  }

  if (last.dueWeek <= session.world.week) {
    return { text: `Срок, который ты назначил, наступил — посмотри, сбылся признак или нет.`,
             tab: 'contracts', label: 'К контрактам' };
  }

  return { text: `Ты назначил срок на ${last.dueWeek}-ю неделю. Прокручивай время ` +
                 'кнопками «+1 неделя» и «+4 недели» — или запроси ещё сведений, ' +
                 'если чего-то не хватает.',
           tab: null };
}

/* ---------- шапка ---------- */
function header() {
  const start = session.world.history[0].metrics;
  const metrics = Object.entries(scenario.metrics).map(([id, m]) => {
    const now = session.world.metrics[id];
    const d = Number(fmt(id, now)) - Number(fmt(id, start[id]));
    const good = (m.better === 'down') === (d < 0);
    return el('div', { class: 'metric', title: m.hint || '' },
      el('b', {}, fmt(id, now)), el('span', {}, m.label),
      Math.abs(d) > 1e-9 ? el('span', { class: 'delta ' + (good ? 'good' : 'bad') },
        (d > 0 ? '+' : '') + fmt(id, d) + ' с начала') : null,
      sparkline(id));
  });

  const blocked = session.finished || !!atCheckpoint();
  const left = scenario.horizonWeeks - session.world.week;
  const step1 = nextStep();

  return el('div', {},
    el('div', { class: 'bar' },
      el('div', { class: 'grow' },
        el('h1', {}, scenario.title),
        el('div', { class: 'sub' },
          el('span', { title: 'Ради чего этот эпизод вообще существует' },
            'Тренируем: ' + scenario.targetBehaviour.toLowerCase()),
          el('span', { class: 'dot' }, ' · '),
          el('span', { title:
            'Вариантов три. Рамка у них одна, а факты и настоящая причина ' +
            'разные — поэтому второй заход меряет суждение, а не память.' },
            `вариант ${scenario.variant} из ${variantsOf(scenario.caseId).length}`),
          session.finished ? el('span', {}, ' · прогон завершён') : null),
        el('p', { class: 'goal' }, el('b', {}, 'Задача: '), scenario.goal),

        el('div', { class: 'counters' },
          el('div', { class: 'counter wide-counter' },
            el('b', {}, `Неделя ${session.world.week} из ${scenario.horizonWeeks}`),
            el('span', {},
              left > 0
                ? `До отчёта ${wk(left)}. Это весь ресурс: время уходит ` +
                  'и на запросы, и на работу команды, и на ожидание, пока она подействует.'
                : 'Время вышло, отчёт сегодня.'))),

        el('h3', { class: 'mhead' }, 'Как дела в компании сейчас'),
        el('div', { class: 'metrics' }, metrics)),

      el('div', { class: 'timebox' },
        el('div', { class: 'kind' }, 'прокрутить время'),
        el('button', { class: 'ghost', disabled: blocked,
          onclick: () => { step(session, scenario, 1); save(); render(); } }, '+1 неделя'),
        el('button', { class: 'ghost', disabled: blocked,
          onclick: () => { step(session, scenario, 4); save(); render(); } }, '+4 недели'),
        el('div', { class: 'note', style: 'border:0;padding:0;margin-top:6px;max-width:150px' },
          'Время идёт и само, когда запрашиваешь сведения'))),

    step1 ? el('div', { class: 'nextstep' },
      el('span', { class: 'now' }, 'Сейчас'),
      el('span', { class: 'what' }, step1.text),
      step1.tab && step1.tab !== tab
        ? el('button', { class: 'act', onclick: () => { tab = step1.tab; render(); } }, step1.label)
        : null) : null);
}

/* ---------- контрольная точка ---------- */
function checkpointBanner() {
  const week = atCheckpoint();
  if (!week) return null;
  const due = evaluated().filter(c => c.dueWeek <= week);
  const passed = session.world.week > week;
  return el('div', { class: 'panel stop checkpoint-card' },
    el('h2', {}, `Контрольная точка: ${week}-я неделя`),
    el('p', { class: 'sub' },
      (passed
        ? `Сейчас ${session.world.week}-я неделя: запрос сведений занял больше времени, ` +
          'чем оставалось до точки, и она прошла на ходу. '
        : 'Время остановилось само. ') +
      'Это не оценка — здесь ничего не считается. Скажи, что ты думаешь ' +
      'сейчас, и двигайся дальше.'),
    due.length ? el('div', { class: 'sub' },
      'Сроки, которые уже наступили: ' +
      due.map(c => `${c.verdict === 'met' ? 'сбылось' : 'не сбылось'} (${c.dueWeek}-я неделя)`).join(', ')) : null,
    el('label', {}, 'Насколько ты сейчас уверен в своей версии, %'),
    el('input', { type: 'number', min: 1, max: 99, placeholder: 'от 1 до 99',
      value: noteDraft.confidence,
      oninput: e => { noteDraft.confidence = e.target.value === '' ? '' : Number(e.target.value);
                      render(); } }),
    el('label', {}, 'Что изменилось с прошлого раза (по желанию)'),
    el('textarea', { oninput: e => { noteDraft.note = e.target.value; } }, noteDraft.note),
    el('div', { style: 'margin-top:12px' },
      el('button', { class: 'act', disabled: noteDraft.confidence === '', onclick: () => {
        const r = checkpointNote(session, { ...noteDraft, forCheckpoint: week });
        if (!r.ok) { formError = r.reason; } else { noteDraft = { confidence: '', note: '' }; }
        save(); render();
      } }, 'Записать и продолжить'),
      noteDraft.confidence === ''
        ? el('span', { class: 'sub', style: 'margin-left:10px' },
            'Число нужно назвать: по нему потом считается калибровка.')
        : null));
}

/* ---------- первый экран ---------- */
function stageCards(onPick) {
  return el('div', { class: 'stages' }, STAGES.map(st => el('button', {
    class: 'stage' + (stage === st.n ? ' on' : ''),
    onclick: () => onPick(st.n)
  },
    el('b', {}, `${st.n}. ${st.name}`),
    el('span', { class: 'who' }, st.who),
    el('span', { class: 'what' }, st.what))));
}

function welcome() {
  return el('div', {},
    el('div', { class: 'panel' },
      el('h1', { style: 'font-size:23px;margin-bottom:8px' }, 'Тренажёр продуктовых решений'),
      el('p', {},
        'Ты продакт. Случилось что-то непонятное: метрика поехала, клиент ' +
        'угрожает уйти, запуск не дал результата. Вокруг называют несколько ' +
        'версий, почему так. У тебя три месяца до отчёта — и это весь ресурс: ' +
        'время уходит и на то, чтобы разобраться, и на саму работу.'),
      el('h3', {}, 'Эпизод занимает 20–30 минут и устроен так'),
      el('ol', { class: 'howto' },
        el('li', {}, el('b', {}, 'Запрашиваешь сведения. '),
          'Каждый запрос отъедает недели от тех же трёх месяцев. На все ' +
          'источники времени заведомо не хватит — выбирать придётся.'),
        el('li', {}, el('b', {}, 'Фиксируешь решение вместе с контрактом. '),
          'Что, по-твоему, происходит; что изменится, если ты прав; по какому ' +
          'признаку это будет видно; насколько ты уверен; к какой неделе.'),
        el('li', {}, el('b', {}, 'Крутишь время и разбираешь. '),
          'Смотришь, сбылось ли то, что записал. Разбор — это и есть главное: ' +
          'симулятор нужен, чтобы было что разбирать.')),
      el('div', { class: 'note' },
        'Мир живёт по правилам, записанным до того, как ты вошёл. Они не ' +
        'подстраиваются под тебя и не читают твой контракт. Поэтому «сбылось» ' +
        'здесь значит ровно то, что значит.')),

    el('div', { class: 'panel' },
      el('h2', {}, 'Из чего он состоит'),
      el('p', { class: 'sub' },
        'Три ситуации. Они различаются не сюжетом, а тем, какое действие ' +
        'тренируют — то есть чему именно учат.'),
      el('table', {},
        el('tr', {}, el('th', {}, 'Ситуация'), el('th', {}, 'Чему учит')),
        CASES.map(c => el('tr', {},
          el('td', {}, c.title.replace(/^Кейс \d+\.\s*/, '')),
          el('td', {}, c.about.toLowerCase())))),
      el('p', { style: 'margin-top:12px' },
        'У каждой ситуации по три варианта. Рамка в них одна: те же ' +
        'объяснения, те же источники, те же возможные действия.'),
      el('p', {},
        el('b', {}, 'А факты и настоящая причина — разные, '),
        'и в каждом варианте срабатывает своё действие. Поэтому второй ' +
        'заход меряет суждение, а не память: устройство ты уже знаешь, ' +
        'ответ — нет.'),
      el('div', { class: 'note' },
        'В первой ситуации, например, руководитель продаж во всех трёх ' +
        'вариантах говорит дословно одно и то же — и прав ровно один раз ' +
        'из трёх.')),

    el('div', { class: 'panel' },
      el('h2', {}, 'Сколько помощи тебе сейчас нужно'),
      el('p', { class: 'sub' },
        'Это не уровень сложности. По модели SSDL (Grow, 1991) учение ломается ' +
        'не от избытка или недостатка помощи, а от несовпадения: зависимому ' +
        'ученику при полной свободе — растерянность, самостоятельному ' +
        'при опеке — раздражение. Ступень можно сменить в любой момент.'),
      stageCards(n => { setStage(n); tab = 'episodes'; render(); }),
      stage ? el('div', { style: 'margin-top:14px' },
        el('button', { class: 'act', onclick: () => { tab = 'episodes'; render(); } },
          'Вернуться к эпизодам')) : null,
      el('div', { class: 'note' },
        'Ступень меняет только подсказки. Экраны появляются сами, когда ' +
        'на них есть что показать: журнал — после первого решения, прогресс ' +
        'и сравнение — после первого пройденного эпизода. ' +
        'Четвёртой ступени по Гроу — принести свой рабочий случай вместо ' +
        'учебного — здесь пока нет.')));
}

/**
 * Почему кнопки не нажимаются. Без этого блока человек видит просто
 * мёртвый интерфейс: запрет объявлен наверху экрана, а руки — внизу.
 */
function blockedNotice() {
  const week = atCheckpoint();
  if (!week) return null;
  return el('div', { class: 'blocked' },
    el('span', {},
      'Кнопки не работают, потому что время остановилось на контрольной ' +
      `точке (${week}-я неделя). Ни запросить, ни решить нельзя, пока ` +
      'не отметишься — даже то, что ничего не стоит.'),
    el('button', { class: 'ghost', onclick: () => {
      const card = document.querySelector('.checkpoint-card');
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.querySelector('input')?.focus();
      }
    } }, 'К отметке'));
}

/* ---------- эпизоды ---------- */
function episodes() {
  return el('div', {},
    el('div', { class: 'panel' },
      el('h2', {}, 'Сколько помощи сейчас нужно'),
      stageCards(n => setStage(n)),
      el('div', { class: 'note' },
        el('button', { class: 'ghost', onclick: resetEverything },
          'Начать с самого начала'),
        el('span', { style: 'margin-left:10px' },
          'вернёт на первый экран и сотрёт все заходы и историю'))),
    CASES.map(c => el('div', { class: 'panel' },
      el('h2', {}, c.title),
      el('div', { class: 'sub' }, 'Целевое действие: ' + c.about),
      el('table', {},
        el('tr', {}, el('th', {}, 'Вариант'), el('th', {}, 'Что внутри'),
          el('th', {}, 'Прогоны'), el('th', {}, '')),
        variantsOf(c.id).map(sc => {
          const runs = profile.runs.filter(r => r.scenarioId === sc.id);
          const saved = loadRun(sc);
          const inProgress = saved && !saved.finished && saved.journal?.length;
          return el('tr', {},
            el('td', {}, sc.variant + (sc.id === scenario.id ? ' ·' : '')),
            el('td', {}, sc.title),
            el('td', {}, runs.length ? String(runs.length) : '—'),
            el('td', {},
              el('button', { class: 'ghost', onclick: () => pick(sc) },
                inProgress ? 'Продолжить' : runs.length ? 'Ещё раз' : 'Начать'),
              runs.length || inProgress
                ? el('button', { class: 'ghost', style: 'margin-left:6px',
                    onclick: () => pick(sc, { restart: true }) }, 'С нуля')
                : null));
        })),
      el('div', { class: 'note' },
        variantsOf(c.id).length > 1
          ? 'Варианты устроены одинаково, но факты и настоящая причина в них разные. ' +
            'Проходить один и тот же вариант второй раз можно — но это уже проверка ' +
            'памяти, а не суждения. Прогресс смотри на новом варианте.'
          : 'Вариант пока один. Второй заход в него будет проверкой памяти, ' +
            'а не суждения: ты уже знаешь ответ.'))),
    el('div', { class: 'panel' },
      el('h2', {}, 'Чего здесь пока нет'),
      el('ul', {},
        el('li', {}, 'Живых диалогов: собеседники отвечают заранее написанным текстом'),
        el('li', {}, 'Связки кейсов: третий кейс пока не подхватывает исход твоего ' +
          'собственного решения из первых двух')),
      el('div', { class: 'note' },
        'Это не список недоделок «на потом», а честная рамка: чего этот ' +
        'тренажёр пока не делает.')));
}

/* ---------- ситуация ---------- */
function situation() {
  return el('div', {},
    el('div', { class: 'panel' },
      el('h2', {}, 'Ситуация'),
      scenario.context ? el('p', { class: 'sub' }, scenario.context) : null,
      el('p', {}, scenario.brief),
      el('h3', {}, 'Версии, которые называют вокруг'),
      el('ul', {}, scenario.hypotheses.map(h => el('li', {}, h.label))),
      el('div', { class: 'note' },
        'Какие из этих версий ещё живы, а какие уже отпали, здесь не показано ' +
        'намеренно. Это и есть работа.')),

    el('div', { class: 'panel' },
      el('h2', {}, 'Что значат слова и числа'),
      el('table', {},
        Object.entries(scenario.metrics).map(([id, m]) => el('tr', {},
          el('td', { style: 'white-space:nowrap' }, el('b', {}, m.label)),
          el('td', {}, m.hint || '—'))),
        (scenario.terms || []).map(t => el('tr', {},
          el('td', { style: 'white-space:nowrap' }, el('b', {}, t.term)),
          el('td', {}, t.plain)))),
      el('div', { class: 'note' },
        'Числа в шапке — всё, что видно про состояние компании. ' +
        'Причины ни одно из них не объясняет: за этим в «Источники».')));
}

/* ---------- источники ---------- */
function sources() {
  const blocked = session.finished || !!atCheckpoint();
  const rows = scenario.sources.map(s => {
    const open = session.openedSources.includes(s.id);
    const kind = { data: 'данные', doc: 'документ', person: 'человек' }[s.kind];
    return el('div', { class: 'src' },
      el('div', { class: 't' },
        el('div', { class: 'kind' }, kind + (s.purpose === 'execution' ? ' · о выполнимости' : '')),
        el('div', {}, s.label),
        open ? el('div', { class: 'content' }, s.content) : null),
      el('div', { class: 'cost' }, open ? 'открыто' : (s.costWeeks ? wk(s.costWeeks) : 'бесплатно')),
      open ? null
        : session.world.week + s.costWeeks > scenario.horizonWeeks
          ? el('div', { class: 'cost', style: 'color:var(--warn)' }, 'не успеть')
          : el('button', { class: 'ghost', disabled: blocked, onclick: () => {
              const r = openSource(session, scenario, s.id);
              formError = r.ok ? null : r.reason;
              save(); render();
            } }, 'Запросить'));
  });
  const stopper = blockedNotice();
  const total = scenario.sources.reduce((n, s) => n + s.costWeeks, 0);
  const costs = scenario.actions.map(a => a.costWeeks).filter(c => c > 0);
  const delays = scenario.rules.flatMap(r => r.effects.map(e => e.afterWeeks));
  const range = (a, b) => a === b ? wk(a) : `${a}–${b} ${plural(b, 'неделю', 'недели', 'недель')}`;

  return el('div', { class: 'panel' },
    el('h2', {}, 'Что можно запросить'),
    stopper,
    el('div', { class: 'sub' },
      `До отчёта ${wk(scenario.horizonWeeks)}. Запросить здесь всё — ` +
      `это ${wk(total)} из них. Сама работа потом занимает ` +
      `${range(Math.min(...costs), Math.max(...costs))}, а результат виден ещё ` +
      `через ${range(Math.min(...delays), Math.max(...delays))} после её начала.`),
    el('div', { class: 'sub', style: 'margin-top:6px' },
      el('b', {}, 'Сложи: узнать всё и успеть починить нельзя. '),
      'Решать придётся, не зная всего — вопрос только в том, ' +
      'чего именно ты решишь не узнавать.'),
    el('div', { style: 'margin-top:10px' }, rows),
    stopper,
    formError ? el('div', { class: 'err' }, formError) : null);
}

/* ---------- решение ---------- */
function decision() {
  const set = (k, v) => { draft[k] = v; };
  const blocked = session.finished || !!atCheckpoint();
  const known = session.openedSources
    .map(id => scenario.sources.find(x => x.id === id))
    .filter(Boolean);

  const recap = el('details', { class: 'recap block' },
    el('summary', {}, known.length
      ? `Что ты уже знаешь — ${known.length} ${plural(known.length, 'источник', 'источника', 'источников')}`
      : 'Пока ничего не запрошено'),
    known.length
      ? known.map(s2 => el('details', { class: 'recap' },
          el('summary', {}, s2.label),
          el('div', { class: 'content' }, s2.content)))
      : el('p', { class: 'sub' },
          'Решение без единого запроса — допустимый ход, ' +
          'и он будет виден на разборе.'));

  return el('div', { class: 'panel' },
    el('h2', {}, 'Решение'),
    blockedNotice(),
    recap,
    beforeYouDecide(),
    el('div', { class: 'sub' },
      'Действие фиксируется только вместе с контрактом. Пункты 3–5 обязательны: ' +
      'без наблюдаемого признака и срока сверить будет не с чем.'),

    el('label', {}, 'Действие'),
    el('select', { onchange: e => { set('actionId', e.target.value); render(); } },
      el('option', { value: '' }, '— выбери —'),
      scenario.actions.map(a => el('option',
        { value: a.id, selected: draft.actionId === a.id,
          disabled: session.world.week + a.costWeeks > scenario.horizonWeeks },
        `${a.label} · ${wk(a.costWeeks)}` +
        (session.world.week + a.costWeeks > scenario.horizonWeeks ? ' — не успеть' : '')))),

    costHint(),

    el('label', {}, '1. Гипотеза: что, по-твоему, происходит'),
    el('select', { onchange: e => set('hypothesisId', e.target.value) },
      el('option', { value: '' }, '— выбери —'),
      scenario.hypotheses.map(h => el('option',
        { value: h.id, selected: draft.hypothesisId === h.id }, h.label))),

    el('label', {}, '2. Ожидаемый результат: что изменится, если я прав'),
    el('textarea', { oninput: e => set('expectation', e.target.value) }, draft.expectation),

    el('label', {}, '3. Наблюдаемый признак: по чему я пойму, что сбылось'),
    draft.metricId
      ? el('div', { class: 'sub', style: 'margin:-2px 0 6px' },
          `Сейчас — ${fmt(draft.metricId, session.world.metrics[draft.metricId])}. ` +
          'Число выбираешь сам — и именно его потом сверят с тем, что вышло.')
      : null,
    el('div', { class: 'row' },
      el('select', { onchange: e => { set('metricId', e.target.value); render(); } },
        el('option', { value: '' }, '— показатель —'),
        Object.entries(scenario.metrics).map(([id, m]) =>
          el('option', { value: id, selected: draft.metricId === id }, m.label))),
      el('select', { onchange: e => set('direction', e.target.value) },
        el('option', { value: 'down', selected: draft.direction === 'down' }, 'станет не больше'),
        el('option', { value: 'up', selected: draft.direction === 'up' }, 'станет не меньше')),
      el('input', { type: 'number', step: '0.1', placeholder: 'значение', value: draft.target,
        oninput: e => set('target', e.target.value) })),

    el('div', { class: 'row' },
      el('div', {}, el('label', {}, '4. Уверенность, %'),
        el('input', { type: 'number', min: 1, max: 99, value: draft.confidence,
          oninput: e => set('confidence', Number(e.target.value)) })),
      el('div', {}, el('label', {}, '5. К какой неделе это должно быть видно?'),
        el('input', { type: 'number', min: session.world.week + 1, max: scenario.horizonWeeks,
          placeholder: `от ${session.world.week + 1} до ${scenario.horizonWeeks}`,
          value: draft.dueWeek, oninput: e => set('dueWeek', Number(e.target.value)) }),
        el('div', { class: 'sub', style: 'margin-top:4px' },
          `Сейчас ${session.world.week}-я неделя, отчёт на ${scenario.horizonWeeks}-й. ` +
          'Слишком ранний срок — и эффект не успеет; слишком поздний — ' +
          'и проверять будет уже поздно что-то менять.'))),

    formError ? el('div', { class: 'err' }, formError) : null,

    el('div', { style: 'margin-top:16px' },
      el('button', { class: 'act', disabled: blocked || !draft.actionId, onclick: () => {
        const r = commitAction(session, scenario, draft.actionId, {
          hypothesisId: draft.hypothesisId,
          expectation: draft.expectation,
          signs: draft.metricId && draft.target !== ''
            ? [{ metricId: draft.metricId, direction: draft.direction, target: Number(draft.target) }]
            : [],
          confidence: draft.confidence,
          dueWeek: Number(draft.dueWeek)
        });
        if (!r.ok) formError = (r.errors || [r.reason]).join('. ');
        else { formError = null; draft = blankDraft(); tab = 'contracts'; }
        save(); render();
      } }, 'Зафиксировать решение')));
}

/** Что и когда ты делал — читается из журнала, ничего не считает. */
function timeline() {
  const rows = [];
  for (const e of session.journal) {
    if (e.type === 'open_source') {
      const src = scenario.sources.find(x => x.id === e.sourceId);
      rows.push({ week: e.week, what: `запрос: ${src ? src.label : e.sourceId}`,
                  cost: e.costWeeks ? wk(e.costWeeks) : '' });
    } else if (e.type === 'action') {
      const a = scenario.actions.find(x => x.id === e.actionId);
      rows.push({ week: e.week, what: `решение: ${a ? a.label : e.actionId}`,
                  cost: a ? wk(a.costWeeks) : '', strong: true });
    } else if (e.type === 'checkpoint') {
      rows.push({ week: e.week, what: 'контрольная точка', cost: '' });
    }
  }
  for (const c of session.contracts) {
    rows.push({ week: c.dueWeek, what: `срок по контракту с ${c.week}-й недели`,
                cost: c.dueWeek <= session.world.week
                  ? (evaluated().find(x => x.id === c.id)?.verdict === 'met'
                      ? 'сбылось' : 'не сбылось')
                  : 'ещё не наступил', due: true });
  }
  rows.sort((a, b) => a.week - b.week);
  if (!rows.length) return null;

  return el('div', { class: 'panel' },
    el('h2', {}, 'Что происходило'),
    el('table', {},
      el('tr', {}, el('th', {}, 'Неделя'), el('th', {}, 'Что'), el('th', {}, '')),
      rows.map(r => el('tr', { class: r.due ? 'due' : null },
        el('td', {}, String(r.week)),
        el('td', {}, r.strong ? el('b', {}, r.what) : r.what),
        el('td', { class: 'sub' }, r.cost)))),
    el('div', { class: 'note' },
      `Сейчас ${session.world.week}-я неделя из ${scenario.horizonWeeks}.`));
}

/**
 * Вопросы перед решением. По SSDL их видимость — не украшение:
 * на первой ступени они открыты, на второй прячутся за кнопку,
 * на третьей их нет совсем.
 */
function beforeYouDecide() {
  if (stage >= 3) return null;
  const items = [
    'Сколько версий ты уже можешь отсечь тем, что прочитал? ' +
    'Если ни одной — выбор идёт наугад из четырёх.',
    'Что из прочитанного говорит ПРОТИВ твоей версии? ' +
    'Если ничего — возможно, ты читал только подтверждения.',
    'По какому числу ты через месяц поймёшь, что ошибся? ' +
    'Не «станет лучше», а порог.',
    'Твой срок наступает раньше или позже, чем эффект вообще может проявиться?'
  ];
  const list = el('ul', { class: 'ask' }, items.map(t => el('li', {}, t)));

  if (stage === 1) {
    return el('div', { class: 'askbox' },
      el('h3', { style: 'margin-top:0' }, 'Спроси себя перед решением'), list);
  }
  return el('details', { class: 'recap block' },
    el('summary', {}, 'Спроси себя перед решением'), list);
}

/**
 * Во что обойдётся выбранное действие и что останется после него.
 * Показывается до нажатия, а не спрашивается после: цена хода — часть
 * упражнения, а не защита от случайного клика.
 */
function costHint() {
  const a = scenario.actions.find(x => x.id === draft.actionId);
  if (!a) return null;
  const after = session.world.week + a.costWeeks;
  const left = scenario.horizonWeeks - after;
  const rule = scenario.rules.find(r => r.action === a.id && r.effects.length);
  const firstEffect = rule ? Math.min(...rule.effects.map(e => e.afterWeeks)) : null;
  const heavy = left < 3;

  return el('div', { class: heavy ? 'err' : 'sub', style: 'margin-top:8px' },
    `Работа займёт ${wk(a.costWeeks)}: закончится на ${after}-й неделе, ` +
    `до отчёта останется ${wk(left)}. ` +
    (firstEffect !== null
      ? `Раньше ${session.world.week + firstEffect}-й недели что-то заметить ` +
        'не получится при всём желании.'
      : 'Сколько ждать результата — заранее неизвестно.'));
}

/* ---------- контракты ---------- */
function contracts() {
  const list = evaluated();
  const notes = session.journal.filter(e => e.type === 'note');
  if (!list.length && !notes.length)
    return el('div', {},
      el('div', { class: 'panel' }, el('h2', {}, 'Контракты'),
        el('p', { class: 'sub' }, 'Пока ни одного: решение ещё не зафиксировано.')),
      timeline());

  return el('div', {},
    el('div', { class: 'panel' },
      el('h2', {}, 'Контракты решений'),
      list.map(c => {
        const hyp = scenario.hypotheses.find(h => h.id === c.hypothesisId);
        const tag = c.verdict === 'pending'
          ? el('span', { class: 'tag' }, `срок — ${c.dueWeek}-я неделя`)
          : el('span', { class: 'tag ' + (c.verdict === 'met' ? 'ok' : 'miss') },
              c.verdict === 'met' ? 'признак сбылся' : 'признак не сбылся');
        return el('div', { style: 'border-top:1px solid var(--line);padding:12px 0' },
          el('div', {}, tag, el('span', { class: 'tag' }, `${c.week}-я неделя`),
            el('span', { class: 'tag' }, `уверенность ${c.confidence}%`)),
          el('div', { style: 'margin-top:6px' }, el('b', {}, hyp?.label || '—')),
          el('div', { class: 'sub' }, c.expectation),
          (c.signResults || []).map(s => el('div', { class: 'sub', style: 'margin-top:4px' },
            `${scenario.metrics[s.metricId].label}: обещано ` +
            `${s.direction === 'down' ? '≤' : '≥'} ${s.target}, было ${fmt(s.metricId, s.atStart)}, ` +
            `стало ${fmt(s.metricId, s.atDue)}`)));
      }),
      el('div', { class: 'note' },
        'О калибровке можно говорить с десятого контракта — она на вкладке «Прогресс».')),
    notes.length ? el('div', { class: 'panel' },
      el('h2', {}, 'Отметки на контрольных точках'),
      el('table', {},
        el('tr', {}, el('th', {}, 'Неделя'), el('th', {}, 'Уверенность'), el('th', {}, 'Что изменилось')),
        notes.map(n => el('tr', {}, el('td', {}, String(n.week)),
          el('td', {}, n.confidence + '%'), el('td', {}, n.note || '—'))))) : null,
    timeline());
}

/* ---------- разбор ---------- */
function debriefTab() {
  if (!session.finished && session.world.week < scenario.horizonWeeks) {
    return el('div', { class: 'panel' },
      el('h2', {}, 'Разбор'),
      el('p', { class: 'sub' },
        'Разбор открывается в конце эпизода. Можно закончить раньше — ' +
        'но тогда часть отложенных эффектов не успеет проявиться.'),
      el('button', { class: 'ghost',
        onclick: () => { finish(session, scenario); save(); render(); } },
        'Завершить прогон сейчас'));
  }
  if (!session.finished) { finish(session, scenario); save(); }
  const d = buildDebrief(session, scenario);
  recordRun(d);
  const seek = d.seeking;

  return el('div', {},
    el('div', { class: 'panel lead' },
      el('h2', {}, 'Вопросы к разбору'),
      el('div', { class: 'sub' },
        `Эпизод тренировал одно: ${scenario.targetBehaviour.toLowerCase()}. ` +
        'Вопросы ниже отсортированы по силе находки — если времени мало, ' +
        'хватит первых трёх. Это вопросы, а не оценки: разбор ведёт человек.'),
      el('ol', { class: 'q' }, d.questions.map(q => el('li', {}, q)))),

    el('div', { class: 'panel' },
      el('h2', {}, 'Что ты запрашивал до первого вмешательства'),
      el('table', {},
        el('tr', {}, el('th', {}, 'Что смотрим'), el('th', {}, 'Сколько')),
        el('tr', {}, el('td', {}, 'Источников открыто до решения'),
          el('td', {}, String(seek.openedBefore.length))),
        el('tr', {}, el('td', {}, 'Из них различали версии между собой'),
          el('td', {}, `${seek.diagnosticOpenedBefore} (${pct(seek.diagnosticRatio)})`)),
        el('tr', {}, el('td', {}, 'Подтверждали, но ничего не различали'),
          el('td', {}, String(seek.nonDiagnosticOpenedBefore))),
        seek.feasibilityOpenedBefore
          ? el('tr', {}, el('td', {}, 'Вопросы не о причине, а о выполнимости'),
              el('td', {}, String(seek.feasibilityOpenedBefore)))
          : null,
        el('tr', {}, el('td', {}, 'Из всех различающих источников открыто'),
          el('td', {}, pct(seek.diagnosticCoverage))),
        el('tr', {}, el('td', {}, 'Версий оставалось живо в момент решения'),
          el('td', {}, `${seek.aliveAtDecision.length} из ${scenario.hypotheses.length}`))),
      seek.aliveAtDecision.length ? el('div', { class: 'sub' },
        'Живы были: ' + seek.aliveAtDecision.map(h => `«${h.label}»`).join(', ')) : null,
      seek.order.length ? el('div', {},
        el('h3', {}, 'В каком порядке запрашивал'),
        el('ol', { class: 'order' }, seek.order.map(o => el('li', {},
          o.label,
          el('span', { class: 'tag', style: 'margin-left:6px' },
            o.feasibility ? 'о выполнимости' : o.diagnostic ? 'различал' : 'не различал')))),
        el('div', { class: 'sub' },
          'С чего начал — это и есть рабочая версия человека, ' +
          'даже если он её не назвал.')) : null,

      el('h3', {}, 'Чего не открыл вообще'),
      d.notOpened.length
        ? el('ul', {}, d.notOpened.map(s2 => el('li', {},
            s2.label + (s2.diagnostic ? ' — а он различал версии' : ''))))
        : el('p', { class: 'sub' }, 'Открыто всё.'),
      el('div', { class: 'note' },
        'Это самое сильное место разбора: видно не то, что человек сделал, ' +
        'а то, что ему не пришло в голову.')),

    d.grounds.length ? el('div', { class: 'panel' },
      el('h2', {}, 'На чём стояло твоё решение'),
      d.grounds.map(g => el('div', { style: 'border-top:1px solid var(--line);padding:11px 0' },
        el('div', {}, el('b', {}, g.hypothesisLabel || '—'), ' ',
          el('span', { class: 'tag' }, `уверенность ${g.confidence}%`)),
        g.choseRefuted
          ? el('div', { class: 'err' },
              'Ты сам открыл источник, который говорит против этой версии: ' +
              g.refutedBy.map(x => `«${x}»`).join(', '))
          : null,
        g.supportOpened.length
          ? el('div', { class: 'sub' },
              'За неё говорили: ' + g.supportOpened.map(x => `«${x}»`).join(', '))
          : null,
        !g.supportOpened.length && !g.choseRefuted
          ? el('div', { class: 'sub' },
              g.sourcesSeen
                ? 'Прямых подтверждений не было — версию просто не опровергли.'
                : 'К этому моменту ты не открывал ничего.')
          : null)),
      el('div', { class: 'note' },
        'Разница между «версию подтвердили» и «версию не опровергли» — ' +
        'главная в этом упражнении. Вторая ощущается как знание, но им не является.'))
      : null,

    el('div', { class: 'panel' },
      el('h2', {}, 'Вмешательство'),
      el('p', { class: 'sub' },
        `Действий: ${d.breadth.actionCount}. Разных направлений: ${d.breadth.categoryCount}. ` +
        `Первое вмешательство — ${d.breadth.firstActionWeek ?? '—'}-я неделя.`),
      el('table', {}, el('tr', {}, el('th', {}, 'Неделя'), el('th', {}, 'Что произошло в мире')),
        d.worldLog.filter(w => w.type === 'rule').map(w =>
          el('tr', {}, el('td', {}, String(w.week)), el('td', {}, w.note))))),

    d.timing.some(t => t.dueBeforeEffect) || d.waiting.some(w => w.actedBeforeOwnDeadline)
      ? el('div', { class: 'panel' },
          el('h2', {}, 'Сроки'),
          d.timing.filter(t => t.dueBeforeEffect).map(t => el('p', { class: 'sub' },
            `Срок стоял на ${t.dueWeek}-ю неделю, а раньше ${t.earliestPossibleWeek}-й ` +
            'это действие не могло проявиться вообще.')),
          d.waiting.filter(w => w.actedBeforeOwnDeadline).map(w => el('p', { class: 'sub' },
            `Срок стоял на ${w.dueWeek}-ю неделю, а следующее решение принято ` +
            `на ${w.firstEarlyActionWeek}-й: собственную проверку не дождались ` +
            `${wk(w.weeksNotWaited)}.`)))
      : null,

    d.afterError.some(e => !e.noFollowUp) ? el('div', { class: 'panel' },
      el('h2', {}, 'Что ты сделал после того, как признак не сбылся'),
      d.afterError.map(e => el('table', {},
        el('tr', {}, el('th', {}, 'Точка разлома'),
          el('th', {}, `${e.brokenAtWeek}-я неделя` +
            (e.noFollowUp ? ' — эпизод кончился, продолжения не было' : ''))),
        el('tr', {}, el('td', {}, 'Запросил новые сведения до следующего действия'),
          el('td', {}, e.soughtNewInformation ? `да, ${e.sourcesBetween.length}` : 'нет')),
        el('tr', {}, el('td', {}, 'Сменил гипотезу'),
          el('td', {}, e.changedHypothesis === null ? 'следующего решения не было'
            : e.changedHypothesis ? 'да' : 'нет, усилил прежнюю')),
        el('tr', {}, el('td', {}, 'Уверенность изменилась на'),
          el('td', {}, e.confidenceDelta === null ? '—'
            : (e.confidenceDelta > 0 ? '+' : '') + e.confidenceDelta + ' п.п.')),
        el('tr', {}, el('td', {}, 'Повторил вмешательство того же типа'),
          el('td', {}, e.repeatedSameCategory === null ? '—' : e.repeatedSameCategory ? 'да' : 'нет')),
        el('tr', {}, el('td', {}, 'Недель до следующего действия'),
          el('td', {}, e.weeksToNextAction === null ? '—' : String(e.weeksToNextAction)))))) : null,

    el('div', { class: 'panel' },
      el('h2', {}, 'Правда этого варианта'),
      el('p', {}, el('b', {}, d.truth.label)),
      el('div', { class: 'sub' },
        'Правила мира были записаны до прогона и не зависели от того, ' +
        'что ты записал в контракт.')),

    el('div', { class: 'panel' },
      el('h2', {}, 'Дальше'),
      el('button', { class: 'ghost', onclick: () => exportRun(d) }, 'Скачать прогон'),
      ' ',
      el('button', { class: 'ghost', onclick: () => exportForFacilitator(d) },
        'Лист для разбора'),
      ' ',
      el('button', { class: 'ghost', onclick: () => { tab = 'episodes'; render(); } },
        'Взять другой вариант'),
      el('div', { class: 'note' },
        'Следующий вариант того же кейса устроен так же, но факты и причина в нём другие.')));
}

/** Текстовый лист для того, кто ведёт разбор: только наблюдаемое и вопросы. */
function exportForFacilitator(d) {
  const L = [];
  L.push(`Разбор: ${scenario.caseTitle}, вариант ${scenario.variant}`);
  L.push(scenario.title);
  L.push(`Целевое действие: ${scenario.targetBehaviour}`);
  L.push('');
  L.push('НАБЛЮДАЕМОЕ');
  L.push(`  Источников открыто до решения: ${d.seeking.openedBefore.length}`);
  if (d.seeking.order.length) {
    L.push('  Порядок запросов:');
    d.seeking.order.forEach((o, i) => L.push(
      `    ${i + 1}. ${o.label} [${o.feasibility ? 'о выполнимости'
        : o.diagnostic ? 'различал' : 'не различал'}]`));
  }
  L.push(`  Из них различали версии: ${d.seeking.diagnosticOpenedBefore}`);
  L.push(`  Подтверждали, но не различали: ${d.seeking.nonDiagnosticOpenedBefore}`);
  if (d.seeking.feasibilityOpenedBefore)
    L.push(`  Вопросы о выполнимости: ${d.seeking.feasibilityOpenedBefore}`);
  L.push(`  Версий живо в момент решения: ${d.seeking.aliveAtDecision.length} из ${scenario.hypotheses.length}`);
  L.push(`  Действий: ${d.breadth.actionCount}, направлений: ${d.breadth.categoryCount}`);
  L.push(`  Первое вмешательство: ${d.breadth.firstActionWeek ?? '—'}-я неделя`);
  L.push('');
  L.push('НЕ ОТКРЫТО');
  for (const s2 of d.notOpened)
    L.push(`  - ${s2.label}${s2.diagnostic ? '  [различал версии]' : ''}`);
  L.push('');
  L.push('НА ЧЁМ СТОЯЛО РЕШЕНИЕ');
  for (const g of d.grounds) {
    L.push(`  «${g.hypothesisLabel}», уверенность ${g.confidence}%`);
    if (g.refutedBy.length)
      L.push(`    ПРОТИВ неё говорил открытый им же источник: ${g.refutedBy.join('; ')}`);
    if (g.supportOpened.length) L.push(`    за неё: ${g.supportOpened.join('; ')}`);
    else if (!g.refutedBy.length)
      L.push('    прямых подтверждений не было — версию просто не опровергли');
  }
  L.push('');
  L.push('КОНТРАКТЫ');
  for (const c of d.contracts) {
    const h = scenario.hypotheses.find(x => x.id === c.hypothesisId);
    L.push(`  Неделя ${c.week}, уверенность ${c.confidence}%, срок ${c.dueWeek} — ` +
      `${c.verdict === 'met' ? 'признак сбылся' : 'признак не сбылся'}`);
    L.push(`    версия: ${h ? h.label : '—'}`);
    L.push(`    ожидание: ${c.expectation}`);
  }
  const notes = session.journal.filter(e => e.type === 'note');
  if (notes.length) {
    L.push('');
    L.push('ОТМЕТКИ НА КОНТРОЛЬНЫХ ТОЧКАХ');
    for (const n of notes) L.push(`  Неделя ${n.week}: уверенность ${n.confidence}% — ${n.note || '—'}`);
  }
  L.push('');
  L.push('ЧТО ПРОИЗОШЛО В МИРЕ');
  for (const w of d.worldLog.filter(x => x.type === 'rule')) L.push(`  Неделя ${w.week}: ${w.note}`);
  L.push('');
  L.push(`ПРАВДА ЭТОГО ВАРИАНТА: ${d.truth.label}`);
  L.push('');
  L.push('ВОПРОСЫ (задавать, а не зачитывать оценки)');
  d.questions.forEach((q, i) => L.push(`  ${i + 1}. ${q}`));
  L.push('');
  L.push('Разбор ведёт человек. Общей оценки способностей здесь нет и не будет.');

  const blob = new Blob([L.join('\n')], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Разбор — ${scenario.title}, вариант ${scenario.variant}.txt`;
  a.click();
}

function exportRun(d) {
  const blob = new Blob([JSON.stringify({ session, debrief: d }, null, 2)],
    { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Прогон — ${scenario.title}, вариант ${scenario.variant}.json`;
  a.click();
}

/* ---------- сравнение прогонов ---------- */
/**
 * Живой инструмент для разбора группой: несколько человек проходят один
 * и тот же вариант, каждый скачивает свой прогон, ведущий кладёт файлы сюда.
 * Расхождения на одних и тех же данных — лучший материал, который бывает.
 * Никуда не сохраняется: это стол, а не архив.
 */
let compared = [];
let compareError = null;

function addComparedFiles(fileList) {
  const files = [...fileList];
  let left = files.length;
  compareError = null;
  for (const f of files) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        const d = parsed.debrief;
        if (!d || !d.seeking || !d.scenario) throw new Error('не тот файл');
        compared.push({
          name: f.name.replace(/\.json$/, '').replace(/-\d{10,}$/, ''),
          debrief: d,
          session: parsed.session
        });
      } catch {
        compareError = `«${f.name}» не похож на выгруженный прогон. ` +
          'Нужен файл из кнопки «Скачать прогон» на экране разбора.';
      }
      if (--left === 0) render();
    };
    reader.onerror = () => { if (--left === 0) render(); };
    reader.readAsText(f);
  }
}

function compare() {
  const load = el('div', { class: 'panel' },
    el('h2', {}, 'Сравнить прогоны'),
    el('p', { class: 'sub' },
      'Каждый проходит один и тот же вариант и нажимает «Скачать прогон» ' +
      'на экране разбора. Сложи файлы сюда — получится таблица, по которой ' +
      'видно, где люди разошлись на одних и тех же данных.'),
    el('input', { type: 'file', accept: '.json,application/json', multiple: true,
      onchange: e => { addComparedFiles(e.target.files); e.target.value = ''; } }),
    compareError ? el('div', { class: 'err' }, compareError) : null,
    compared.length
      ? el('div', { style: 'margin-top:12px' },
          el('button', { class: 'ghost',
            onclick: () => { compared = []; compareError = null; render(); } },
            'Убрать всё со стола'))
      : el('div', { class: 'note' },
        'Файлы никуда не сохраняются и никуда не уходят: они живут только ' +
        'пока открыта эта вкладка.'));

  if (!compared.length) return load;

  const variants = new Set(compared.map(c => c.debrief.scenario.id));
  const sc = byId(compared[0].debrief.scenario.id);
  const km = sc ? keyMetric(sc) : null;
  const kmLabel = sc && km ? sc.metrics[km].label : '—';
  const dec = (id, v) => v === undefined || v === null ? '—'
    : Number(v).toFixed(sc?.metrics?.[id]?.decimals ?? 1);
  const scOf = c => byId(c.debrief.scenario.id);

  const ground = g => !g ? '—'
    : g.choseRefuted ? 'вопреки прочитанному'
    : g.supportOpened.length ? 'есть подтверждение'
    : 'просто не опровергли';

  const rows = [
    ['Вариант', c => {
      const x = scOf(c);
      return x ? `${x.caseTitle.replace(/^Кейс (\d)\..*$/, 'кейс $1')}, ${x.variant}`
               : c.debrief.scenario.id;
    }],
    ['Источников до решения', c => String(c.debrief.seeking.openedBefore.length)],
    ['Из них различающих', c => c.debrief.seeking.diagnosticRatio === null ? '—'
      : `${c.debrief.seeking.diagnosticOpenedBefore} (${pct(c.debrief.seeking.diagnosticRatio)})`],
    ['С чего начал', c => c.debrief.seeking.order?.length
      ? c.debrief.seeking.order.slice(0, 2).map(o => o.label).join(' → ') : 'ни с чего'],
    ['Версий живо при решении', c => {
      const total = scOf(c)?.hypotheses.length;
      return `${c.debrief.seeking.aliveAtDecision.length}${total ? ' из ' + total : ''}`;
    }],
    ['Выбранная версия', c => c.debrief.grounds?.[0]?.hypothesisLabel || '—'],
    ['На чём стояла', c => ground(c.debrief.grounds?.[0])],
    ['Уверенность', c => c.debrief.contracts?.[0]
      ? c.debrief.contracts[0].confidence + '%' : '—'],
    ['Действий / направлений', c =>
      `${c.debrief.breadth.actionCount} / ${c.debrief.breadth.categoryCount}`],
    ['Первое вмешательство', c => c.debrief.breadth.firstActionWeek === null ? '—'
      : `${c.debrief.breadth.firstActionWeek}-я неделя`],
    ['Дождался своего срока', c => (c.debrief.waiting || []).some(w => w.actedBeforeOwnDeadline)
      ? 'нет' : 'да'],
    ['Признак сбылся', c => {
      const v = (c.debrief.contracts || []).map(x => x.verdict);
      return v.length ? v.map(x => x === 'met' ? 'да' : 'нет').join(', ') : '—';
    }],
    [`Итог: ${kmLabel}`, c => km ? dec(km, c.debrief.metricsEnd?.[km]) : '—']
  ];

  return el('div', {}, load,
    variants.size > 1
      ? el('div', { class: 'panel stop' },
          el('h2', {}, 'Это разные варианты'),
          el('p', { class: 'sub' },
            'На столе прогоны разных вариантов: ' + [...variants].join(', ') + '. ' +
            'Сравнивать их между собой нельзя — там разные факты и разная ' +
            'настоящая причина. Сравнение имеет смысл только внутри одного варианта.'))
      : null,
    el('div', { class: 'panel' },
      el('h2', {}, 'Кто что сделал'),
      el('div', { class: 'wide' },
        el('table', {},
          el('tr', {}, el('th', {}, ''),
            compared.map((c, i) => el('th', {},
              el('input', { type: 'text', value: c.name, class: 'who',
                oninput: e => { compared[i].name = e.target.value; } })))),
          rows.map(([label, get]) => el('tr', {},
            el('td', {}, label),
            compared.map(c => el('td', {}, get(c))))))),
      el('div', { class: 'note' },
        'Строки, по которым люди разошлись, и есть повестка разбора. ' +
        'Одни и те же данные, разные решения — спрашивать надо не «кто прав», ' +
        'а «что ты увидел такого, чего не увидел он».')),

    el('div', { class: 'panel' },
      el('h2', {}, 'Правда этого варианта'),
      el('p', {}, el('b', {}, compared[0].debrief.truth?.label || '—')),
      el('div', { class: 'note' }, 'Называть её в группе — в самом конце.')));
}

/* ---------- прогресс ---------- */
function progress() {
  const runs = profile.runs;
  if (!runs.length) return el('div', { class: 'panel' },
    el('h2', {}, 'Прогресс'),
    el('p', { class: 'sub' },
      'Пока ни одного завершённого прогона. Один прогон — это срез; ' +
      'динамика появляется на четырёх-пяти.'));

  const cal = profileCalibration(profile);
  const trAlive = trend(profile, 'aliveAtDecision');
  const trDiag = trend(profile, 'diagnosticRatio');
  const trCover = trend(profile, 'diagnosticCoverage');
  const refuted = runs.filter(r => r.choseRefuted > 0).length;
  const unsupported = runs.filter(r => r.choseWithoutSupport > 0).length;
  const impatient = runs.filter(r => r.actedBeforeOwnDeadline > 0).length;

  const trendRow = (label, t, better) => el('tr', {},
    el('td', {}, label),
    el('td', {}, t ? t.before.toFixed(2) : '—'),
    el('td', {}, t ? t.after.toFixed(2) : '—'),
    el('td', {}, t ? el('span', { class: 'delta ' +
        ((t.delta < 0) === (better === 'down') ? 'good' : 'bad') },
        (t.delta > 0 ? '+' : '') + t.delta.toFixed(2)) : '—'));

  return el('div', {},
    el('div', { class: 'panel' },
      el('h2', {}, 'Прогоны'),
      el('table', {},
        el('tr', {}, el('th', {}, 'Когда'), el('th', {}, 'Кейс'), el('th', {}, 'Вар.'),
          el('th', {}, 'Живо версий'), el('th', {}, 'Различающих'),
          el('th', {}, 'Слепых зон'), el('th', {}, 'Версия: сразу / в итоге')),
        runs.map(r => el('tr', {},
          el('td', {}, new Date(r.at).toLocaleDateString('ru-RU')),
          el('td', {}, (r.caseTitle || '').replace(/^Кейс (\d)\..*$/, '$1')),
          el('td', {}, r.variant),
          el('td', {}, `${r.aliveAtDecision} из ${r.hypothesisCount}`),
          el('td', {}, pct(r.diagnosticRatio)),
          el('td', {}, String(r.blindSpots)),
          el('td', {},
            (r.guessedRight === null ? '—' : r.guessedRight ? 'да' : 'нет') + ' / ' +
            (r.endedRight === undefined || r.endedRight === null ? '—' : r.endedRight ? 'да' : 'нет'))))),
      el('div', { class: 'note' },
        'Два столбца в конце — версия в первом контракте и в последнем. ' +
        'Разница между ними и есть «обновил решение».')),

    el('div', { class: 'panel' },
      el('h2', {}, 'Динамика, а не срез'),
      el('table', {},
        el('tr', {}, el('th', {}, 'Показатель'), el('th', {}, 'Первая половина'),
          el('th', {}, 'Вторая половина'), el('th', {}, 'Сдвиг')),
        trendRow('Версий живо в момент решения', trAlive, 'down'),
        trendRow('Доля различающих запросов', trDiag, 'up'),
        trendRow('Охват различающих источников', trCover, 'up')),
      el('div', { class: 'note' },
        (runs.length < 4
          ? `Сдвиг считается с четвёртого прогона. Сейчас их ${runs.length}. `
          : 'Сравниваются первая и вторая половина прогонов. На малых числах ' +
            'это подсказка, а не вывод. ') +
        'Здесь только доли и отношения — их можно сравнивать между кейсами. ' +
        'Абсолютные числа (сколько источников открыто, сколько недель потрачено) ' +
        'зависят от бюджета кейса и в сравнение не идут.')),

    el('div', { class: 'panel' },
      el('h2', {}, 'Привычки, которые видно по всем прогонам'),
      el('table', {},
        el('tr', {}, el('th', {}, 'Что'), el('th', {}, 'В скольких прогонах')),
        el('tr', {}, el('td', {}, 'Ставил на версию вопреки тому, что сам прочитал'),
          el('td', {}, `${refuted} из ${runs.length}`)),
        el('tr', {}, el('td', {}, 'Ставил на версию без единого подтверждения'),
          el('td', {}, `${unsupported} из ${runs.length}`)),
        el('tr', {}, el('td', {}, 'Действовал, не дождавшись собственного срока'),
          el('td', {}, `${impatient} из ${runs.length}`))),
      el('div', { class: 'note' },
        'Это не оценка, а счёт повторов. Один раз — случай, три раза подряд — ' +
        'повод поговорить о привычке.')),

    el('div', { class: 'panel' },
      el('h2', {}, 'Калибровка'),
      cal.n
        ? el('table', {},
            el('tr', {}, el('th', {}, 'Заявленная уверенность'), el('th', {}, 'Сбылось на деле'),
              el('th', {}, 'Контрактов')),
            cal.rows.map(r => el('tr', {}, el('td', {}, r.stated + '%'),
              el('td', {}, r.actual + '%'), el('td', {}, String(r.n)))))
        : null,
      el('div', { class: 'note' },
        cal.enough
          ? `Контрактов ${cal.n}. Уже можно смотреть, но осторожно.`
          : `Контрактов ${cal.n} из 10 минимально нужных. До этого числа калибровка — шум, ` +
            'и показывать её бизнесу нельзя.')),

    el('div', { class: 'panel' },
      el('h2', {}, 'Забрать историю'),
      el('button', { class: 'ghost', onclick: () => {
        const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = 'История прогонов.json'; a.click();
      } }, 'Скачать историю прогонов'),
      ' ',
      el('button', { class: 'ghost', onclick: () => {
        if (!confirm('Стереть историю всех прогонов? Это нельзя отменить.')) return;
        profile = { runs: [] }; saveProfile(profile); render();
      } }, 'Стереть историю')));
}

/* ---------- сборка ---------- */
/**
 * Экран показывается тогда, когда ему есть что показать.
 *
 * Это условие про данные, а не про ступень: журнал пуст, пока нет ни одного
 * решения; прогресс бессмыслен, пока прогон один; сравнение нужно ведущему,
 * когда уже есть что сравнивать. Ступень отвечает за другое — за подсказки.
 */
const ALL_TABS = [
  ['welcome', 'В начало', () => welcome(), () => true],
  ['episodes', 'Эпизоды', () => episodes(), () => true],
  ['situation', 'Ситуация', () => situation(), () => true],
  ['sources', 'Источники', () => sources(), () => true],
  ['decision', 'Решение', () => decision(), () => true],
  ['contracts', 'Ход и контракты', () => contracts(),
    () => session.contracts.length > 0 || session.journal.some(e => e.type === 'note')],
  ['debrief', 'Разбор', () => debriefTab(), () => true],
  ['progress', 'Прогресс', () => progress(), () => profile.runs.length > 0],
  ['compare', 'Сравнить', () => compare(), () => profile.runs.length > 0]
];
const tabsFor = () => ALL_TABS.filter(t => t[3]());

function staleBanner() {
  if (staleRunNotice !== scenario.id) return null;
  return el('div', { class: 'panel stop' },
    el('h2', {}, 'Незаконченный заход сброшен'),
    el('p', { class: 'sub' },
      'Содержание этого эпизода изменилось с тех пор, как ты начал. ' +
      'Доигрывать старый заход нельзя: половина хода прошла бы по прежним ' +
      'правилам, а вторая — по новым. Начали заново.'),
    el('button', { class: 'ghost',
      onclick: () => { staleRunNotice = null; render(); } }, 'Понятно'));
}

function render() {
  const app = document.getElementById('app');
  app.textContent = '';
  if (!stage) { app.append(welcome()); return; }
  if (tab !== 'welcome') app.append(header());
  const cp = checkpointBanner();
  app.append(el('nav', {}, tabsFor().map(([id, label]) =>
    el('button', { class: tab === id ? 'on' : '', onclick: () => { tab = id; render(); } },
      label + (id === 'contracts' && session.contracts.length ? ` (${session.contracts.length})` : '')))));
  const stale = staleBanner();
  if (stale) app.append(stale);
  if (cp) app.append(cp);
  const found = tabsFor().find(t => t[0] === tab) || tabsFor()[0];
  app.append(found[2]());
}

render();
