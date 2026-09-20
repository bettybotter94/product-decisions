// РЕЗОЛЬВЕР. Единственное место, где меняется мир.
//
// ИНВАРИАНТ: этот модуль не импортирует и не получает контракты решений.
// На вход — только состояние мира, сценарий и совершённые действия.
// Проверяется тестом test/resolver-isolation.test.js.
//
// Языковая модель здесь не вызывается и вызываться не должна.

import { snapshot, clamp } from './world.js';

function matchingRules(scenario, actionId) {
  const truth = scenario.truth?.hypothesisId;
  return scenario.rules.filter(r => {
    if (r.action !== actionId) return false;
    if (r.ifTruth && r.ifTruth !== truth) return false;
    if (r.unlessTruth && r.unlessTruth === truth) return false;
    return true;
  });
}

/**
 * Совершить действие.
 *
 * Ресурс здесь один — время до отчёта. Работа занимает недели, и эти же
 * недели уходят из календаря: пока команда делает, срок приближается.
 * Поэтому долгая правильная починка может не успеть подействовать —
 * и это не баг, а суть выбора.
 */
export function applyAction(world, scenario, actionId) {
  const action = scenario.actions.find(a => a.id === actionId);
  if (!action) throw new Error(`Неизвестное действие: ${actionId}`);
  if (world.week + action.costWeeks > scenario.horizonWeeks) {
    return { ok: false, reason: 'До конца эпизода столько времени не осталось' };
  }
  const rules = matchingRules(scenario, actionId);
  for (const rule of rules) {
    for (const e of rule.effects) {
      world.pending.push({
        atWeek: world.week + e.afterWeeks,
        metric: e.metric,
        delta: e.delta,
        sourceAction: actionId
      });
    }
    world.worldLog.push({ week: world.week, type: 'rule', actionId, note: rule.note });
  }
  if (rules.length === 0) {
    world.worldLog.push({
      week: world.week, type: 'rule', actionId,
      note: 'Для этого действия правил с эффектом не задано.'
    });
  }

  // команда занята ровно столько, сколько стоит работа
  if (action.costWeeks > 0) advance(world, scenario, action.costWeeks, action.label);

  return { ok: true, effectsScheduled: rules.reduce((n, r) => n + r.effects.length, 0) };
}

/** Запрос сведений тоже стоит времени: пока собирают, срок приближается. */
export function spendWeeks(world, scenario, weeks, label) {
  if (weeks <= 0) return { ok: true };
  if (world.week + weeks > scenario.horizonWeeks) {
    return { ok: false, reason: 'До конца эпизода столько времени не осталось' };
  }
  advance(world, scenario, weeks, label);
  return { ok: true };
}

/** Прокрутить время. Детерминировано: одно состояние + те же команды = тот же исход. */
export function advance(world, scenario, weeks, label = 'время') {
  const stopAt = Math.min(world.week + weeks, scenario.horizonWeeks);
  while (world.week < stopAt) {
    world.week += 1;

    for (const d of scenario.drift || []) {
      // Значения храним без округления: округление на каждом шаге
      // съедало бы медленный дрейф. Округляем только при показе.
      world.metrics[d.metric] = clamp(scenario, d.metric,
        world.metrics[d.metric] + d.deltaPerWeek);
    }

    const due = world.pending.filter(p => p.atWeek === world.week);
    for (const p of due) {
      world.metrics[p.metric] = clamp(scenario, p.metric, world.metrics[p.metric] + p.delta);
      world.worldLog.push({
        week: world.week, type: 'effect', metric: p.metric,
        delta: p.delta, sourceAction: p.sourceAction
      });
    }
    world.pending = world.pending.filter(p => p.atWeek !== world.week);

    world.history.push(snapshot(world));
  }
  return { week: world.week, reachedHorizon: world.week >= scenario.horizonWeeks, label };
}
