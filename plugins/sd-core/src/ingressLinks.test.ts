import { describe, expect, it } from 'vitest';
import { buildIngressLinks, extractHost, FetchedIngress, INGRESS_DEFS } from './ingressLinks';

function ingress(host: string) {
  return { jsonData: { spec: { rules: [{ host }] } } };
}

function findDef(module: string, displayName: string) {
  const def = INGRESS_DEFS.find(d => d.module === module && d.displayName === displayName);
  expect(def).toBeDefined();
  return def!;
}

// Builds the fetched list for INGRESS_DEFS, filling only the given defs
function fetchedFor(entries: Array<{ module: string; displayName: string; value: FetchedIngress }>): FetchedIngress[] {
  return INGRESS_DEFS.map(def => {
    const entry = entries.find(e => e.module === def.module && e.displayName === def.displayName);
    return entry ? entry.value : {};
  });
}

describe('extractHost', () => {
  it('returns the host of the first rule', () => {
    expect(extractHost(ingress('grafana.example.com'))).toBe('grafana.example.com');
  });

  it('returns an empty string for missing ingresses or rules', () => {
    expect(extractHost(undefined)).toBe('');
    expect(extractHost(null)).toBe('');
    expect(extractHost({ jsonData: { spec: {} } })).toBe('');
    expect(extractHost({ jsonData: { spec: { rules: [] } } })).toBe('');
  });
});

describe('INGRESS_DEFS', () => {
  it('matches the ingresses rendered by the distribution templates', () => {
    const locations = (def: (typeof INGRESS_DEFS)[number]) => [def.sso, def.noSso];

    expect(locations(findDef('auth', 'Gangplank'))).toEqual([undefined, { name: 'gangplank', namespace: 'kube-system' }]);
    expect(locations(findDef('networking', 'Whisker'))).toEqual([
      { name: 'whisker', namespace: 'pomerium' },
      { name: 'whisker', namespace: 'calico-system' },
    ]);
    expect(locations(findDef('monitoring', 'MinIO'))).toEqual([
      { name: 'minio-monitoring', namespace: 'pomerium' },
      { name: 'minio', namespace: 'monitoring' },
    ]);
    expect(locations(findDef('logging', 'MinIO'))).toEqual([
      { name: 'minio-logging', namespace: 'pomerium' },
      { name: 'minio', namespace: 'logging' },
    ]);
    expect(locations(findDef('tracing', 'MinIO'))).toEqual([
      { name: 'minio-tracing', namespace: 'pomerium' },
      { name: 'minio', namespace: 'tracing' },
    ]);
  });

  it('has unique locations', () => {
    const keys = INGRESS_DEFS.flatMap(d => [d.sso, d.noSso])
      .filter(Boolean)
      .map(l => `${l!.namespace}/${l!.name}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('buildIngressLinks', () => {
  it('returns no links when no ingress is found', () => {
    expect(buildIngressLinks(INGRESS_DEFS, fetchedFor([]), true)).toEqual([]);
    expect(buildIngressLinks(INGRESS_DEFS, fetchedFor([]), false)).toEqual([]);
  });

  it('uses the SSO ingress when the cluster uses SSO', () => {
    const fetched = fetchedFor([
      { module: 'networking', displayName: 'Whisker', value: { sso: ingress('whisker.sso.example.com') } },
      { module: 'tracing', displayName: 'MinIO', value: { sso: ingress('minio.tracing.example.com') } },
    ]);

    expect(buildIngressLinks(INGRESS_DEFS, fetched, true)).toEqual([
      { name: 'MinIO', url: 'https://minio.tracing.example.com', module: 'tracing' },
      { name: 'Whisker', url: 'https://whisker.sso.example.com', module: 'networking' },
    ]);
  });

  it('uses the module namespace ingress when the cluster does not use SSO', () => {
    const fetched = fetchedFor([
      { module: 'monitoring', displayName: 'MinIO', value: { noSso: ingress('minio.monitoring.example.com') } },
      { module: 'logging', displayName: 'MinIO', value: { noSso: ingress('minio.logging.example.com') } },
    ]);

    expect(buildIngressLinks(INGRESS_DEFS, fetched, false)).toEqual([
      { name: 'MinIO', url: 'https://minio.monitoring.example.com', module: 'monitoring' },
      { name: 'MinIO', url: 'https://minio.logging.example.com', module: 'logging' },
    ]);
  });

  it('prefers the location matching the auth mode when both exist', () => {
    const value = { sso: ingress('sso.example.com'), noSso: ingress('nosso.example.com') };
    const fetched = fetchedFor([{ module: 'monitoring', displayName: 'Grafana', value }]);

    expect(buildIngressLinks(INGRESS_DEFS, fetched, true)[0].url).toBe('https://sso.example.com');
    expect(buildIngressLinks(INGRESS_DEFS, fetched, false)[0].url).toBe('https://nosso.example.com');
  });

  it('falls back to the module namespace for SSO clusters with disableAuth set on the ingress', () => {
    const fetched = fetchedFor([{ module: 'monitoring', displayName: 'Grafana', value: { noSso: ingress('grafana.example.com') } }]);

    expect(buildIngressLinks(INGRESS_DEFS, fetched, true)).toEqual([
      { name: 'Grafana', url: 'https://grafana.example.com', module: 'monitoring' },
    ]);
  });

  it('includes Gangplank regardless of the auth mode', () => {
    const fetched = fetchedFor([{ module: 'auth', displayName: 'Gangplank', value: { noSso: ingress('gangplank.example.com') } }]);
    const expected = [{ name: 'Gangplank', url: 'https://gangplank.example.com', module: 'auth' }];

    expect(buildIngressLinks(INGRESS_DEFS, fetched, true)).toEqual(expected);
    expect(buildIngressLinks(INGRESS_DEFS, fetched, false)).toEqual(expected);
  });
});
