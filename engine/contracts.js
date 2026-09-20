// Контракт решения. Хранится отдельно от мира.
// Резольвер этот модуль не импортирует — см. resolver.js.

export function createContract({ week, hypothesisId, expectation, signs, confidence, dueWeek }) {
  const errors = [];
  if (!hypothesisId) errors.push('Не выбрана версия происходящего');
  if (!expectation || expectation.trim().length < 10) errors.push('Не описан ожидаемый результат');
  if (!signs || signs.length === 0) errors.push('Не выбран ни один наблюдаемый признак');
  if (!(confidence >= 1 && confidence <= 99)) errors.push('Уверенность должна быть от 1 до 99%');
  if (!(dueWeek > week)) errors.push('Срок должен быть позже текущей недели');
  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    contract: {
      id: `c${week}-${Math.random().toString(36).slice(2, 7)}`,
      week, hypothesisId, expectation: expectation.trim(),
      signs, confidence, dueWeek, verdict: null
    }
  };
}

/**
 * Сверка. Происходит ПОСЛЕ того, как исход зафиксирован.
 * Ничего не возвращает в мир — только читает историю.
 */
export function evaluateContract(contract, world, scenario) {
  const results = contract.signs.map(sign => {
    const atDue = pickMetric(world, sign.metricId, contract.dueWeek);
    const atStart = pickMetric(world, sign.metricId, contract.week);
    let met = false;
    if (atDue !== undefined) {
      met = sign.direction === 'down' ? atDue <= sign.target : atDue >= sign.target;
    }
    return { ...sign, atStart, atDue, met };
  });
  const allMet = results.every(r => r.met);
  return { ...contract, verdict: allMet ? 'met' : 'missed', signResults: results };
}

function pickMetric(world, metricId, week) {
  let best;
  for (const h of world.history) if (h.week <= week) best = h;
  return best?.metrics[metricId];
}
