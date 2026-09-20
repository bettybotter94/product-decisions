// Кейс 1, вариант B. Та же структура, другие факты, другая правда.
// Здесь настоящая причина — релиз. Руководитель продаж говорит ровно то же,
// что и в варианте A, и снова ошибается.

export default {
  id: 'churn-b',
  caseId: 'diagnosis',
  caseTitle: 'Кейс 1. Метрика упала',
  variant: 'B',
  targetBehaviour: 'Проверять диагноз до вмешательства',
  title: 'Клиенты снова стали уходить чаще',
  horizonWeeks: 12,
  checkpoints: [4, 8],
  seed: 2,
  context:
    'Компания продаёт платформу для совместной работы: проекты, задачи, общие документы. Клиенты делятся на три тарифа. «Малые команды» — самый дешёвый и самый многочисленный из них: команды по 5–20 человек. По отдельности каждая платит немного, вместе они дают 4,2 млн ₽ в месяц. Ты отвечаешь за этот сегмент.',

  // Слова из источников, которые могут быть незнакомы.
  terms: [
    { term: 'Когорта регистрации',
      plain: 'Группа клиентов, пришедших в один и тот же период. Сравнивать когорты — способ понять, касается проблема новичков или всех подряд.' },
    { term: 'Поэтапная раскатка',
      plain: 'Релиз включают не всем сразу, а части клиентов. Тогда можно сравнить получивших и не получивших — и увидеть, при чём тут релиз.' },
    { term: 'Онбординг',
      plain: 'Первые шаги клиента в продукте: регистрация, приглашение команды, первая настройка. Место, где чаще всего отваливаются новички.' },
  ],

  // Что требуется от участника. Без чисел: задача не должна
  // подменять собой контракт решения.
  goal:
    'Понять, почему клиенты стали уходить чаще, и вмешаться так, ' +
    'чтобы через три месяца было что показать CEO.',

  brief:
    'Прошёл квартал. Отток в сегменте «малые команды» снова растёт: с 4,2% ' +
    'до 8,2% за три недели. В эти же недели: выкатился релиз 4.0 с новым ' +
    'мастером настройки проекта, конкурент опять снизил цену, у части ' +
    'клиентов закончился финансовый год, поддержка работает прежним ' +
    'составом. Через три месяца отчёт перед CEO.',

  metrics: {
    churn_segment: { label: 'Отток в сегменте, % в мес.', better: 'down', decimals: 1, min: 0,
      hint:
        'Доля платящих клиентов, переставших платить за месяц. 4% — уходят четверо из ста, 7% — семеро. За год это разница между потерей 39% и 58% сегмента.' },
    response_hours: { label: 'Время первого ответа поддержки, ч', better: 'down', decimals: 1, min: 0.2,
      hint:
        'Сколько в среднем клиент ждёт первого ответа поддержки на своё обращение.' },
    nps_segment: { label: 'NPS сегмента', better: 'up', decimals: 0,
      hint:
        'Опросная оценка: готов ли клиент рекомендовать продукт. Шкала от −100 до 100, около нуля — вяло, выше 30 — хорошо.' },
    revenue_segment: { label: 'Выручка сегмента, млн ₽/мес', better: 'up', decimals: 2, min: 0,
      hint:
        'Сколько этот тариф приносит в месяц.' }
  },

  initialMetrics: {
    churn_segment: 8.2,
    response_hours: 2.2,
    nps_segment: 15,
    revenue_segment: 4.10
  },

  hypotheses: [
    { id: 'h1', label: 'Релиз 4.0 сломал первый запуск у новых команд' },
    { id: 'h2', label: 'Конкурент снизил цену и уводит клиентов' },
    { id: 'h3', label: 'Сезонность: у клиентов закончился финансовый год' },
    { id: 'h4', label: 'Поддержка не справляется' }
  ],

  truth: { hypothesisId: 'h1' },

  sources: [
    {
      id: 's_cohorts', kind: 'data', costWeeks: 1, diagnostic: true,
      label: 'Выгрузка оттока по когортам регистрации',
      evidence: { h1: 'for', h3: 'against' },
      content:
        'Команды, зарегистрированные после 1-го числа: отток 3,8% → 11,4%. ' +
        'Зарегистрированные больше года назад: 3,9% → 4,3%. Почти весь ' +
        'прирост — на новых.'
    },
    {
      id: 's_release_flag', kind: 'data', costWeeks: 1, diagnostic: true,
      label: 'Кто получил релиз 4.0 (раскатка поэтапная)',
      evidence: { h1: 'for' },
      content:
        'Релиз 4.0 получили 62% сегмента. Отток у получивших — 10,9%, ' +
        'у не получивших — 4,1%. Разница почти втрое.'
    },
    {
      id: 's_support', kind: 'data', costWeeks: 1, diagnostic: true,
      label: 'Метрики поддержки помесячно',
      evidence: { h4: 'against' },
      content:
        'Время первого ответа: 2,3 ч → 2,1 ч → 2,2 ч. Доля тикетов без ' +
        'ответа за сутки: 3%, 2%, 3%. Объём тикетов вырос на 40%, ' +
        'но очередь не растёт.'
    },
    {
      id: 's_exit', kind: 'doc', costWeeks: 2, diagnostic: true,
      label: 'Опросы ушедших клиентов, 12 ответов',
      evidence: { h1: 'for', h2: 'against' },
      content:
        'Из 12 ответов: 8 — «не смогли пригласить команду», «не поняли, ' +
        'что делать на первом экране»; 1 — цена; 3 — закрыли проект. ' +
        'Медиана жизни ушедших — 9 дней. До сравнения с конкурентом ' +
        'большинство просто не дожило.'
    },
    {
      id: 's_billing', kind: 'data', costWeeks: 1, diagnostic: true,
      label: 'Даты окончания договоров по сегменту',
      evidence: { h3: 'against' },
      content: 'Окончания договоров распределены ровно: 7–9% в месяц. Всплеска нет.'
    },
    {
      id: 's_support_lead', kind: 'person', costWeeks: 1, diagnostic: true,
      label: 'Разговор с владельцем поддержки',
      evidence: { h1: 'for', h4: 'against' },
      content:
        '«У нас всё ровно, отвечаем быстро. Но вал тикетов одинаковый: ' +
        '"как добавить людей в проект". Мы им отвечаем инструкцией, они ' +
        'благодарят и через неделю отваливаются.»'
    },
    {
      id: 's_sales', kind: 'person', costWeeks: 1, diagnostic: false, evidence: {},
      label: 'Разговор с руководителем продаж',
      content:
        '«Нас душит конкурент. Все всё время спрашивают про цену. Дай ' +
        'скидку 20% на сегмент. Я это говорю третий квартал подряд.»'
    },
    {
      id: 's_competitor', kind: 'doc', costWeeks: 0, diagnostic: false, evidence: {},
      label: 'Пост конкурента о новой цене',
      content:
        '«Ещё дешевле: тариф Team теперь на 15% ниже.» Дата — 9 дней назад.'
    },
    {
      id: 's_release_notes', kind: 'doc', costWeeks: 0, diagnostic: false, evidence: {},
      label: 'Заметки к релизу 4.0',
      content:
        'Новый мастер настройки проекта, объединены экраны приглашения ' +
        'и ролей, 9 исправлений. Известных проблем на момент выпуска нет.'
    },
    {
      id: 's_nps', kind: 'data', costWeeks: 1, diagnostic: false, evidence: {},
      label: 'NPS сегмента помесячно',
      content: 'NPS: 28 → 21 → 15. Падает. Комментарии в выгрузку не попали.'
    }
  ],

  actions: [
    { id: 'a_fix_onboarding', category: 'product', costWeeks: 5,
      label: 'Отправить команду переделывать первый запуск после релиза 4.0' },
    { id: 'a_rollback', category: 'product', costWeeks: 3,
      label: 'Откатить релиз 4.0' },
    { id: 'a_support_staff', category: 'ops', costWeeks: 2,
      label: 'Усилить поддержку: выделить двоих из команды на две недели' },
    { id: 'a_discount', category: 'pricing', costWeeks: 1,
      label: 'Дать сегменту скидку 20% на три месяца' },
    { id: 'a_outreach', category: 'ops', costWeeks: 1,
      label: 'Личный обзвон клиентов из группы риска' }
  ],

  rules: [
    {
      action: 'a_fix_onboarding', ifTruth: 'h1',
      effects: [
        { metric: 'churn_segment', delta: -1.8, afterWeeks: 6 },
        { metric: 'churn_segment', delta: -1.9, afterWeeks: 9 },
        { metric: 'nps_segment', delta: 8, afterWeeks: 8 }
      ],
      note: 'Первый запуск починен: новые команды перестали отваливаться. Эффект приходит волнами.'
    },
    {
      action: 'a_fix_onboarding', unlessTruth: 'h1', effects: [],
      note: 'Онбординг переделан, на отток это не повлияло: он не был причиной.'
    },
    {
      action: 'a_rollback', ifTruth: 'h1',
      effects: [
        { metric: 'churn_segment', delta: -2.4, afterWeeks: 3 },
        { metric: 'churn_segment', delta: 0.5, afterWeeks: 8 },
        { metric: 'nps_segment', delta: -4, afterWeeks: 4 }
      ],
      note: 'Откат сработал быстрее и дешевле, чем починка, но разозлил тех, кто уже перестроился, и часть проблемы вернулась.'
    },
    {
      action: 'a_rollback', unlessTruth: 'h1',
      effects: [{ metric: 'nps_segment', delta: -3, afterWeeks: 3 }],
      note: 'Откат раздражил привыкших к новому и не тронул причину.'
    },
    {
      action: 'a_support_staff',
      effects: [{ metric: 'response_hours', delta: -0.6, afterWeeks: 2 }],
      note: 'Поддержка и так успевала: усиление почти ничего не изменило.'
    },
    {
      action: 'a_discount',
      effects: [
        { metric: 'churn_segment', delta: -0.9, afterWeeks: 3 },
        { metric: 'churn_segment', delta: 0.6, afterWeeks: 7 },
        { metric: 'revenue_segment', delta: -0.52, afterWeeks: 1 }
      ],
      note: 'Скидка придержала уходящих на месяц и сразу срезала выручку. Причину не тронула.'
    },
    {
      action: 'a_outreach',
      effects: [
        { metric: 'churn_segment', delta: -0.7, afterWeeks: 2 },
        { metric: 'churn_segment', delta: 0.4, afterWeeks: 7 }
      ],
      note: 'Ручной обзвон держит часть клиентов, пока его делают.'
    }
  ],

  drift: [
    { metric: 'churn_segment', deltaPerWeek: 0.06 },
    { metric: 'nps_segment', deltaPerWeek: -0.25 }
  ]
};
