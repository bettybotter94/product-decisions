import { test } from 'node:test';
import assert from 'node:assert/strict';
import scenario from '../scenarios/churn-a.js';
import { createSession, openSource, commitAction, step, runToEnd, finish } from '../engine/session.js';
import { buildDebrief } from '../engine/debrief.js';

const contract = (over = {}) => ({
  hypothesisId: 'h4',
  expectation: 'Если причина в поддержке, отток пойдёт вниз после разгрузки очереди',
  signs: [{ metricId: 'churn_segment', direction: 'down', target: 5.0 }],
  confidence: 70,
  dueWeek: 10,
  ...over
});

test('мир детерминирован: тот же прогон — тот же исход', () => {
  const run = () => {
    const s = createSession(scenario, 1);
    openSource(s, scenario, 's_cohorts');
    commitAction(s, scenario, 'a_support_staff', contract());
    runToEnd(s, scenario);
    return s.world.metrics;
  };
  assert.deepEqual(run(), run());
});

test('правильный диагноз даёт эффект, неправильный — нет', () => {
  const right = createSession(scenario, 1);
  commitAction(right, scenario, 'a_support_staff', contract());
  runToEnd(right, scenario);

  const wrong = createSession(scenario, 1);
  commitAction(wrong, scenario, 'a_fix_onboarding', contract({ hypothesisId: 'h1' }));
  runToEnd(wrong, scenario);

  assert.ok(right.world.metrics.churn_segment < wrong.world.metrics.churn_segment - 1.5);
});

test('скидка придерживает отток, потом отпускает, и режет выручку', () => {
  const s = createSession(scenario, 1);
  commitAction(s, scenario, 'a_discount', contract({ hypothesisId: 'h2' }));
  step(s, scenario, 5);
  const mid = s.world.metrics.churn_segment;
  step(s, scenario, 6);
  assert.ok(s.world.metrics.churn_segment > mid, 'эффект скидки должен таять');
  assert.ok(s.world.metrics.revenue_segment < scenario.initialMetrics.revenue_segment);
});

test('контракт без наблюдаемого признака не принимается', () => {
  const s = createSession(scenario, 1);
  const res = commitAction(s, scenario, 'a_discount', contract({ signs: [] }));
  assert.equal(res.ok, false);
  assert.ok(res.errors.join(' ').includes('признак'));
});

test('запрос сведений стоит времени', () => {
  const s = createSession(scenario, 1);
  const cost = scenario.sources.find(x => x.id === 's_exit').costWeeks;
  openSource(s, scenario, 's_exit');
  assert.equal(s.world.week, cost, 'запрос не сдвинул календарь');
});

test('работа тоже занимает время: ресурс один', () => {
  const s = createSession(scenario, 1);
  const a = scenario.actions.find(x => x.id === 'a_fix_onboarding');
  commitAction(s, scenario, 'a_fix_onboarding', contract({ hypothesisId: 'h1', dueWeek: 12 }));
  assert.equal(s.world.week, a.costWeeks,
    'команда работала, а календарь стоял — значит, ресурса два, а должен быть один');
});

test('нельзя начать работу, которая не успеет до конца эпизода', () => {
  const s = createSession(scenario, 1);
  step(s, scenario, 4);
  step(s, scenario, 4);
  step(s, scenario, 2); // 10-я неделя из 12
  const r = commitAction(s, scenario, 'a_fix_onboarding', contract({ hypothesisId: 'h1', dueWeek: 12 }));
  assert.equal(r.ok, false);
  assert.ok(r.reason.includes('не осталось'));
});

test('нельзя выйти за горизонт эпизода', () => {
  const s = createSession(scenario, 1);
  runToEnd(s, scenario);
  assert.equal(s.world.week, scenario.horizonWeeks);
});

test('время само останавливается на контрольной точке', () => {
  const s = createSession(scenario, 1);
  const r = step(s, scenario, 30);
  assert.equal(r.stoppedAtCheckpoint, scenario.checkpoints[0]);
  assert.equal(r.weeksCommitted, scenario.checkpoints[0]);
  assert.equal(s.world.week, scenario.checkpoints[0]);
});
