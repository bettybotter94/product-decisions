// Накопление между прогонами. Один прогон — это срез;
// смысл появляется только на нескольких.
//
// Хранится отдельно от прогона: сброс эпизода не стирает историю.

import { calibration } from './analysis.js';

const KEY = 'antilopa:profile';

export function loadProfile() {
  try { return JSON.parse(localStorage.getItem(KEY)) || { runs: [] }; }
  catch { return { runs: [] }; }
}

export function saveProfile(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* приватное окно */ }
}

/** Свернуть прогон в строку истории. Тексты не храним — только поведение. */
export function summarise(session, scenario, debrief) {
  return {
    at: new Date().toISOString(),
    runId: `${scenario.id}-${session.startedAt}`,
    scenarioId: scenario.id,
    caseId: scenario.caseId,
    caseTitle: scenario.caseTitle,
    variant: scenario.variant,
    // первая версия и последняя — разные вещи: смысл кейса «обновлять решение»
    // ровно в том, что вторая может быть верной, когда первая была нет
    guessedRight: debrief.contracts.length
      ? debrief.contracts[0].hypothesisId === scenario.truth.hypothesisId : null,
    endedRight: debrief.contracts.length
      ? debrief.contracts[debrief.contracts.length - 1].hypothesisId === scenario.truth.hypothesisId
      : null,
    sourcesBeforeDecision: debrief.seeking.openedBefore.length,
    diagnosticRatio: debrief.seeking.diagnosticRatio,
    diagnosticCoverage: debrief.seeking.diagnosticCoverage,
    aliveAtDecision: debrief.seeking.aliveAtDecision.length,
    hypothesisCount: scenario.hypotheses.length,
    blindSpots: debrief.seeking.blindSpots.length,
    actionCount: debrief.breadth.actionCount,
    categoryCount: debrief.breadth.categoryCount,
    firstActionWeek: debrief.breadth.firstActionWeek,
    dueBeforeEffect: debrief.timing.filter(t => t.dueBeforeEffect).length,
    actedBeforeOwnDeadline: debrief.waiting.filter(w => w.actedBeforeOwnDeadline).length,
    choseRefuted: debrief.grounds.filter(g => g.choseRefuted).length,
    choseWithoutSupport: debrief.grounds.filter(g => g.choseWithoutSupport).length,
    recoveredAfterError: debrief.afterError
      .filter(e => !e.noFollowUp)
      .map(e => ({ sought: e.soughtNewInformation, changed: e.changedHypothesis })),
    contracts: debrief.contracts.map(c => ({ confidence: c.confidence, verdict: c.verdict })),
    finalMetrics: debrief.metricsEnd,
    startMetrics: debrief.metricsStart
  };
}

export function addRun(profile, row) {
  if (profile.runs.some(r => r.runId === row.runId)) return profile;
  return { ...profile, runs: [...profile.runs, row] };
}

/** Калибровка по всем контрактам всех прогонов сразу.
 *  На одном прогоне её не считаем вовсе: это был бы шум с видом цифры. */
export function profileCalibration(profile) {
  const all = profile.runs.flatMap(r => r.contracts);
  const { rows, n, enoughData } = calibration(all);
  const overconfident = rows
    .filter(r => r.stated - r.actual > 15)
    .reduce((acc, r) => acc + r.n, 0);
  return { rows, n, enough: enoughData, overconfidentShare: n ? overconfident / n : 0 };
}

/** Динамика: первая половина прогонов против второй. */
export function trend(profile, field) {
  const vals = profile.runs.map(r => r[field]).filter(v => typeof v === 'number');
  if (vals.length < 4) return null;
  const half = Math.floor(vals.length / 2);
  const avg = a => a.reduce((s, x) => s + x, 0) / a.length;
  const before = avg(vals.slice(0, half)), after = avg(vals.slice(half));
  return { before, after, delta: after - before, n: vals.length };
}

export function byCase(profile) {
  const map = {};
  for (const r of profile.runs) {
    map[r.caseId] = map[r.caseId] || { caseId: r.caseId, caseTitle: r.caseTitle, runs: [] };
    map[r.caseId].runs.push(r);
  }
  return Object.values(map);
}
