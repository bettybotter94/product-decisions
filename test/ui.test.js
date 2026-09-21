// Проверки интерфейса без браузера. Сторожат класс ошибок, при котором
// кнопка блокируется по полю, а заполнить это поле негде. Так уже случилось:
// условие блокировки добавилось, а сам выбор версии — нет, и человек
// оказывался заперт на контрольной точке без единого способа продолжить.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ui = readFileSync(join(root, 'app/ui.js'), 'utf8');

/** Поля черновиков, от которых зависит доступность кнопок. */
function gatingFields(source) {
  const found = new Set();
  for (const m of source.matchAll(/disabled:\s*([^\n]+)/g)) {
    for (const f of m[1].matchAll(/\b(noteDraft|draft)\.(\w+)/g)) {
      found.add(f[1] + '.' + f[2]);
    }
  }
  return [...found];
}

test('каждое поле, блокирующее кнопку, где-то заполняется', () => {
  const fields = gatingFields(ui);
  assert.ok(fields.length > 0, 'условий блокировки не найдено — проверка бесполезна');
  for (const field of fields) {
    const name = field.split('.')[1];
    const assigned = ui.includes(field + ' =') || ui.includes(field + '=');
    const viaSetter = field.startsWith('draft.') && ui.includes("set('" + name + "'");
    assert.ok(assigned || viaSetter,
      field + ' блокирует кнопку, но нигде не заполняется — человек будет заперт');
  }
});

test('на контрольной точке есть чем назвать версию и уверенность', () => {
  const from = ui.indexOf('checkpoint-card');
  const to = ui.indexOf('/* ---------- эпизоды');
  const card = ui.slice(from, to);
  assert.ok(from > 0 && to > from, 'карточка контрольной точки не найдена');
  assert.ok(card.includes('noteDraft.hypothesisId = e.target.value'),
    'кнопка ждёт версию, а выбрать её негде');
  assert.ok(card.includes('noteDraft.confidence ='),
    'уверенность негде ввести');
});

test('в интерфейсе не осталось полей со стрелками', () => {
  assert.ok(!ui.includes("type: 'number'"),
    'числовое поле со стрелками — их просили убрать');
});

test('в интерфейсе нет обращения в женском роде', () => {
  for (const w of ['вошла', 'прочитала', 'уверена', 'назначила', 'ты права',
                   'записала', 'ошиблась', 'надо самой', 'проходила']) {
    assert.ok(!ui.includes(w), 'обращение в женском роде: ' + w);
  }
});
