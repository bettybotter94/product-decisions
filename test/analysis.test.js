import { test } from 'node:test';
import assert from 'node:assert/strict';
import scenario from '../scenarios/churn-a.js';
import { createSession, openSource, commitAction, step, runToEnd, checkpointNote, pendingCheckpoint } from '../engine/session.js';
import { aliveHypotheses, informationSeeking, postErrorBehaviour, patience, timingCheck } from '../engine/analysis.js';
import { buildDebrief } from '../engine/debrief.js';

test('живые гипотезы отсекаются только различающими источниками', () => {
  assert.equal(aliveHypotheses(scenario, []).length, 4);
  assert.equal(aliveHypotheses(scenario, ['s_competitor', 's_sales']).length, 4);
  assert.equal(aliveHypotheses(scenario, ['s_release_flag']).length, 3);
  assert.equal(aliveHypotheses(scenario, ['s_release_flag', 's_billing', 's_exit']).length, 1);
});

test('решение без единого запроса помечается', () => {
  const s = createSession(scenario, 1);
  commitAction(s, scenario, 'a_discount', {
    hypothesisId: 'h2', expectation: 'Скидка удержит клиентов от ухода',
    signs: [{ metricId: 'churn_segment', direction: 'down', target: 5 }],
    confidence: 80, dueWeek: 5
  });
  const seek = informationSeeking(scenario, s.journal);
  assert.equal(seek.decidedWithoutAsking, true);
  assert.equal(seek.aliveAtDecision.length, 4);
});

test('подтверждающие запросы считаются отдельно от различающих', () => {
  const s = createSession(scenario, 1);
  openSource(s, scenario, 's_competitor');
  openSource(s, scenario, 's_sales');
  openSource(s, scenario, 's_cohorts');
  commitAction(s, scenario, 'a_discount', {
    hypothesisId: 'h2', expectation: 'Скидка удержит клиентов от ухода',
    signs: [{ metricId: 'churn_segment', direction: 'down', target: 5 }],
    confidence: 60, dueWeek: 6
  });
  const seek = informationSeeking(scenario, s.journal);
  assert.equal(seek.diagnosticOpenedBefore, 1);
  assert.equal(seek.nonDiagnosticOpenedBefore, 2);
});

test('поведение после ошибки: видно, запросил ли новое и сменил ли гипотезу', () => {
  const s = createSession(scenario, 1);
  commitAction(s, scenario, 'a_fix_onboarding', {
    hypothesisId: 'h1', expectation: 'Починим онбординг и отток вернётся к норме',
    signs: [{ metricId: 'churn_segment', direction: 'down', target: 5 }],
    confidence: 85, dueWeek: 5
  });
  step(s, scenario, 5);
  openSource(s, scenario, 's_support');
  // онбординг съел 5 недель команды из 7 — на большое второе вмешательство
  // ресурса уже нет, и это само по себе материал для разбора
  commitAction(s, scenario, 'a_discount', {
    hypothesisId: 'h4', expectation: 'Удержим скидкой, пока разбираемся с поддержкой',
    signs: [{ metricId: 'churn_segment', direction: 'down', target: 6 }],
    confidence: 55, dueWeek: 12
  });
  const d = buildDebrief(s, scenario);
  const broken = d.afterError[0];
  assert.ok(broken, 'должна найтись точка разлома');
  assert.equal(broken.soughtNewInformation, true);
  assert.equal(broken.changedHypothesis, true);
  assert.equal(broken.confidenceDelta, -30);
});

test('разбор содержит слепые зоны и вопросы ведущему', () => {
  const s = createSession(scenario, 1);
  commitAction(s, scenario, 'a_discount', {
    hypothesisId: 'h2', expectation: 'Скидка удержит клиентов от ухода',
    signs: [{ metricId: 'churn_segment', direction: 'down', target: 5 }],
    confidence: 80, dueWeek: 5
  });
  runToEnd(s, scenario);
  const d = buildDebrief(s, scenario);
  assert.ok(d.seeking.blindSpots.length >= 5);
  assert.ok(d.questions.length >= 3);
  assert.equal(d.truth.id, 'h4');
});

test('видно, когда человек не дождался собственного срока', () => {
  const s = createSession(scenario, 1);
  commitAction(s, scenario, 'a_discount', {
    hypothesisId: 'h2', expectation: 'Скидка удержит клиентов от ухода',
    signs: [{ metricId: 'churn_segment', direction: 'down', target: 5 }],
    confidence: 70, dueWeek: 10
  });
  step(s, scenario, 4);
  commitAction(s, scenario, 'a_outreach', {
    hypothesisId: 'h2', expectation: 'Обзвоним тех, кто в группе риска, заодно',
    signs: [{ metricId: 'churn_segment', direction: 'down', target: 6 }],
    confidence: 60, dueWeek: 11
  });
  const d = buildDebrief(s, scenario);
  const w = d.waiting.find(x => x.dueWeek === 10);
  assert.equal(w.actedBeforeOwnDeadline, true);
  assert.equal(w.firstEarlyActionWeek, 4);
  assert.equal(w.weeksNotWaited, 6);
  assert.ok(d.questions.some(q => q.includes('не дождался') || q.includes('собственной')),
    'разбор об этом не спрашивает');
});

test('дождавшемуся ничего не вменяется', () => {
  const s = createSession(scenario, 1);
  commitAction(s, scenario, 'a_discount', {
    hypothesisId: 'h2', expectation: 'Скидка удержит клиентов от ухода',
    signs: [{ metricId: 'churn_segment', direction: 'down', target: 5 }],
    confidence: 70, dueWeek: 7
  });
  runToEnd(s, scenario);
  const d = buildDebrief(s, scenario);
  assert.equal(d.waiting.every(w => !w.actedBeforeOwnDeadline), true);
});

test('видно, когда человек ставит на версию, которую сам же опроверг', () => {
  const s = createSession(scenario, 1);
  openSource(s, scenario, 's_release_flag'); // прямо говорит: дело не в релизе
  commitAction(s, scenario, 'a_fix_onboarding', {
    hypothesisId: 'h1', expectation: 'Всё-таки починим онбординг, я в это верю',
    signs: [{ metricId: 'churn_segment', direction: 'down', target: 5 }],
    confidence: 75, dueWeek: 10
  });
  const d = buildDebrief(s, scenario);
  const g = d.grounds[0];
  assert.equal(g.choseRefuted, true);
  assert.equal(g.refutedBy.length, 1);
  assert.ok(d.questions.some(q => q.includes('говорил против неё')));
});

test('видно, когда за выбранной версией нет ни одного свидетельства', () => {
  const s = createSession(scenario, 1);
  openSource(s, scenario, 's_billing'); // про сезонность, не про конкурента
  commitAction(s, scenario, 'a_discount', {
    hypothesisId: 'h2', expectation: 'Ставлю на конкурента, хотя ничего про это не читал',
    signs: [{ metricId: 'churn_segment', direction: 'down', target: 5 }],
    confidence: 80, dueWeek: 10
  });
  const d = buildDebrief(s, scenario);
  assert.equal(d.grounds[0].choseWithoutSupport, true);
  assert.equal(d.grounds[0].choseRefuted, false);
  assert.ok(d.questions.some(q => q.includes('ни одного свидетельства')));
});

test('подкреплённый выбор не получает ни одного упрёка по основаниям', () => {
  const s = createSession(scenario, 1);
  openSource(s, scenario, 's_support');       // за h4
  openSource(s, scenario, 's_release_flag');  // против h1
  commitAction(s, scenario, 'a_support_staff', {
    hypothesisId: 'h4', expectation: 'Разгрузим очередь в поддержке, отток пойдёт вниз',
    signs: [{ metricId: 'churn_segment', direction: 'down', target: 6 }],
    confidence: 60, dueWeek: 12
  });
  const d = buildDebrief(s, scenario);
  assert.equal(d.grounds[0].choseRefuted, false);
  assert.equal(d.grounds[0].choseWithoutSupport, false);
  assert.deepEqual(d.grounds[0].supportOpened, ['Метрики поддержки помесячно']);
});

test('контракт со сроком за горизонтом не принимается', () => {
  const s = createSession(scenario, 1);
  const r = commitAction(s, scenario, 'a_discount', {
    hypothesisId: 'h2', expectation: 'Срок поставлю после конца эпизода',
    signs: [{ metricId: 'churn_segment', direction: 'down', target: 5 }],
    confidence: 50, dueWeek: scenario.horizonWeeks + 5
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.join(' ').includes('эпизод кончится раньше'));
});

test('контрольную точку нельзя перешагнуть длинным запросом', () => {
  const s = createSession(scenario, 1);
  step(s, scenario, 3);
  assert.equal(pendingCheckpoint(s, scenario), null);
  openSource(s, scenario, 's_exit'); // 2 недели: с 3-й на 5-ю, точка на 4-й позади
  assert.equal(s.world.week, 5);
  assert.equal(pendingCheckpoint(s, scenario), 4, 'пройденная точка потерялась');
  checkpointNote(s, { confidence: 55, note: 'перешагнул', forCheckpoint: 4, hypothesisId: 'h4' });
  assert.equal(pendingCheckpoint(s, scenario), null);
});

test('самая сильная находка стоит первой, правда — последней', () => {
  const s = createSession(scenario, 1);
  openSource(s, scenario, 's_release_flag');
  openSource(s, scenario, 's_release_notes');
  commitAction(s, scenario, 'a_fix_onboarding', {
    hypothesisId: 'h1', expectation: 'Всё равно чувствую, что дело в онбординге',
    signs: [{ metricId: 'churn_segment', direction: 'down', target: 5 }],
    confidence: 80, dueWeek: 6
  });
  runToEnd(s, scenario);
  const q = buildDebrief(s, scenario).questions;
  assert.ok(q[0].includes('говорил против неё'), `первым идёт: ${q[0]}`);
  assert.ok(q[q.length - 1].includes('Настоящая причина'));
  assert.equal(new Set(q).size, q.length, 'вопросы повторяются');
});

test('в вопросах нет слов из одного конкретного кейса', () => {
  for (const sc of [scenario]) {
    const s = createSession(sc, sc.seed);
    commitAction(s, sc, 'a_discount', {
      hypothesisId: 'h2', expectation: 'Скидка удержит клиентов от ухода',
      signs: [{ metricId: 'churn_segment', direction: 'down', target: 5 }],
      confidence: 60, dueWeek: 5
    });
    step(s, sc, 5);
    commitAction(s, sc, 'a_outreach', {
      hypothesisId: 'h2', expectation: 'Обзвоним тех, кто в группе риска',
      signs: [{ metricId: 'churn_segment', direction: 'down', target: 6 }],
      confidence: 50, dueWeek: 11
    });
    runToEnd(s, sc);
    const q = buildDebrief(s, sc).questions.join(' ');
    assert.ok(!q.includes('отток упал'), 'вопрос написан под один кейс');
  }
});

// Экран «Сравнить» читает выгруженный прогон и показывает таблицу по нескольким
// людям сразу. Если из выгрузки пропадёт хоть одно из этих полей, таблица тихо
// покажет прочерки — и никто не заметит. Поэтому договор проверяется тестом.
test('выгруженный разбор содержит всё, на чём держится сравнение', () => {
  const s = createSession(scenario, 1);
  openSource(s, scenario, 's_support');
  commitAction(s, scenario, 'a_support_staff', {
    hypothesisId: 'h4', expectation: 'Разгрузим очередь, отток пойдёт вниз',
    signs: [{ metricId: 'churn_segment', direction: 'down', target: 6 }],
    confidence: 60, dueWeek: 12
  });
  runToEnd(s, scenario);
  const d = buildDebrief(s, scenario);

  assert.ok(d.scenario?.id, 'нет идентификатора эпизода');
  assert.ok(Array.isArray(d.seeking.order), 'нет порядка запросов');
  assert.ok(Array.isArray(d.seeking.aliveAtDecision));
  assert.equal(typeof d.seeking.diagnosticOpenedBefore, 'number');
  assert.ok(Array.isArray(d.grounds) && d.grounds[0].hypothesisLabel);
  assert.ok(Array.isArray(d.waiting));
  assert.equal(typeof d.breadth.actionCount, 'number');
  assert.equal(typeof d.breadth.categoryCount, 'number');
  assert.ok(d.metricsEnd && typeof d.metricsEnd.churn_segment === 'number');
  assert.ok(d.truth?.label);
  assert.ok(d.contracts[0].verdict === 'met' || d.contracts[0].verdict === 'missed');

  // и всё это должно пережить круг через JSON — именно в таком виде оно ходит
  const round = JSON.parse(JSON.stringify({ session: s, debrief: d }));
  assert.deepEqual(round.debrief.seeking.order, d.seeking.order);
  assert.equal(round.debrief.grounds[0].hypothesisLabel, d.grounds[0].hypothesisLabel);
});

// До первого решения версии ещё нет. Спрашивать «насколько уверен в своей
// версии» у того, кто ничего не решал, бессмысленно — он назовёт её здесь.
test('на точке до первого решения нужно назвать версию', () => {
  const s = createSession(scenario, 1);
  step(s, scenario, 4);
  const empty = checkpointNote(s, { confidence: 40, forCheckpoint: 4 });
  assert.equal(empty.ok, false);
  assert.ok(empty.reason.includes('версию'));

  const named = checkpointNote(s, { confidence: 40, forCheckpoint: 4, hypothesisId: 'h2' });
  assert.equal(named.ok, true);
  const note = s.journal.find(e => e.type === 'note');
  assert.equal(note.hypothesisId, 'h2');
});

test('после решения версия подставляется сама', () => {
  const s = createSession(scenario, 1);
  commitAction(s, scenario, 'a_discount', {
    hypothesisId: 'h2', expectation: 'Скидка удержит клиентов от ухода',
    signs: [{ metricId: 'churn_segment', direction: 'down', target: 5 }],
    confidence: 60, dueWeek: 10
  });
  step(s, scenario, 4);
  const r = checkpointNote(s, { confidence: 45, forCheckpoint: 4 });
  assert.equal(r.ok, true);
  assert.equal(s.journal.find(e => e.type === 'note').hypothesisId, 'h2');
});
