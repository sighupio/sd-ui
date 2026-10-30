import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useKfdData } from './hooks';
import { SD_SPEC_DATA_KEY } from './sdSpec';

// vi.mock is hoisted above the imports, so ./hooks gets the mocked K8s.

// headlamp/sd-spec ConfigMap returned by the mocked cluster, null while loading
let configMap: any = null;

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
      ConfigMap: {
        useGet: () => queryResponse(configMap),
      },
    },
  },
}));

function sdSpec(spec: unknown) {
  return { jsonData: { data: { [SD_SPEC_DATA_KEY]: JSON.stringify(spec) } } };
}

const SPEC = {
  distributionVersion: 'v1.36.0',
  cluster: { name: 'sd-ui', kind: 'OnPremises' },
  moduleVersions: { monitoring: 'v4.3.0' },
  modules: { auth: { provider: { type: 'sso' } }, monitoring: { type: 'prometheus' } },
  links: [
    { module: 'monitoring', name: 'Grafana', url: 'https://grafana.example.com' },
    { module: 'auth', name: 'Gangplank', url: 'https://gangplank.example.com' },
  ],
};

describe('useKfdData', () => {
  beforeEach(() => {
    configMap = null;
  });

  it('returns the links listed in the distribution spec', () => {
    configMap = sdSpec(SPEC);

    expect(useKfdData().links).toEqual(SPEC.links);
  });

  it('adds a module row for links of a module the plugin does not know', () => {
    configMap = sdSpec({
      ...SPEC,
      links: [...SPEC.links, { module: 'mesh', name: 'Kiali', url: 'https://kiali.example.com' }],
    });

    const data = useKfdData();

    expect(data.links.map(l => l.name)).toContain('Kiali');
    expect(data.modules.find(m => m.name === 'mesh')).toMatchObject({ active: false, type: '' });
  });

  it('returns no links when the spec does not list them or is still loading', () => {
    // JSON.stringify drops the undefined field
    configMap = sdSpec({ ...SPEC, links: undefined });
    expect(useKfdData().links).toEqual([]);

    configMap = null;
    expect(useKfdData()).toMatchObject({ loading: true, links: [] });
  });
});
