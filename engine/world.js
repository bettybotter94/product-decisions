// Состояние мира. Ничего не знает про контракты решений.

export function createWorld(scenario) {
  return {
    week: 0,
    metrics: { ...scenario.initialMetrics },
    pending: [],           // отложенные эффекты: {atWeek, metric, delta, sourceAction}
    history: [{ week: 0, metrics: { ...scenario.initialMetrics } }],
    worldLog: []           // что произошло и по какому правилу
  };
}

/** Ограничить показатель рамками, если они заданы в сценарии
 *  (готовность цели не бывает больше 100%, отток — меньше нуля). */
export function clamp(scenario, metricId, value) {
  const m = scenario.metrics[metricId] || {};
  let v = value;
  if (typeof m.min === 'number') v = Math.max(m.min, v);
  if (typeof m.max === 'number') v = Math.min(m.max, v);
  return v;
}

export function snapshot(world) {
  return { week: world.week, metrics: { ...world.metrics } };
}
