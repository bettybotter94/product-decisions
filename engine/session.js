// Прогон. Склеивает мир, журнал и контракты.
// Важно: контракты сюда попадают, но в резольвер не передаются —
// applyAction получает только (world, scenario, actionId).

import { createWorld } from './world.js';
import { applyAction, spendWeeks, advance } from './resolver.js';
import { createContract, evaluateContract } from './contracts.js';
import { log, EV } from './journal.js';

/**
 * Отпечаток сценария: всё, что влияет на ход игры.
 * Нужен, чтобы сохранённый прогон не смешивал старые правила с новыми,
 * когда содержание переписали, а в браузере остался незаконченный заход.
 */
export function fingerprint(scenario) {
  const material = JSON.stringify([
    scenario.horizonWeeks, scenario.checkpoints,
    scenario.initialMetrics, scenario.truth, scenario.drift,
    scenario.sources.map(x => [x.id, x.costWeeks, x.evidence, x.diagnostic, x.purpose]),
    scenario.actions.map(x => [x.id, x.costWeeks, x.category]),
    scenario.rules
  ]);
  let h = 2166136261;
  for (let i = 0; i < material.length; i++) {
    h ^= material.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export function createSession(scenario, seed = scenario.seed ?? 1) {
  return {
    scenarioId: scenario.id,
    scenarioFingerprint: fingerprint(scenario),
    seed,
    startedAt: new Date().toISOString(),
    world: createWorld(scenario),
    journal: [],
    contracts: [],
    openedSources: [],
    finished: false
  };
}

export function openSource(session, scenario, sourceId) {
  if (session.finished) return { ok: false, reason: 'Прогон завершён' };
  if (session.openedSources.includes(sourceId)) return { ok: false, reason: 'Уже открыт' };
  const src = scenario.sources.find(s => s.id === sourceId);
  if (!src) return { ok: false, reason: 'Нет такого источника' };

  const res = spendWeeks(session.world, scenario, src.costWeeks, `запрос: ${src.label}`);
  if (!res.ok) return res;

  session.openedSources.push(sourceId);
  log(session, { type: EV.OPEN_SOURCE, sourceId, costWeeks: src.costWeeks });
  return { ok: true, content: src.content };
}

export function commitAction(session, scenario, actionId, contractInput) {
  if (session.finished) return { ok: false, reason: 'Прогон завершён' };
  if (contractInput.dueWeek > scenario.horizonWeeks) {
    return { ok: false,
      errors: [`Срок не может быть позже ${scenario.horizonWeeks}-й недели: эпизод кончится раньше`] };
  }

  // неделя, на которой решение принято: работа начнётся с неё,
  // а календарь после неё уедет вперёд на длительность работы
  const decidedAt = session.world.week;

  const made = createContract({ ...contractInput, week: decidedAt });
  if (!made.ok) return { ok: false, errors: made.errors };

  // Резольвер не получает made.contract. Только actionId.
  const applied = applyAction(session.world, scenario, actionId);
  if (!applied.ok) return applied;

  const contract = { ...made.contract, actionId };
  session.contracts.push(contract);
  log(session, { type: EV.CONTRACT, contract, week: decidedAt });
  log(session, { type: EV.ACTION, actionId, week: decidedAt });
  return { ok: true };
}

/**
 * Прокрутить время. На контрольной точке время останавливается само:
 * команда «+4 недели» возвращает столько недель, сколько реально прошло.
 */
export function step(session, scenario, weeks) {
  if (session.finished) return { ok: false, reason: 'Прогон завершён' };
  const before = session.world.week;
  const target = before + weeks;
  const stop = scenario.checkpoints.find(c => c > before && c < target);
  const to = stop ?? target;

  advance(session.world, scenario, to - before);
  log(session, { type: EV.ADVANCE, from: before, to: session.world.week });

  const atCheckpoint = scenario.checkpoints.includes(session.world.week);
  if (atCheckpoint) log(session, { type: EV.CHECKPOINT, week: session.world.week });

  return {
    ok: true, week: session.world.week,
    weeksCommitted: session.world.week - before,
    stoppedAtCheckpoint: atCheckpoint ? session.world.week : null
  };
}

/**
 * Отметка на контрольной точке: человек не действует, но говорит,
 * что сейчас думает и насколько уверен. Это данные о динамике уверенности,
 * а не действие — мир от неё не меняется.
 */
export function checkpointNote(session, { confidence, note, forCheckpoint, covers, hypothesisId }) {
  if (session.finished) return { ok: false, reason: 'Прогон завершён' };
  if (!(confidence >= 1 && confidence <= 99)) return { ok: false, reason: 'Уверенность от 1 до 99%' };
  // До первого решения версии ещё нет — её здесь и называют.
  // Спрашивать «насколько уверен в своей версии» у того, кто ничего
  // не решал, бессмысленно: уверен в чём?
  if (!session.contracts.length && !hypothesisId) {
    return { ok: false, reason: 'Назови версию, которая сейчас кажется самой правдоподобной' };
  }
  // Долгая работа может проскочить несколько точек разом. Тогда отметка
  // одна и закрывает их все: спрашивать одно и то же дважды подряд —
  // это выглядит как неработающая кнопка.
  const closes = covers && covers.length ? covers : [forCheckpoint ?? session.world.week];
  log(session, { type: EV.NOTE, confidence, note: (note || '').trim(),
                 hypothesisId: hypothesisId ?? session.contracts[session.contracts.length - 1]?.hypothesisId,
                 forCheckpoint: closes[closes.length - 1], covers: closes });
  return { ok: true };
}

/**
 * Ближайшая контрольная точка, которую уже прошли, но ещё не отметили.
 * Точку можно перешагнуть: запрос сведений стоит недель и время идёт целиком.
 */
export function pendingCheckpoints(session, scenario) {
  if (session.finished) return [];
  if (session.world.week >= scenario.horizonWeeks) return [];
  const noted = new Set();
  for (const e of session.journal) {
    if (e.type !== EV.NOTE) continue;
    for (const c of e.covers ?? [e.forCheckpoint]) noted.add(c);
  }
  return scenario.checkpoints.filter(c => c > 0 && c <= session.world.week && !noted.has(c));
}

export function pendingCheckpoint(session, scenario) {
  return pendingCheckpoints(session, scenario)[0] ?? null;
}

/** Промотать до конца горизонта, останавливаясь на каждой контрольной точке.
 *  Нужно для тестов и проверок баланса; в интерфейсе время двигает человек. */
export function runToEnd(session, scenario) {
  let guard = 0;
  while (session.world.week < scenario.horizonWeeks && guard++ < 100) {
    step(session, scenario, scenario.horizonWeeks - session.world.week);
  }
  return session.world.week;
}

export function finish(session, scenario) {
  session.finished = true;
  log(session, { type: EV.FINISH });
  return evaluateAll(session, scenario);
}

export function evaluateAll(session, scenario) {
  return session.contracts.map(c => evaluateContract(c, session.world, scenario));
}
