// Сторож архитектурного инварианта.
// Часть, разрешающая исход, не должна видеть того, что человек записал в контракт.
// Этот тест должен падать, если кто-нибудь (включая меня) протянет туда контракты.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const resolverSrc = readFileSync(join(root, 'engine/resolver.js'), 'utf8');
const worldSrc = readFileSync(join(root, 'engine/world.js'), 'utf8');

test('резольвер не импортирует модуль контрактов', () => {
  assert.equal(/from\s+['"]\.\/contracts\.js['"]/.test(resolverSrc), false,
    'resolver.js импортирует contracts.js — развязка сломана');
});

test('модель мира не импортирует модуль контрактов', () => {
  assert.equal(/from\s+['"]\.\/contracts\.js['"]/.test(worldSrc), false);
});

test('в резольвере не встречается слово contract', () => {
  const code = resolverSrc.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert.equal(/contract/i.test(code), false,
    'в исполняемом коде резольвера упоминается contract');
});

test('applyAction принимает ровно три аргумента и ни один из них не контракт', async () => {
  const { applyAction } = await import('../engine/resolver.js');
  assert.equal(applyAction.length, 3);
});

test('исход не зависит от того, что записано в контракте', async () => {
  const scenario = (await import('../scenarios/churn-a.js')).default;
  const { createSession, commitAction, step } = await import('../engine/session.js');

  const base = {
    hypothesisId: 'h1',
    expectation: 'Отток пойдёт вниз, потому что причина в онбординге',
    signs: [{ metricId: 'churn_segment', direction: 'down', target: 5.0 }],
    confidence: 90,
    dueWeek: 14
  };
  const other = {
    hypothesisId: 'h4',
    expectation: 'Отток не изменится, я вообще не верю в это действие',
    signs: [{ metricId: 'churn_segment', direction: 'up', target: 9.0 }],
    confidence: 5,
    dueWeek: 20
  };

  const run = contract => {
    const s = createSession(scenario, 1);
    commitAction(s, scenario, 'a_discount', contract);
    step(s, scenario, 21);
    return s.world.metrics;
  };

  assert.deepEqual(run(base), run(other),
    'мир подстроился под контракт — это запрещено');
});
