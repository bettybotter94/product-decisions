// Журнал. Всё, что потом станет фактурой для разбора.

/**
 * Записать событие. По умолчанию — текущей неделей, но событие может
 * указать свою: решение принимается ДО того, как команда отработает
 * положенные недели, и в журнале оно должно стоять там, где принято.
 */
export function log(session, event) {
  const { week, ...rest } = event;
  session.journal.push({
    seq: session.journal.length,
    week: week ?? session.world.week,
    ...rest
  });
}

export const EV = {
  OPEN_SOURCE: 'open_source',
  ACTION: 'action',
  CONTRACT: 'contract',
  ADVANCE: 'advance',
  CHECKPOINT: 'checkpoint',
  NOTE: 'note',
  FINISH: 'finish'
};
