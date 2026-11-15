exports.median = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : undefined;
};
const scenarioKey = scenario =>
  JSON.stringify(
    Object.entries(scenario).sort(([a], [b]) => a.localeCompare(b)),
  );
exports.groupResults = data =>
  Map.groupBy(data?.results || [], run =>
    JSON.stringify([
      scenarioKey(run.scenario),
      Boolean(run.memory),
      Boolean(run.interactions),
    ]),
  );
exports.comparableEnvironment = (before, after) =>
  ['browser', 'cpu', 'mode'].every(
    field =>
      before?.environment?.[field] == null ||
      after.environment?.[field] == null ||
      before.environment[field] === after.environment[field],
  );
exports.errorSummary = runs => {
  const captured = runs.filter(run => Array.isArray(run.errors));
  return captured.length === runs.length
    ? `Uncaught JavaScript exceptions: ${captured.reduce((count, run) => count + run.errors.length, 0)}.`
    : `Error capture missing for ${runs.length - captured.length} of ${runs.length} runs; inspect recorded errors separately.`;
};
