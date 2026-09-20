// Проверка содержания. Гоняется по всем эпизодам сразу.
// Это не проверка кода, а проверка того, что сценарий вообще играбелен:
// у каждой ложной версии есть чем её опровергнуть, у правды — чем подтвердить,
// мир выигрываем, а бюджета не хватает, чтобы открыть всё и сделать всё.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EPISODES, keyMetric } from '../scenarios/index.js';
import { createSession, openSource, commitAction, runToEnd, finish } from '../engine/session.js';
import { buildDebrief } from '../engine/debrief.js';

function play(sc, actionId) {
  const s = createSession(sc, sc.seed);
  if (actionId) {
    const r = commitAction(s, sc, actionId, {
      hypothesisId: sc.hypotheses[0].id,
      expectation: 'проверочный прогон движка на баланс сценария',
      signs: [{ metricId: keyMetric(sc), direction: 'down', target: 0 }],
      confidence: 50, dueWeek: sc.horizonWeeks
    });
    if (!r.ok) return null;
  }
  runToEnd(s, sc);
  return s.world.metrics;
}

const uniq = a => new Set(a).size === a.length;

for (const sc of EPISODES) {
  test(`[${sc.id}] опознавательные поля на месте`, () => {
    for (const f of ['id', 'caseId', 'variant', 'title', 'brief', 'goal', 'context', 'targetBehaviour'])
      assert.ok(sc[f], `нет поля ${f}`);
    assert.ok(sc.horizonWeeks > 0);
  });

  test(`[${sc.id}] идентификаторы не повторяются`, () => {
    assert.ok(uniq(sc.sources.map(s => s.id)), 'дубли среди источников');
    assert.ok(uniq(sc.actions.map(a => a.id)), 'дубли среди действий');
    assert.ok(uniq(sc.hypotheses.map(h => h.id)), 'дубли среди версий');
  });

  test(`[${sc.id}] показатели согласованы`, () => {
    const ids = Object.keys(sc.metrics);
    for (const m of ids) {
      assert.ok(sc.initialMetrics[m] !== undefined, `нет стартового значения: ${m}`);
      assert.ok(['up', 'down'].includes(sc.metrics[m].better));
      // Показатель без объяснения — жаргон: участник видит число и не знает,
      // много это или мало.
      assert.ok(sc.metrics[m].hint && sc.metrics[m].hint.length > 25,
        `${m}: нет человеческого пояснения`);
    }
    assert.deepEqual(Object.keys(sc.initialMetrics).sort(), ids.sort());
    for (const d of sc.drift || []) assert.ok(ids.includes(d.metric), `дрейф по неизвестному показателю: ${d.metric}`);
  });

  test(`[${sc.id}] правила ссылаются на существующее`, () => {
    const actionIds = sc.actions.map(a => a.id);
    const hypIds = sc.hypotheses.map(h => h.id);
    for (const r of sc.rules) {
      assert.ok(actionIds.includes(r.action), `правило для неизвестного действия: ${r.action}`);
      if (r.ifTruth) assert.ok(hypIds.includes(r.ifTruth));
      if (r.unlessTruth) assert.ok(hypIds.includes(r.unlessTruth));
      assert.ok(r.note && r.note.length > 10, `у правила ${r.action} нет объяснения для разбора`);
      for (const e of r.effects) {
        assert.ok(sc.metrics[e.metric], `эффект по неизвестному показателю: ${e.metric}`);
        assert.ok(e.afterWeeks > 0 && e.afterWeeks <= sc.horizonWeeks, 'эффект вне горизонта');
      }
    }
  });

  test(`[${sc.id}] у каждого действия есть хотя бы одно правило`, () => {
    for (const a of sc.actions)
      assert.ok(sc.rules.some(r => r.action === a.id),
        `действие «${a.label}» ничего не делает и не объяснено`);
  });

  test(`[${sc.id}] разметка источников корректна`, () => {
    const hypIds = sc.hypotheses.map(h => h.id);
    for (const s of sc.sources) {
      assert.ok(typeof s.diagnostic === 'boolean', `${s.id}: не размечен diagnostic`);
      assert.ok(s.content && s.content.length > 30, `${s.id}: пустое содержимое`);
      for (const [h, v] of Object.entries(s.evidence || {})) {
        assert.ok(hypIds.includes(h), `${s.id}: ссылка на неизвестную версию ${h}`);
        assert.ok(['for', 'against', 'neutral'].includes(v));
      }
      const hasSignal = Object.values(s.evidence || {}).some(v => v !== 'neutral');
      assert.equal(s.diagnostic, hasSignal,
        `${s.id}: пометка diagnostic расходится с разметкой evidence`);
      const purpose = s.purpose || 'diagnosis';
      assert.ok(['diagnosis', 'execution'].includes(purpose), `${s.id}: неизвестное purpose`);
      if (purpose === 'execution')
        assert.ok(!s.diagnostic && !Object.keys(s.evidence || {}).length,
          `${s.id}: источник о выполнимости не может различать версии`);
    }
  });

  test(`[${sc.id}] правда подтверждаема, а ложные версии опровержимы`, () => {
    const truth = sc.truth.hypothesisId;
    assert.ok(sc.hypotheses.some(h => h.id === truth), 'правда указывает в никуда');
    assert.ok(sc.sources.some(s => s.evidence?.[truth] === 'for'),
      'нет ни одного источника, поддерживающего настоящую причину');
    for (const h of sc.hypotheses) {
      if (h.id === truth) continue;
      assert.ok(sc.sources.some(s => s.evidence?.[h.id] === 'against'),
        `версию «${h.label}» нечем опровергнуть — человек не сможет её отсечь`);
    }
    assert.ok(!sc.sources.some(s => s.evidence?.[truth] === 'against'),
      'источник опровергает настоящую причину — противоречие в сценарии');
  });

  test(`[${sc.id}] мир выигрываем`, () => {
    assert.ok(sc.rules.some(r => r.ifTruth === sc.truth.hypothesisId && r.effects.length),
      'ни одно действие не даёт эффекта при настоящей причине');
  });

  test(`[${sc.id}] всё узнать и успеть починить нельзя`, () => {
    // Ресурс один — время до отчёта. Оно уходит и на сбор сведений,
    // и на саму работу, и на то, чтобы эффект успел проявиться.
    const allSources = sc.sources.reduce((n, s) => n + s.costWeeks, 0);
    const rule = sc.rules.find(r => r.ifTruth === sc.truth.hypothesisId && r.effects.length);
    const fix = sc.actions.find(a => a.id === rule.action);
    const lastEffect = Math.max(...rule.effects.map(e => e.afterWeeks));
    assert.ok(allSources + fix.costWeeks + lastEffect > sc.horizonWeeks,
      'времени хватает и на всё узнать, и на починку с полным эффектом — выбора нет');
    assert.ok(allSources < sc.horizonWeeks,
      'на сбор сведений не хватает даже теоретически');
  });

  test(`[${sc.id}] эффект не появляется раньше, чем закончена работа`, () => {
    for (const r of sc.rules) {
      const a = sc.actions.find(x => x.id === r.action);
      for (const e of r.effects) {
        assert.ok(e.afterWeeks >= a.costWeeks,
          `«${a.label}»: эффект на ${e.afterWeeks}-й неделе, а работа идёт ${a.costWeeks}`);
      }
    }
  });

  test(`[${sc.id}] действие под настоящую причину заметно лучше бездействия`, () => {
    const m = keyMetric(sc);
    const better = sc.metrics[m].better;
    const idle = play(sc, null)[m];
    const rule = sc.rules.find(r => r.ifTruth === sc.truth.hypothesisId && r.effects.length);
    const best = play(sc, rule.action);
    assert.ok(best, `действие «${rule.action}» не по карману — эпизод непроходим`);
    const gain = better === 'down' ? idle - best[m] : best[m] - idle;
    assert.ok(gain > 1, `правильное действие почти не отличается от бездействия (${gain.toFixed(2)})`);
  });

  test(`[${sc.id}] ни одно действие не бесплатно`, () => {
    const rule = sc.rules.find(r => r.ifTruth === sc.truth.hypothesisId && r.effects.length);
    const action = sc.actions.find(a => a.id === rule.action);
    assert.ok(action.costWeeks > 0, 'правильное действие ничего не стоит — выбор фиктивен');
  });

  test(`[${sc.id}] контрольные точки внутри горизонта и ни одна не мёртвая`, () => {
    const cp = sc.checkpoints;
    assert.deepEqual(cp, [...cp].sort((a, b) => a - b));
    // Точка, совпадающая с концом эпизода, не срабатывает никогда:
    // на последней неделе останавливать уже нечего, дальше разбор.
    assert.ok(Math.max(...cp) < sc.horizonWeeks,
      'последняя точка совпадает с концом эпизода — она мертва');
    assert.ok(Math.min(...cp) > 0);
  });
}

for (const sc of EPISODES) {
  test(`[${sc.id}] разбор собирается и не падает`, () => {
    const s = createSession(sc, sc.seed);
    const free = sc.sources.filter(x => x.costWeeks <= 1).slice(0, 2);
    for (const src of free) openSource(s, sc, src.id);
    const m = keyMetric(sc);
    commitAction(s, sc, sc.actions[0].id, {
      hypothesisId: sc.hypotheses[0].id,
      expectation: 'проверочный прогон: собирается ли разбор целиком',
      signs: [{ metricId: m, direction: sc.metrics[m].better, target: 1 }],
      confidence: 70, dueWeek: Math.min(sc.horizonWeeks, sc.checkpoints[0] + 2)
    });
    runToEnd(s, sc);
    finish(s, sc);
    const d = buildDebrief(s, sc);
    assert.ok(d.questions.length >= 2, 'разбор не задаёт вопросов');
    assert.ok(d.truth && d.truth.label);
    assert.ok(Array.isArray(d.timing));
    assert.ok(d.worldLog.some(w => w.type === 'rule'), 'мир не объяснил, что произошло');
    for (const q of d.questions)
      assert.ok(!q.includes('undefined') && !q.includes('NaN'), `дырка в вопросе: ${q}`);
  });
}

test('идентификаторы эпизодов уникальны', () => {
  assert.ok(uniq(EPISODES.map(e => e.id)));
});
