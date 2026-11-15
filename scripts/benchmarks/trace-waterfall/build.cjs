const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const repo = process.env.WATERFALL_REPO || path.resolve(__dirname, '../../..');
const fromRepo = createRequire(path.join(repo, 'package.json'));
const esbuild = fromRepo('esbuild');
const sass = fromRepo('sass');
const ts = fromRepo('typescript');
const app = path.join(repo, 'packages/app/src');
const root =
  process.env.WATERFALL_ARTIFACTS ||
  path.join(repo, 'artifacts/trace-waterfall');
fs.mkdirSync(root, { recursive: true });
const stub = contents => ({ contents, loader: 'tsx', resolveDir: app });

function extractFunctions(filename, names) {
  const source = fs.readFileSync(filename, 'utf8');
  const tree = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  return tree.statements
    .filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text))
    .map(n => n.getText(tree))
    .join('\n');
}

const sourceHelpers = extractFunctions(path.join(app, 'source.ts'), [
  'getFirstTimestampValueExpression',
  'getSpanEventBody',
  'getDisplayedTimestampValueExpression',
  'getEventBody',
  'getDurationSecondsExpression',
]);
const stubs = {
  api: `export default {useMe:()=>({data:{team:{}},isLoading:false})};`,
  source: `import {SourceKind} from '@hyperdx/common-utils/dist/types';
    import {splitAndTrimWithBracket} from '@hyperdx/common-utils/dist/core/utils';
    ${sourceHelpers}
    export const SESSION_TABLE_EXPRESSIONS={resourceAttributesExpression:'ResourceAttributes',eventAttributesExpression:'LogAttributes',timestampValueExpression:'TimestampTime',implicitColumnExpression:'Body'};
    export const useSource=()=>({data:undefined,isLoading:false});`,
  'hooks/useMetadata': `const metadata={getSetting:async()=>undefined};
    export const useMetadataWithSettings=()=>metadata;
    export const useColumns=()=>({data:[],isLoading:false});`,
  'hooks/useMVOptimizationExplanation': `export const useMVOptimizationExplanation=()=>({data:undefined,isLoading:false});`,
  queryAttribution: `export const useQueryAttribution=()=>undefined;`,
  'utils/promqlChartQuery': `export const queryPromqlChartConfig=()=>{throw new Error('Not a PromQL benchmark')};`,
  'hooks/useWaterfallSearchState': `const state={traceWhere:'',logWhere:'',traceWhereLanguage:'',logWhereLanguage:'',
    clear:()=>{},isFilterActive:false,isFilterExpanded:false,setIsFilterExpanded:()=>{},onSubmit:()=>{}};
    export default ()=>state;`,
  'hooks/useBrowserTraceEvents': `import {useMemo} from 'react';
    import {getBrowserTraceContext} from '@/utils/browserTraceContext';
    const empty=new Map();
    export function useBrowserTraceEvents({traceRows,logRows}) {
      const context=useMemo(()=>getBrowserTraceContext(traceRows),[traceRows]);
      if(context) throw new Error('Fixture unexpectedly contains browser trace context');
      return {logRows,resourceTimingBySpanId:empty,triggerRow:undefined};
    }`,
  useUserPreferences: `const value={userPreferences:{timeFormat:'24h'}};export const useUserPreferences=()=>value;`,
  useDisplayTimeZone: `export const useDisplayTimeZone=()=>'UTC';`,
  'components/ContactSupportText': `export const ContactSupportText=()=>null;`,
  'components/Error/ErrorCollapse': `export const ErrorCollapse=({details})=><pre>{details}</pre>;`,
  'components/SearchInput/SearchWhereInput': `export default ()=>null;export const getStoredLanguage=()=>'lucene';`,
  'components/DBRowDataPanel': `export const getJSONColumnNames=(meta)=>(meta??[]).filter(c=>c.type==='JSON').map(c=>c.name);`,
  'components/DBRowSidePanel': `import {createContext} from 'react';export const RowSidePanelContext=createContext({});`,
  'components/EventTag': `export default ({displayedKey,value})=><span>{displayedKey}: {value}</span>;`,
  clickhouse: fs.readFileSync(path.join(__dirname, 'transport.js'), 'utf8'),
};

const browserTrace = process.argv.includes('--browser-trace');
if (browserTrace) delete stubs['hooks/useBrowserTraceEvents'];
const timingQuery = `const timing={data:[{span_id:'0000000000000000',timestamp:'2024-01-01T00:00:00.000000000Z',attributes:{'browser.resource_timing.fetch_start':'1000','browser.resource_timing.response_end':'1010'}}],meta:[{name:'timestamp',type:'DateTime64(9)'}]};
export function useQueriedChartConfig(config,options){return {data:options.enabled&&options.queryKeyPrefix==='TraceResourceTiming'?timing:undefined,isLoading:false,isError:false};}`;

if (browserTrace) {
  stubs['hooks/useChartConfig'] = timingQuery;
  stubs['hooks/useFieldExpressionGenerator'] =
    'export default ()=>({isLoading:false,getFieldExpression:undefined});';
}

function instrument(source, filename, names) {
  const tree = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const replacements = [];
  for (const node of tree.statements) {
    if (
      !ts.isFunctionDeclaration(node) ||
      !names.includes(node.name?.text) ||
      !node.body
    )
      continue;
    const body = node.body.getText(tree).slice(1, -1);
    replacements.push([
      node.body.getStart(tree),
      node.body.end,
      `{ const __phaseStart=performance.now();try {${body}} finally {window.__recordPhase?.('${node.name.text}',performance.now()-__phaseStart);} }`,
    ]);
  }
  for (const [start, end, replacement] of replacements.reverse())
    source = source.slice(0, start) + replacement + source.slice(end);
  return source;
}

async function build(before) {
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'browser.jsx')],
    bundle: true,
    minify: true,
    outfile: path.join(root, before ? 'before.js' : 'after.js'),
    platform: 'browser',
    sourcemap: true,
    nodePaths: [path.join(repo, 'node_modules')],
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
    tsconfig: path.join(repo, 'packages/app/tsconfig.json'),
    plugins: [
      {
        name: 'benchmark-boundaries',
        setup(build) {
          build.onResolve({ filter: /^next\/router$/ }, () => ({
            path: 'router',
            namespace: 'stub',
          }));
          build.onResolve({ filter: /^@\/hooks\/useChartConfig$/ }, args => {
            if (
              browserTrace &&
              args.importer
                .replaceAll('\\', '/')
                .endsWith('/hooks/useBrowserTraceEvents.ts')
            )
              return { path: 'timing-query', namespace: 'stub' };
          });
          build.onResolve({ filter: /^@\// }, args => {
            const name = args.path.slice(2);
            if (Object.hasOwn(stubs, name))
              return { path: name, namespace: 'stub' };
            return build.resolve(path.join(app, name), {
              resolveDir: app,
              kind: args.kind,
            });
          });
          build.onResolve({ filter: /^@styles\// }, args =>
            build.resolve(
              path.join(repo, 'packages/app/styles', args.path.slice(8)),
              { resolveDir: app, kind: args.kind },
            ),
          );
          build.onResolve(
            { filter: /DBRowSidePanel|DBRowDataPanel|EventTag/ },
            args => {
              const name = 'components/' + path.basename(args.path);
              if (stubs[name]) return { path: name, namespace: 'stub' };
            },
          );
          build.onResolve(
            {
              filter: /^@hyperdx\/common-utils\/dist\/core\/renderChartConfig$/,
            },
            () => ({ path: 'sql-renderer', namespace: 'stub' }),
          );
          build.onLoad({ filter: /.*/, namespace: 'stub' }, args =>
            stub(
              args.path === 'timing-query'
                ? timingQuery
                : args.path === 'sql-renderer'
                  ? `export const renderChartConfig=async(config)=>({sql:JSON.stringify(config),params:{}});`
                  : args.path === 'router'
                    ? `const router={query:{},push:()=>{},replace:()=>{}};export const useRouter=()=>router;export default router;`
                    : stubs[args.path],
            ),
          );
          build.onLoad({ filter: /\.scss$/ }, args => ({
            contents: sass.compile(args.path, {
              silenceDeprecations: [
                'legacy-js-api',
                'import',
                'global-builtin',
                'color-functions',
              ],
            }).css,
            loader: args.path.includes('.module.') ? 'local-css' : 'css',
            resolveDir: path.dirname(args.path),
          }));
          build.onLoad({ filter: /traceWaterfall(Data|Model)\.ts$/ }, args => {
            let contents = fs.readFileSync(args.path, 'utf8');
            contents = instrument(contents, args.path, [
              'sortWaterfallRows',
              'buildWaterfallTree',
              'flattenWaterfallTree',
              'getWaterfallTimelineRows',
              'createSortedWaterfallRows',
              'createWaterfallTree',
              'createFlattenedWaterfallRows',
              'createWaterfallTimelineRows',
              'createWaterfallView',
            ]);
            return {
              contents,
              loader: 'ts',
              resolveDir: path.dirname(args.path),
            };
          });
          build.onLoad({ filter: /TimelineMinimapBars\.tsx$/ }, args => {
            let contents = fs.readFileSync(args.path, 'utf8');
            if (before)
              contents = contents.replace(
                /top: `\$\{\(getMinimapRowTop\(row.index, rowCount\) \/ MINIMAP_HEIGHT\) \* 100\}%`,\s*height: `\$\{\(BAR_HEIGHT \/ MINIMAP_HEIGHT\) \* 100\}%`,/,
                'top: getMinimapRowTop(row.index, rowCount), height: BAR_HEIGHT,',
              );
            return {
              contents,
              loader: 'tsx',
              resolveDir: path.dirname(args.path),
            };
          });
        },
      },
    ],
  });
}
Promise.resolve()
  .then(() => build(true))
  .then(() => build(false))
  .then(() => console.log('Built production browser harness'))
  .catch(e => {
    console.error(e.message);
    process.exitCode = 1;
  });
