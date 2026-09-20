import churnA from './churn-a.js';
import churnB from './churn-b.js';
import churnC from './churn-c.js';
import clientA from './client-a.js';
import clientB from './client-b.js';
import clientC from './client-c.js';
import launchA from './launch-a.js';
import launchB from './launch-b.js';
import launchC from './launch-c.js';

export const EPISODES = [churnA, churnB, churnC, clientA, clientB, clientC, launchA, launchB, launchC];

export const byId = id => EPISODES.find(e => e.id === id);

/** Кейсы в порядке прохождения; внутри кейса — варианты с одной структурой,
 *  но разными фактами и разной правдой. */
export const CASES = [
  {
    id: 'diagnosis',
    title: 'Кейс 1. Метрика упала',
    about: 'Проверять диагноз до вмешательства'
  },
  {
    id: 'bigclient',
    title: 'Кейс 2. Крупный клиент требует фичу',
    about: 'Ограничивать вмешательство одной проверяемой ставкой'
  },
  {
    id: 'nolift',
    title: 'Кейс 3. Запуск не дал эффекта',
    about: 'Обновлять решение при новых сведениях'
  }
];

export const variantsOf = caseId => EPISODES.filter(e => e.caseId === caseId);

/** Показатель, вокруг которого крутится эпизод: его чаще всего трогают правила. */
export function keyMetric(sc) {
  const count = {};
  for (const r of sc.rules) for (const e of r.effects) count[e.metric] = (count[e.metric] || 0) + 1;
  const best = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : Object.keys(sc.metrics)[0];
}
