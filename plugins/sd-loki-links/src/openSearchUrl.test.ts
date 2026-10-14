import { describe, expect, it } from 'vitest';
import {
  buildDqlQuery,
  buildOpenSearchDiscoverUrl,
  extractPodLabels,
  resolveIndexPatternId,
} from './openSearchUrl';

// Reads one Rison state value back out of a Discover URL.
function stateParam(url: string, key: '_a' | '_g' | '_q'): string {
  const hash = url.slice(url.indexOf('#?') + 2);
  const raw = hash.split('&').find(p => p.startsWith(`${key}=`));

  return decodeURIComponent((raw as string).slice(key.length + 1));
}

describe('resolveIndexPatternId', () => {
  it('routes tenant namespaces to kubernetes-*', () => {
    expect(resolveIndexPatternId('shop')).toBe('kubernetes');
    expect(resolveIndexPatternId('sock-shop')).toBe('kubernetes');
  });

  it('routes every namespace selected by the infra ClusterFlow to infra-*', () => {
    // The list in katalog/configs/infra/cluster-flow.yml.
    const infra = [
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
    ];

    for (const ns of infra) {
      expect(resolveIndexPatternId(ns)).toBe('infra');
    }
  });

  it('routes nginx controller pods to ingress-controller-*, not their namespace index', () => {
    expect(resolveIndexPatternId('ingress-nginx', { app: 'ingress-nginx' })).toBe(
      'ingress-controller'
    );
    expect(resolveIndexPatternId('ingress-nginx', { app: 'ingress', type: 'external' })).toBe(
      'ingress-controller'
    );
    expect(resolveIndexPatternId('ingress-nginx', { app: 'ingress', type: 'internal' })).toBe(
      'ingress-controller'
    );
  });

  it('leaves other ingress-nginx workloads on infra-*', () => {
    expect(resolveIndexPatternId('ingress-nginx')).toBe('infra');
    expect(resolveIndexPatternId('ingress-nginx', { app: 'something-else' })).toBe('infra');
    // `app: ingress` only leaves infra when paired with an external/internal type.
    expect(resolveIndexPatternId('ingress-nginx', { app: 'ingress' })).toBe('infra');
  });

  it('ignores controller labels outside the ingress-nginx namespace', () => {
    expect(resolveIndexPatternId('shop', { app: 'ingress-nginx' })).toBe('kubernetes');
  });
});

describe('buildDqlQuery', () => {
  it('matches a single pod exactly', () => {
    expect(buildDqlQuery('Pod', 'front-end-7d9f8b6c4-abcde', 'shop')).toBe(
      'kubernetes.namespace_name.keyword:"shop" and kubernetes.pod_name.keyword:"front-end-7d9f8b6c4-abcde"'
    );
  });

  it('leaves the workload wildcard unquoted', () => {
    // DQL only expands wildcards outside quotes. Quoting the value turns it into a
    // match_phrase, which matches nothing — verified against OpenSearch 3.2.0.
    for (const kind of ['Deployment', 'DaemonSet', 'StatefulSet']) {
      const dql = buildDqlQuery(kind, 'front-end', 'shop');

      expect(dql).toBe(
        'kubernetes.namespace_name.keyword:"shop" and kubernetes.pod_name.keyword:front-end-*'
      );
      expect(dql).not.toContain('"front-end-*"');
    }
  });

  it('scopes a workload to its own namespace', () => {
    // Guards against matching an identically named workload in another namespace.
    expect(buildDqlQuery('Deployment', 'front-end', 'shop')).toContain(
      'kubernetes.namespace_name.keyword:"shop"'
    );
  });

  it('matches a whole namespace by its own name', () => {
    expect(buildDqlQuery('Namespace', 'shop', '')).toBe(
      'kubernetes.namespace_name.keyword:"shop"'
    );
  });

  it('falls back to the namespace for unexpected kinds', () => {
    expect(buildDqlQuery('CronJob', 'nightly', 'shop')).toBe(
      'kubernetes.namespace_name.keyword:"shop"'
    );
  });
});

describe('buildOpenSearchDiscoverUrl', () => {
  const url = buildOpenSearchDiscoverUrl(
    'https://opensearch-dashboards.example.com',
    'kubernetes',
    'kubernetes.namespace_name.keyword:"shop" and kubernetes.pod_name.keyword:front-end-*'
  );

  it('targets data-explorer, not the legacy discover path', () => {
    // /app/discover redirects to data-explorer but drops _q and the column list.
    expect(url.startsWith(
      'https://opensearch-dashboards.example.com/app/data-explorer/discover#?'
    )).toBe(true);
    expect(url).not.toContain('/app/discover');
  });

  it('carries both the view slice and metadata in _a', () => {
    // data_explorer uses _a verbatim when present instead of merging it with defaults,
    // so a missing `discover` key would leave the view state undefined.
    expect(stateParam(url, '_a')).toBe(
      '(discover:(columns:!(kubernetes.pod_name,kubernetes.container_name,message),sort:!(),isDirty:!f),metadata:(indexPattern:kubernetes,view:discover))'
    );
  });

  it('sets the time range and pauses auto-refresh in _g', () => {
    expect(stateParam(url, '_g')).toBe(
      '(refreshInterval:(pause:!t,value:0),time:(from:now-1h,to:now))'
    );
  });

  it('puts the DQL in _q as a Rison-quoted kuery string', () => {
    expect(stateParam(url, '_q')).toBe(
      `(filters:!(),query:(language:kuery,query:'kubernetes.namespace_name.keyword:"shop" and kubernetes.pod_name.keyword:front-end-*'))`
    );
  });

  it('percent-encodes each state value so the hash parses as one param each', () => {
    expect(url).not.toMatch(/[ "]/);
    expect(url.split('&').length).toBe(3);
  });

  it('escapes Rison metacharacters in the query', () => {
    const tricky = buildOpenSearchDiscoverUrl('https://osd', 'kubernetes', `it's a !bang`);

    expect(stateParam(tricky, '_q')).toContain(`'it!'s a !!bang'`);
  });

  it('honours the resolved index pattern', () => {
    for (const id of ['infra', 'ingress-controller'] as const) {
      expect(stateParam(buildOpenSearchDiscoverUrl('https://osd', id, 'x:1'), '_a')).toContain(
        `indexPattern:${id}`
      );
    }
  });
});

describe('extractPodLabels', () => {
  it('reads pod labels straight off a Pod', () => {
    const pod = { jsonData: { metadata: { labels: { app: 'ingress-nginx' } } } };

    expect(extractPodLabels(pod, 'Pod')).toEqual({ app: 'ingress-nginx' });
  });

  it('reads the pod template labels off a workload', () => {
    const deploy = {
      jsonData: {
        metadata: { labels: { app: 'controller-chart-label' } },
        spec: { template: { metadata: { labels: { app: 'ingress-nginx' } } } },
      },
    };

    // The pods carry the template labels, which is what the logging Flow selects on.
    expect(extractPodLabels(deploy, 'Deployment')).toEqual({ app: 'ingress-nginx' });
  });

  it('has no pod labels for a Namespace', () => {
    const ns = { jsonData: { metadata: { name: 'shop', labels: { app: 'ingress-nginx' } } } };

    expect(extractPodLabels(ns, 'Namespace')).toBeUndefined();
  });

  it('tolerates missing resource data', () => {
    expect(extractPodLabels(undefined, 'Pod')).toBeUndefined();
    expect(extractPodLabels({}, 'Deployment')).toBeUndefined();
  });
});
