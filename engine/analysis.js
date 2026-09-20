// Анализ поведения. Считается из журнала после прогона.
// Ничего не меняет в мире.

import { EV } from './journal.js';

/** Какие объяснения оставались живы при заданном наборе открытых источников. */
export function aliveHypotheses(scenario, openedIds) {
  const killed = new Set();
  for (const id of openedIds) {
    const src = scenario.sources.find(s => s.id === id);
    if (!src) continue;
    for (const [hyp, verdict] of Object.entries(src.evidence || {})) {
      if (verdict === 'against') killed.add(hyp);
    }
  }
  return scenario.hypotheses.filter(h => !killed.has(h.id));
}

/** Источник отвечает на вопрос «что здесь правда» или «что мы вообще можем».
 *  Второе не должно считаться подтверждающим запросом: это другой вопрос. */
const purposeOf = src => src?.purpose || 'diagnosis';

/** Качество запросов до первого вмешательства. */
export function informationSeeking(scenario, journal) {
  const firstAction = journal.find(e => e.type === EV.ACTION);
  const cutoff = firstAction ? firstAction.seq : Infinity;

  const openedBefore = journal
    .filter(e => e.type === EV.OPEN_SOURCE && e.seq < cutoff)
    .map(e => e.sourceId);
  const openedEver = journal
    .filter(e => e.type === EV.OPEN_SOURCE)
    .map(e => e.sourceId);

  const src = id => scenario.sources.find(s => s.id === id);
  const isDiag = id => !!src(id)?.diagnostic;
  const isExec = id => purposeOf(src(id)) === 'execution';

  const causeBefore = openedBefore.filter(id => !isExec(id));
  const execBefore = openedBefore.filter(isExec);
  const diagBefore = causeBefore.filter(isDiag);
  const allDiag = scenario.sources.filter(s => s.diagnostic);

  return {
    openedBefore,
    openedEver,
    diagnosticOpenedBefore: diagBefore.length,
    nonDiagnosticOpenedBefore: causeBefore.length - diagBefore.length,
    feasibilityOpenedBefore: execBefore.length,
    diagnosticRatio: causeBefore.length ? diagBefore.length / causeBefore.length : null,
    diagnosticCoverage: diagBefore.length / allDiag.length,
    blindSpots: allDiag.filter(s => !openedEver.includes(s.id)),
    aliveAtDecision: aliveHypotheses(scenario, openedBefore),
    decidedWithoutAsking: openedBefore.length === 0 && !!firstAction,
    // порядок важен не меньше состава: с чего человек начал —
    // это и есть его рабочая гипотеза, даже если он её не назвал
    order: openedBefore.map(id => {
      const x = src(id);
      return {
        id,
        label: x?.label ?? id,
        diagnostic: !!x?.diagnostic,
        feasibility: isExec(id),
        costWeeks: x?.costWeeks ?? 0
      };
    })
  };
}

/**
 * Чем была подкреплена та версия, которую человек назвал в контракте.
 *
 * Считается по источникам, открытым ДО этого контракта, и различает три вещи,
 * которые в разговоре обычно сливаются:
 *   — версия выбрана, и у неё есть прямое подтверждение;
 *   — версия выбрана, но подтверждений нет: её просто не опровергли;
 *   — версия выбрана вопреки прочитанному — человек сам открыл источник,
 *     который её опровергает, и всё равно на неё поставил.
 *
 * Третье — самый сильный материал для разбора: дело уже не в сборе сведений.
 */
export function evidenceBehindChoice(scenario, journal, contracts) {
  const opensBefore = seq => journal
    .filter(e => e.type === EV.OPEN_SOURCE && e.seq < seq)
    .map(e => scenario.sources.find(s => s.id === e.sourceId))
    .filter(Boolean);

  return contracts.map(c => {
    const contractEvent = journal.find(
      e => e.type === EV.CONTRACT && e.contract && e.contract.id === c.id
    );
    const seen = opensBefore(contractEvent ? contractEvent.seq : Infinity);
    const hyp = scenario.hypotheses.find(h => h.id === c.hypothesisId);
    const support = seen.filter(s => s.evidence?.[c.hypothesisId] === 'for');
    const against = seen.filter(s => s.evidence?.[c.hypothesisId] === 'against');

    return {
      contractId: c.id,
      hypothesisId: c.hypothesisId,
      hypothesisLabel: hyp ? hyp.label : null,
      confidence: c.confidence,
      supportOpened: support.map(s => s.label),
      refutedBy: against.map(s => s.label),
      choseRefuted: against.length > 0,
      choseWithoutSupport: support.length === 0 && against.length === 0,
      sourcesSeen: seen.length
    };
  });
}

/** Широта вмешательства: сколько разного запустили и как быстро. */
export function interventionBreadth(scenario, journal) {
  const actions = journal.filter(e => e.type === EV.ACTION);
  const categories = new Set(
    actions.map(a => scenario.actions.find(x => x.id === a.actionId)?.category)
  );
  return {
    actionCount: actions.length,
    categoryCount: categories.size,
    categories: [...categories],
    firstActionWeek: actions[0]?.week ?? null,
    actions: actions.map(a => ({ week: a.week, actionId: a.actionId }))
  };
}

/**
 * Поведение после ошибки.
 * Точка разлома — день, когда признаки контракта не сбылись к сроку.
 * Смотрим, что человек сделал дальше.
 */
export function postErrorBehaviour(scenario, journal, evaluatedContracts) {
  const missed = evaluatedContracts.filter(c => c.verdict === 'missed');
  return missed.map(c => {
    const after = journal.filter(e => e.week >= c.dueWeek);
    const nextAction = after.find(e => e.type === EV.ACTION);
    const sourcesBetween = after
      .filter(e => e.type === EV.OPEN_SOURCE && (!nextAction || e.seq < nextAction.seq))
      .map(e => e.sourceId);
    const nextContract = after.find(e => e.type === EV.CONTRACT);

    const prevActionId = [...journal]
      .filter(e => e.type === EV.ACTION && e.week <= c.dueWeek)
      .pop()?.actionId;
    const catOf = id => scenario.actions.find(a => a.id === id)?.category;

    return {
      contractId: c.id,
      brokenAtWeek: c.dueWeek,
      // разлом на самом краю эпизода: продолжения не было, судить не о чем
      noFollowUp: !nextAction && !nextContract,
      soughtNewInformation: sourcesBetween.length > 0,
      sourcesBetween,
      diagnosticSourcesBetween: sourcesBetween.filter(
        id => scenario.sources.find(s => s.id === id)?.diagnostic
      ).length,
      changedHypothesis: nextContract
        ? nextContract.contract.hypothesisId !== c.hypothesisId
        : null,
      confidenceDelta: nextContract ? nextContract.contract.confidence - c.confidence : null,
      repeatedSameCategory: nextAction && prevActionId
        ? catOf(nextAction.actionId) === catOf(prevActionId)
        : null,
      weeksToNextAction: nextAction ? nextAction.week - c.dueWeek : null
    };
  });
}

/** Калибровка: накапливается по многим контрактам, на одном эпизоде не считается. */
export function calibration(evaluatedContracts) {
  const buckets = {};
  for (const c of evaluatedContracts) {
    const b = Math.min(90, Math.max(10, Math.round(c.confidence / 10) * 10));
    buckets[b] = buckets[b] || { stated: b, n: 0, met: 0 };
    buckets[b].n += 1;
    if (c.verdict === 'met') buckets[b].met += 1;
  }
  const rows = Object.values(buckets)
    .sort((a, b) => a.stated - b.stated)
    .map(b => ({ ...b, actual: Math.round((b.met / b.n) * 100) }));
  return {
    rows,
    n: evaluatedContracts.length,
    enoughData: evaluatedContracts.length >= 10
  };
}



/**
 * Дождался ли человек собственного срока.
 * Новое решение до наступления назначенной проверки — не ошибка сама по себе,
 * но это значит, что предыдущий контракт так и не был проверен.
 */
export function patience(scenario, journal, contracts) {
  const actions = journal.filter(e => e.type === EV.ACTION);
  return contracts.map(c => {
    const early = actions.filter(a => a.week > c.week && a.week < c.dueWeek);
    return {
      contractId: c.id,
      dueWeek: c.dueWeek,
      actedBeforeOwnDeadline: early.length > 0,
      firstEarlyActionWeek: early.length ? early[0].week : null,
      weeksNotWaited: early.length ? c.dueWeek - early[0].week : 0
    };
  });
}

/**
 * Мог ли признак вообще успеть проявиться к назначенному сроку.
 * Считается по ВСЕМ правилам действия, независимо от того, какая версия верна, —
 * иначе подсказка выдавала бы правду.
 */
export function timingCheck(scenario, contracts) {
  return contracts.map(c => {
    const all = scenario.rules.filter(r => r.action === c.actionId).flatMap(r => r.effects);
    if (!all.length) return { contractId: c.id, known: false };
    const earliest = c.week + Math.min(...all.map(e => e.afterWeeks));
    return {
      contractId: c.id,
      known: true,
      earliestPossibleWeek: earliest,
      dueWeek: c.dueWeek,
      dueBeforeEffect: c.dueWeek < earliest
    };
  });
}
