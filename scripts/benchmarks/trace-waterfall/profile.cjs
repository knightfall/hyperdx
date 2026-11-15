const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const repo = process.env.WATERFALL_REPO || path.resolve(__dirname, '../../..');
const requireRepo = createRequire(path.join(repo, 'package.json'));
const { TraceMap, originalPositionFor } = requireRepo(
  '@jridgewell/trace-mapping',
);
const ts = requireRepo('typescript');
const root =
  process.env.WATERFALL_ARTIFACTS ||
  path.join(repo, 'artifacts/trace-waterfall');
const mapJson = JSON.parse(fs.readFileSync(path.join(root, 'after.js.map')));
const map = new TraceMap(mapJson);
const optimized = process.argv.includes('--optimized');
const profile = JSON.parse(
  fs.readFileSync(
    path.join(
      root,
      optimized
        ? 'initial-load-optimized.cpuprofile'
        : 'initial-load.cpuprofile',
    ),
  ),
);
const sources = new Map();
const nodes = new Map(profile.nodes.map(n => [n.id, n]));
for (const node of nodes.values())
  for (const id of node.children || []) nodes.get(id).parent = node;
for (const node of nodes.values()) {
  if (!node.callFrame.url.includes('/after.js')) {
    node.label = node.callFrame.functionName || '(browser)';
    continue;
  }
  const original = originalPositionFor(map, {
    line: node.callFrame.lineNumber + 1,
    column: node.callFrame.columnNumber,
  });
  if (!original.source) {
    node.label = node.callFrame.functionName;
    continue;
  }
  const index = mapJson.sources.indexOf(original.source);
  let source = sources.get(original.source);
  if (!source && index >= 0) {
    const text = mapJson.sourcesContent[index];
    source = {
      text,
      tree: ts.createSourceFile(
        original.source,
        text,
        ts.ScriptTarget.Latest,
        true,
        original.source.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      ),
    };
    sources.set(original.source, source);
  }
  let name = original.name || node.callFrame.functionName;
  if (source) {
    const position = source.tree.getPositionOfLineAndCharacter(
      original.line - 1,
      original.column,
    );
    function visit(n) {
      if (n.getStart(source.tree) > position || n.end < position) return;
      if (ts.isFunctionLike(n))
        name =
          n.name?.getText(source.tree) ||
          (ts.isVariableDeclaration(n.parent)
            ? n.parent.name.getText(source.tree)
            : name);
      ts.forEachChild(n, visit);
    }
    visit(source.tree);
  }
  node.source = original.source;
  node.label = `${name || '(anonymous)'} — ${original.source.replace(/^.*\/packages\//, 'packages/').replace(/^.*\/node_modules\//, 'node_modules/')}:${original.line}`;
}
const inclusive = new Map(),
  self = new Map(),
  byFile = new Map();
for (let i = 0; i < profile.samples.length; i++) {
  let node = nodes.get(profile.samples[i]);
  const ms = profile.timeDeltas[i] / 1000;
  self.set(node.label, (self.get(node.label) || 0) + ms);
  const seen = new Set(),
    files = new Set();
  for (; node; node = node.parent) {
    if (!seen.has(node.label))
      inclusive.set(node.label, (inclusive.get(node.label) || 0) + ms);
    seen.add(node.label);
    if (node.source && !files.has(node.source))
      byFile.set(node.source, (byFile.get(node.source) || 0) + ms);
    files.add(node.source);
  }
}
const top = values =>
  [...values]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([name, ms]) => ({ name, ms: Math.round(ms) }));
const result = {
  durationMs: (profile.endTime - profile.startTime) / 1000,
  topSelf: top(self),
  topInclusive: top(inclusive),
  topFiles: top(byFile),
};
fs.writeFileSync(
  path.join(
    root,
    optimized ? 'profile-summary-optimized.json' : 'profile-summary.json',
  ),
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
