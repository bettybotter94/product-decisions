// Кейс 2, вариант B. То же письмо, другой мир: здесь клиент действительно уходит.
// И правильным оказывается ровно то действие, которое в варианте A было провалом.

export default {
  id: 'client-b',
  caseId: 'bigclient',
  caseTitle: 'Кейс 2. Крупный клиент требует фичу',
  variant: 'B',
  targetBehaviour: 'Ограничивать вмешательство одной проверяемой ставкой',
  title: 'Крупный клиент требует доработку (другой квартал)',
  horizonWeeks: 12,
  checkpoints: [4, 8],
  seed: 12,
  context:
    'Компания продаёт платформу для совместной работы. Этот клиент — крупнейший: он один даёт 18% всей выручки. Договор с ним ведёт отдел продаж, продукт делаешь ты, а команда у вас одна на всё.',

  // Слова из источников, которые могут быть незнакомы.
  terms: [
    { term: 'Бэклог',
      plain: 'Список того, что команда когда-нибудь сделает. Ответ «принято в бэклог» клиенты обычно читают как «нет».' },
    { term: 'Узкий срез',
      plain: 'Сделать не всю доработку, а ровно тот кусок, который закрывает конкретный сценарий клиента. Быстро и некрасиво.' },
    { term: 'Квартальная цель',
      plain: 'То, что команда пообещала сделать за квартал. Снять с неё людей — значит её не закрыть.' },
  ],

  // Что требуется от участника. Без чисел: задача не должна
  // подменять собой контракт решения.
  goal:
    'Решить, что ответить клиенту, — и не потерять при этом квартальную цель.',

  brief:
    'Другой квартал, другой клиент — 18% выручки. Письмо: нужна доработка, ' +
    'и «иначе будем смотреть другие варианты». Команда занята квартальной ' +
    'целью, до конца квартала три месяца. Руководитель продаж требует ' +
    'реакции сегодня и говорит ровно то же, что и в прошлый раз.',

  metrics: {
    revenue_anchor: { label: 'Выручка от этого клиента, млн ₽/мес', better: 'up', decimals: 2, min: 0,
      hint:
        'Сколько этот клиент платит в месяц. Это 18% всей выручки компании.' },
    quarter_progress: { label: 'Готовность квартальной цели, %', better: 'up', decimals: 0, min: 0, max: 100,
      hint:
        'Насколько сделано то, что команда обещала на квартал. 100% — цель закрыта.' },
    relationship: { label: 'Отношения с клиентом, индекс', better: 'up', decimals: 0, min: 0, max: 100,
      hint:
        'Условная шкала 0–100: насколько клиент нами доволен. В жизни такого числа нет — здесь оно нужно, чтобы последствия разговоров были чем-то видны.' }
  },

  initialMetrics: { revenue_anchor: 1.80, quarter_progress: 34, relationship: 40 },

  hypotheses: [
    { id: 'h1', label: 'Клиент действительно уйдёт, если не сделать доработку' },
    { id: 'h2', label: 'Угроза — приём в переписке; решают у них другие люди' },
    { id: 'h3', label: 'Та же доработка нужна многим, клиент озвучил общий запрос' },
    { id: 'h4', label: 'Дело не в доработке, а в непредсказуемых сроках наших релизов' }
  ],

  truth: { hypothesisId: 'h1' },

  sources: [
    {
      id: 's_email', kind: 'doc', costWeeks: 0, diagnostic: false, evidence: {},
      label: 'Само письмо',
      content:
        '«Коллеги, вопрос выгрузки мы поднимаем четвёртый раз. Договор ' +
        'заканчивается, и комитет будет решать по продлению в этом месяце. ' +
        'Без выгрузки решение будет не в вашу пользу. Сергей.»'
    },
    {
      id: 's_contract', kind: 'doc', costWeeks: 1, diagnostic: true,
      label: 'Договор с клиентом',
      evidence: { h1: 'for' },
      content:
        'Срок заканчивается через 6 недель. Автопродления нет — нужно ' +
        'подписывать новый. Штрафов за непродление нет. Уйти они могут ' +
        'ровно тогда, когда сказали.'
    },
    {
      id: 's_usage', kind: 'data', costWeeks: 1, diagnostic: true,
      label: 'Использование продукта клиентом за полгода',
      evidence: { h1: 'for' },
      content:
        'Активных пользователей: 97 → 67 (−31%). Два отдела перестали ' +
        'заходить совсем. Объём выгружаемых данных вырос втрое — ' +
        'похоже, они переносят данные к себе.'
    },
    {
      id: 's_dm', kind: 'person', costWeeks: 1, diagnostic: true,
      label: 'Разговор с их директором по операциям (подписывает договор)',
      evidence: { h1: 'for', h2: 'against' },
      content:
        '«Да, мы смотрим варианты, и это не поза. Без выгрузки нам ' +
        'приходится держать второго подрядчика — это дороже вас. ' +
        'Комитет соберётся через три недели.»'
    },
    {
      id: 's_requester', kind: 'person', costWeeks: 1, diagnostic: true,
      label: 'Разговор с Сергеем, который прислал письмо',
      evidence: { h2: 'against' },
      content:
        '«Это не моя инициатива. Мне поручили передать решение комитета. ' +
        'Я бы, честно говоря, остался у вас — но меня не спрашивают.»'
    },
    {
      id: 's_support_log', kind: 'data', costWeeks: 1, diagnostic: true,
      label: 'Все запросы на эту доработку по клиентской базе',
      evidence: { h3: 'against' },
      content:
        'За год похожее просили 3 клиента из 180 — вместе 4% выручки. ' +
        'Формулировки разные. Общего требования не складывается.'
    },
    {
      id: 's_history', kind: 'data', costWeeks: 1, diagnostic: true,
      label: 'История обращений клиента за год',
      evidence: { h4: 'against' },
      content:
        '44 обращения. 28 — про выгрузку данных, 9 — про доступы. ' +
        'Про сроки и предсказуемость релизов — ни одного.'
    },
    {
      id: 's_team', kind: 'person', costWeeks: 1, diagnostic: false, evidence: {},
      purpose: 'execution',
      label: 'Оценка команды: сколько займёт доработка',
      content:
        '«Полностью, как просят, — шесть недель, квартальная цель встанет. ' +
        'Узкий срез под их сценарий — две недели, но он закрывает, ' +
        'по-моему, меньше половины того, что им нужно.»'
    },
    {
      id: 's_peers', kind: 'data', costWeeks: 1, diagnostic: false, evidence: {},
      purpose: 'execution',
      label: 'Что было с тремя клиентами, которым мы уже делали доработку под заказ',
      content:
        'Двое остались, один ушёл через полгода. Каждая такая доработка ' +
        'добавила от трёх до пяти недель поддержки в год.'
    },
    {
      id: 's_sales_lead', kind: 'person', costWeeks: 1, diagnostic: false, evidence: {},
      label: 'Разговор с руководителем продаж',
      content:
        '«Если мы их потеряем, квартал не закроем. Делай что угодно, ' +
        'только чтобы они остались. Я бы делал всё, что они просят.»'
    }
  ],

  actions: [
    { id: 'a_meet_dm', category: 'relationship', costWeeks: 1,
      label: 'Поехать к их директору по операциям и выяснить, что происходит' },
    { id: 'a_build_slice', category: 'product', costWeeks: 2,
      label: 'Сделать узкий срез ровно под их сценарий' },
    { id: 'a_build_full', category: 'product', costWeeks: 5,
      label: 'Поставить команду на полную доработку, как просят' },
    { id: 'a_discount_extend', category: 'pricing', costWeeks: 1,
      label: 'Предложить скидку и продление договора' },
    { id: 'a_formal_reply', category: 'relationship', costWeeks: 0,
      label: 'Ответить письмом, что запрос принят в бэклог' }
  ],

  rules: [
    {
      action: 'a_build_full', ifTruth: 'h1',
      effects: [
        { metric: 'revenue_anchor', delta: 0.75, afterWeeks: 5 },
        { metric: 'revenue_anchor', delta: 0.70, afterWeeks: 8 },
        { metric: 'revenue_anchor', delta: 0.35, afterWeeks: 10 },
        { metric: 'quarter_progress', delta: -38, afterWeeks: 6 },
        { metric: 'relationship', delta: 16, afterWeeks: 7 }
      ],
      note: 'Шесть недель команда делала выгрузку. Комитет собрался, посмотрел ' +
        'работающую версию и продлил договор. Квартальная цель не закрыта — ' +
        'это была цена, и в этот раз она того стоила.'
    },
    {
      action: 'a_build_full', unlessTruth: 'h1',
      effects: [
        { metric: 'quarter_progress', delta: -38, afterWeeks: 6 },
        { metric: 'relationship', delta: 14, afterWeeks: 7 }
      ],
      note: 'Шесть недель ушли на выгрузку. Клиент доволен, но он и не уходил. ' +
        'Квартальная цель не закрыта.'
    },
    {
      action: 'a_build_slice', ifTruth: 'h1',
      effects: [
        { metric: 'revenue_anchor', delta: 0.45, afterWeeks: 4 },
        { metric: 'quarter_progress', delta: -9, afterWeeks: 3 },
        { metric: 'relationship', delta: 9, afterWeeks: 4 }
      ],
      note: 'Срез закрыл половину того, что им нужно. На комитете это заметили ' +
        'и оценили — но решили сократить объём, а не уйти совсем.'
    },
    {
      action: 'a_build_slice', unlessTruth: 'h1',
      effects: [
        { metric: 'relationship', delta: 11, afterWeeks: 4 },
        { metric: 'quarter_progress', delta: -9, afterWeeks: 3 }
      ],
      note: 'Срез сделали быстро, сценарий закрыт, квартальная цель цела.'
    },
    {
      action: 'a_meet_dm', ifTruth: 'h1',
      effects: [
        { metric: 'revenue_anchor', delta: 0.18, afterWeeks: 2 },
        { metric: 'relationship', delta: 8, afterWeeks: 1 }
      ],
      note: 'Директор по операциям честно объяснил, что происходит, и даже ' +
        'отложил комитет на две недели. Но выгрузку словами не заменишь — ' +
        'к следующему разу нужна была она, а не понимание.'
    },
    {
      action: 'a_meet_dm', unlessTruth: 'h1',
      effects: [{ metric: 'relationship', delta: 12, afterWeeks: 1 }],
      note: 'Встреча сняла напряжение и прояснила, кто у них за что отвечает.'
    },
    {
      action: 'a_discount_extend',
      effects: [
        { metric: 'revenue_anchor', delta: -0.27, afterWeeks: 1 },
        { metric: 'relationship', delta: 5, afterWeeks: 2 }
      ],
      note: 'Предложили скидку. Её приняли — и всё равно продолжили считать, ' +
        'во сколько обходится второй подрядчик. Просили не денег.'
    },
    {
      action: 'a_formal_reply',
      effects: [{ metric: 'relationship', delta: -9, afterWeeks: 4 }],
      note: 'Ответ «принято в бэклог» прочитали именно так, как он написан. ' +
        'Больше писем не было.'
    }
  ],

  drift: [
    { metric: 'quarter_progress', deltaPerWeek: 4.75 },
    // клиент тихо переносит данные к себе: если ничего не сделать,
    // к концу квартала от выручки не остаётся почти ничего
    { metric: 'revenue_anchor', deltaPerWeek: -0.15 },
    { metric: 'relationship', deltaPerWeek: -0.75 }
  ]
};
