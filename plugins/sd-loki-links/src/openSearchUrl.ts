// OpenSearch Dashboards deep links into Discover.
//
// Verified against OpenSearch Dashboards 3.2.0 (the version the logging module ships in
// katalog/opensearch-dashboards/kustomization.yaml).
//
// Two OSD behaviours this module depends on:
//   1. Discover lives at /app/data-explorer/discover. The legacy /app/discover path
//      redirects there but DROPS the query and the column list, so it is not usable.
//   2. data_explorer consumes the `_a` state verbatim when present — it does not merge it
//      with defaults — so `_a` must carry both the `discover` view slice and `metadata`.
//
// The state is Rison-encoded, not JSON (unlike the Grafana Explore link in index.tsx).

// Namespaces routed to infra-* by the infra ClusterFlow, from the logging module's
// katalog/configs/infra/cluster-flow.yml. The kubernetes ClusterFlow excludes exactly
// this list and takes everything else, so anything absent here lands in kubernetes-*.
const INFRA_NAMESPACES = new Set([
  'kube-system',
  'logging',
  'monitoring',
  'ingress-nginx',
  'cert-manager',
  'tigera-operator',
  'calico-system',
  'calico-api',
  'vmware-system-csi',
  'pomerium',
  'gatekeeper-system',
  'tracing',
  'kyverno',
]);

// Saved-object IDs of the index patterns imported hourly by index-patterns-cronjob from
// katalog/opensearch-dashboards/configs/index-patterns.ndjson. The IDs are fixed in that
// file, so they can be referenced directly with no saved-objects lookup.
export type IndexPatternId = 'kubernetes' | 'infra' | 'ingress-controller';

type Labels = Record<string, string> | undefined;

// The ingress-nginx Flow (katalog/configs/ingress-nginx/flow.yml) pulls the nginx
// controller pods out of their namespace's ClusterFlow and into ingress-controller-*.
function isIngressControllerPod(labels: Labels): boolean {
  if (!labels) return false;

  if (labels.app === 'ingress-nginx') return true;

  return labels.app === 'ingress' && (labels.type === 'external' || labels.type === 'internal');
}

export function resolveIndexPatternId(namespace: string, labels?: Labels): IndexPatternId {
  if (namespace === 'ingress-nginx' && isIngressControllerPod(labels)) {
    return 'ingress-controller';
  }

  return INFRA_NAMESPACES.has(namespace) ? 'infra' : 'kubernetes';
}

// kubernetes.* string fields are dynamically mapped (the index templates set no mappings),
// so they are `text` with a `.keyword` sub-field. Matching on `.keyword` is what sd-logs'
// opensearchLogClient.ts already does.
//
// The wildcard value must stay UNQUOTED: DQL only expands wildcards outside quotes, so a
// quoted "name-*" becomes a match_phrase and returns nothing. Pod names are DNS-1123, so
// they never contain characters that would need quoting.
export function buildDqlQuery(kind: string, name: string, namespace: string): string {
  const ns = `kubernetes.namespace_name.keyword:"${namespace}"`;

  switch (kind) {
    case 'Pod':
      return `${ns} and kubernetes.pod_name.keyword:"${name}"`;
    case 'Deployment':
    case 'DaemonSet':
    case 'StatefulSet':
      return `${ns} and kubernetes.pod_name.keyword:${name}-*`;
    case 'Namespace':
      return `kubernetes.namespace_name.keyword:"${name}"`;
    default:
      return ns;
  }
}

type RisonValue = string | number | boolean | RisonValue[] | { [key: string]: RisonValue };

// Rison strings may be left bare unless they contain a delimiter or start like a number.
// Mirrors the id_ok test in the rison-node package OSD parses the URL with.
const RISON_BARE = /^[^-0123456789 '!:(),*@$][^ '!:(),*@$]*$/;

function encodeRison(value: RisonValue): string {
  if (typeof value === 'boolean') return value ? '!t' : '!f';
  if (typeof value === 'number') return String(value);

  if (typeof value === 'string') {
    if (RISON_BARE.test(value)) return value;

    return `'${value.replace(/!/g, '!!').replace(/'/g, "!'")}'`;
  }

  if (Array.isArray(value)) {
    return `!(${value.map(encodeRison).join(',')})`;
  }

  const pairs = Object.keys(value).map(key => `${encodeRison(key)}:${encodeRison(value[key])}`);

  return `(${pairs.join(',')})`;
}

// Columns shown in the Discover table. Anything not present in the index pattern is simply
// not rendered, so this is safe across the kubernetes-*, infra-* and ingress-controller-*
// patterns.
const COLUMNS = ['kubernetes.pod_name', 'kubernetes.container_name', 'message'];

// Matches the default lookback sd-logs uses for its own queries.
const TIME_FROM = 'now-1h';

export function buildOpenSearchDiscoverUrl(
  osdUrl: string,
  indexPatternId: IndexPatternId,
  dql: string
): string {
  const appState = encodeRison({
    discover: { columns: COLUMNS, sort: [], isDirty: false },
    metadata: { indexPattern: indexPatternId, view: 'discover' },
  });
  const globalState = encodeRison({
    refreshInterval: { pause: true, value: 0 },
    time: { from: TIME_FROM, to: 'now' },
  });
  const queryState = encodeRison({
    filters: [],
    query: { language: 'kuery', query: dql },
  });

  const params = [
    `_a=${encodeURIComponent(appState)}`,
    `_g=${encodeURIComponent(globalState)}`,
    `_q=${encodeURIComponent(queryState)}`,
  ].join('&');

  return `${osdUrl}/app/data-explorer/discover#?${params}`;
}

// Labels of the pods a resource owns — needed only to spot nginx controller pods, which
// are routed to a different index than the rest of their namespace.
export function extractPodLabels(resource: any, kind: string): Labels {
  const data = resource?.jsonData || resource;

  if (kind === 'Pod') return data?.metadata?.labels;
  if (kind === 'Namespace') return undefined;

  return data?.spec?.template?.metadata?.labels;
}
