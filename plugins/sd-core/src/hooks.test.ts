import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useIngressLinks } from './hooks';

// vi.mock is hoisted above the imports, so ./hooks gets the mocked K8s.

// Ingresses present in the mocked cluster, keyed by "<namespace>/<name>"
const cluster: Record<string, any> = {};

// Same shape as Headlamp's useKubeObject result: `.data`/`.error` fields plus an
// iterator yielding [data, error], without numeric indexes.
function queryResponse(data: any) {
  return {
    data,
    error: null,
    *[Symbol.iterator]() {
      yield data;
      yield null;
    },
  };
}

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: {
    ResourceClasses: {
      Ingress: {
        useGet: (name: string, namespace: string) => queryResponse(cluster[`${namespace}/${name}`] ?? null),
      },
    },
  },
}));

function ingress(host: string) {
  return { jsonData: { spec: { rules: [{ host }] } } };
}

describe('useIngressLinks', () => {
  beforeEach(() => {
    for (const key of Object.keys(cluster)) delete cluster[key];
  });

  it('reads the ingresses returned by useGet', () => {
    cluster['pomerium/grafana'] = ingress('grafana.example.com');
    cluster['pomerium/minio-tracing'] = ingress('minio-tracing.example.com');
    cluster['kube-system/gangplank'] = ingress('gangplank.example.com');

    expect(useIngressLinks(true)).toEqual([
      { name: 'Grafana', url: 'https://grafana.example.com', module: 'monitoring' },
      { name: 'MinIO', url: 'https://minio-tracing.example.com', module: 'tracing' },
      { name: 'Gangplank', url: 'https://gangplank.example.com', module: 'auth' },
    ]);
  });

  it('returns no links when no ingress exists', () => {
    expect(useIngressLinks(true)).toEqual([]);
    expect(useIngressLinks(false)).toEqual([]);
  });
});
