// Разбор. Здесь собирается всё, что человек увидит после прогона.
// Это половина продукта.

import {
  informationSeeking, interventionBreadth, postErrorBehaviour, aliveHypotheses,
  timingCheck, patience, evidenceBehindChoice
} from './analysis.js';
import { evaluateAll } from './session.js';

export function buildDebrief(session, scenario) {
  const contracts = evaluateAll(session, scenario);
  const seeking = informationSeeking(scenario, session.journal);
  const breadth = interventionBreadth(scenario, session.journal);
  const afterError = postErrorBehaviour(scenario, session.journal, contracts);
  const timing = timingCheck(scenario, contracts);
  const waiting = patience(scenario, session.journal, contracts);
  const grounds = evidenceBehindChoice(scenario, session.journal, contracts);

  const truth = scenario.hypotheses.find(h => h.id === scenario.truth.hypothesisId);

  return {
    scenario: { id: scenario.id, title: scenario.title },
    finalWeek: session.world.week,
    metricsStart: session.world.history[0].metrics,
    metricsEnd: session.world.metrics,
    truth,
    contracts,
    seeking,
    breadth,
    afterError,
    timing,
    waiting,
    grounds,
    notOpened: scenario.sources.filter(s => !session.openedSources.includes(s.id)),
    aliveAtEnd: aliveHypotheses(scenario, session.openedSources),
    worldLog: session.world.worldLog,
    questions: discussionQuestions({ seeking, breadth, contracts, afterError, timing, waiting, grounds, truth })
  };
}

/**
 * Вопросы для того, кто ведёт разбор.
 *
 * Не оценки, а вопросы, и отсортированы по силе находки: ведущий читает
 * сверху вниз, и первым идёт самое важное, что видно в этом прогоне.
 * Правда варианта всегда последняя — если назвать её раньше, весь разбор
 * превратится в объяснение, почему человек её не увидел.
 */
function discussionQuestions({ seeking, breadth, contracts, afterError, timing, waiting, grounds, truth }) {
  const q = [];
  const add = (weight, text) => q.push({ weight, text });

  for (const g of grounds) {
    if (g.choseRefuted) {
      add(100,
        `Ты поставил на версию «${g.hypothesisLabel}» — а «${g.refutedBy[0]}» ` +
        'говорил против неё, и ты этот источник открывал. Что перевесило?');
    } else if (g.choseWithoutSupport && g.sourcesSeen > 0) {
      add(80,
        `За версию «${g.hypothesisLabel}» у тебя не было ни одного свидетельства — ` +
        'её просто не успели опровергнуть. Чем она была лучше остальных?');
    }
  }

  if (seeking.decidedWithoutAsking) {
    add(90, 'Ты принял решение, не открыв ни одного источника. ' +
            'Что ты знал такого, чего не было в задаче?');
  } else if (seeking.aliveAtDecision.length > 1) {
    add(70,
      `В момент первого вмешательства живы были ${seeking.aliveAtDecision.length} объяснения: ` +
      seeking.aliveAtDecision.map(h => `«${h.label}»`).join(', ') +
      '. Что помешало отделить их друг от друга до действия?');
  } else if (seeking.aliveAtDecision.length === 1) {
    add(20, 'Ты дошёл до одного объяснения до вмешательства. ' +
            'На каком источнике это произошло и почему именно на нём?');
  }

  if (seeking.nonDiagnosticOpenedBefore > seeking.diagnosticOpenedBefore) {
    add(65, 'Больше половины запросов до решения ничего не различали — ' +
            'они подтверждали. Как ты выбирал, что открыть следующим?');
  }

  for (const e of afterError) {
    if (e.noFollowUp) continue;
    if (e.soughtNewInformation === false) {
      add(60, 'После того как признак не сбылся, ты действовал дальше, ' +
              'не запросив ничего нового. Что ты в тот момент считал причиной?');
    }
    if (e.repeatedSameCategory) {
      add(58, 'После неудачи ты повторил вмешательство того же типа. ' +
              'Это была новая гипотеза или прежняя, но сильнее?');
    }
  }

  for (const w of waiting) {
    if (w.actedBeforeOwnDeadline) {
      add(55,
        `Ты назначил себе срок на ${w.dueWeek}-ю неделю, а следующее решение ` +
        `принял на ${w.firstEarlyActionWeek}-й — за ${w.weeksNotWaited} недель ` +
        'до собственной проверки. Что изменилось за это время, кроме того, ' +
        'что стало тревожно?');
    }
  }

  for (const t of timing) {
    if (t.dueBeforeEffect) {
      add(45,
        `Ты назначил срок на ${t.dueWeek}-ю неделю, а эффект выбранного ` +
        `действия по правилам мира не приходит раньше ${t.earliestPossibleWeek}-й. ` +
        'Что бы ни сдвинулось к твоему сроку — это сдвинулось само, ' +
        'без твоего участия. Из чего ты выбирал срок?');
    }
  }

  for (const c of contracts) {
    if (c.verdict === 'missed' && c.confidence >= 70) {
      add(50, `Ты записал уверенность ${c.confidence}% — и признак не сбылся. ` +
              'Что ты считал известным, а оно им не было?');
    }
  }

  if (breadth.categoryCount > 1) {
    add(40, 'Два твоих хода были из разных областей. Если бы стало лучше — ' +
            'как бы ты узнал, что именно сработало?');
  }

  for (const s of seeking.blindSpots.slice(0, 2)) {
    add(30, `Ты ни разу не открыл «${s.label}». Почему этот источник не пришёл в голову?`);
  }

  const seen = new Set();
  const ordered = q
    .sort((a, b) => b.weight - a.weight)
    .map(x => x.text)
    .filter(t => (seen.has(t) ? false : seen.add(t)));

  // Закрывающий вопрос зависит от того, назвал человек причину или нет.
  // Спрашивать «на каком шаге ты мог это увидеть» у того, кто её увидел, —
  // значит отчитывать за верный ответ.
  const first = contracts[0]?.hypothesisId;
  const last = contracts[contracts.length - 1]?.hypothesisId;
  const gotIt = last === truth.id;
  const cameToIt = gotIt && first !== truth.id;

  if (cameToIt) {
    ordered.push(
      `Настоящая причина — «${truth.label}». Сначала ты думал иначе и ` +
      'поменял мнение по ходу. Что именно тебя развернуло — и почему ' +
      'это не сработало с первого раза?');
  } else if (gotIt) {
    ordered.push(
      `Настоящая причина — «${truth.label}», и ты назвал её верно. ` +
      'На чём ты на неё вышел? И что в этой ситуации могло бы сбить ' +
      'с толку человека, который смотрел бы на те же данные?');
  } else {
    ordered.push(
      `Настоящая причина в этом варианте — «${truth.label}». ` +
      'На каком шаге у тебя была возможность это увидеть?');
  }
  return ordered;
}
