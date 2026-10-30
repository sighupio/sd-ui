import { describe, expect, it } from 'vitest';
import {
  getModuleValue,
  getNestedValue,
  parseSdSpec,
  SD_SPEC_CONFIGMAP_NAME,
  SD_SPEC_CONFIGMAP_NAMESPACE,
  SD_SPEC_DATA_KEY,
  toSdSpecResult,
} from './sdSpec';

// Shape rendered by templates/distribution/manifests/utilities/resources/sd-spec.yml.tpl
const SPEC = {
  distributionVersion: 'v1.36.0',
  cluster: { name: 'sd-ui', kind: 'OnPremises' },
  moduleVersions: { monitoring: 'v4.3.0', opa: 'v1.18.0', utilities: 'v0.1.1' },
  modules: {
    auth: { provider: { type: 'sso' } },
    logging: { type: 'opensearch', opensearch: { type: 'triple' } },
    monitoring: { type: 'prometheus' },
  },
  links: [
    { module: 'auth', name: 'Gangplank', url: 'https://gangplank.example.com' },
    { module: 'monitoring', name: 'Grafana', url: 'https://grafana.internal.example.com' },
  ],
};

function configMap(spec: unknown) {
  return { jsonData: { data: { [SD_SPEC_DATA_KEY]: JSON.stringify(spec) } } };
}

describe('ConfigMap location', () => {
  it('matches the ConfigMap rendered by the distribution utilities module', () => {
    expect(SD_SPEC_CONFIGMAP_NAMESPACE).toBe('headlamp');
    expect(SD_SPEC_CONFIGMAP_NAME).toBe('sd-spec');
    expect(SD_SPEC_DATA_KEY).toBe('info.json');
  });
});

describe('getNestedValue', () => {
  it('reads a dot-separated path', () => {
    expect(getNestedValue({ a: { b: { c: 'x' } } }, 'a.b.c')).toBe('x');
  });

  it('returns undefined when an intermediate key is missing or scalar', () => {
    expect(getNestedValue({ a: {} }, 'a.b.c')).toBeUndefined();
    expect(getNestedValue({ a: 'x' }, 'a.b')).toBeUndefined();
  });
});

describe('parseSdSpec', () => {
  it('parses the rendered ConfigMap data', () => {
    expect(parseSdSpec({ [SD_SPEC_DATA_KEY]: JSON.stringify(SPEC) })).toEqual(SPEC);
  });

  it('returns null when the key is missing or empty', () => {
    expect(parseSdSpec(undefined)).toBeNull();
    expect(parseSdSpec({})).toBeNull();
    expect(parseSdSpec({ [SD_SPEC_DATA_KEY]: '' })).toBeNull();
  });

  it('returns null when the value is not a JSON object', () => {
    expect(parseSdSpec({ [SD_SPEC_DATA_KEY]: '{not json' })).toBeNull();
    expect(parseSdSpec({ [SD_SPEC_DATA_KEY]: '[]' })).toBeNull();
    expect(parseSdSpec({ [SD_SPEC_DATA_KEY]: '"v1.36.0"' })).toBeNull();
  });

  it('defaults missing or mistyped fields', () => {
    const spec = parseSdSpec({
      [SD_SPEC_DATA_KEY]: JSON.stringify({
        distributionVersion: 1,
        cluster: 'x',
        moduleVersions: { monitoring: 'v4.3.0', logging: 5 },
        modules: [],
        links: {},
      }),
    });

    expect(spec).toEqual({
      distributionVersion: '',
      cluster: { name: '', kind: '' },
      moduleVersions: { monitoring: 'v4.3.0' },
      modules: {},
      links: [],
    });
  });

  it('has no links when rendered by a distribution version that does not list them', () => {
    const { links, ...withoutLinks } = SPEC;
    const spec = parseSdSpec({ [SD_SPEC_DATA_KEY]: JSON.stringify(withoutLinks) });

    expect(links).not.toHaveLength(0);
    expect(spec?.links).toEqual([]);
  });

  it('drops incomplete links and links that are not http(s)', () => {
    const valid = { module: 'monitoring', name: 'Grafana', url: 'https://grafana.example.com' };
    const spec = parseSdSpec({
      [SD_SPEC_DATA_KEY]: JSON.stringify({
        ...SPEC,
        links: [
          valid,
          'https://x.example.com',
          { ...valid, module: '' },
          { ...valid, name: 5 },
          { ...valid, url: 'grafana.example.com' },
          { ...valid, url: 'javascript:alert(1)' },
          { ...valid, url: 'http://plain.example.com' },
        ],
      }),
    });

    expect(spec?.links).toEqual([valid, { ...valid, url: 'http://plain.example.com' }]);
  });

  it('keeps empty module versions rendered by a furyctl without kfd data', () => {
    const spec = parseSdSpec({
      [SD_SPEC_DATA_KEY]: JSON.stringify({ ...SPEC, moduleVersions: {} }),
    });

    expect(spec?.moduleVersions).toEqual({});
    expect(spec?.modules).toEqual(SPEC.modules);
  });
});

describe('toSdSpecResult', () => {
  it('reports a permission error on 403', () => {
    expect(toSdSpecResult(null, { status: 403 })).toEqual({
      spec: null,
      loading: false,
      permissionError: true,
    });
  });

  it('reports no spec and not loading on 404 or any other error', () => {
    for (const error of [{ status: 404 }, { status: 500 }, new Error('boom')]) {
      expect(toSdSpecResult(null, error)).toEqual({
        spec: null,
        loading: false,
        permissionError: false,
      });
    }
  });

  it('is loading while neither the ConfigMap nor an error arrived', () => {
    expect(toSdSpecResult(null, null)).toEqual({
      spec: null,
      loading: true,
      permissionError: false,
    });
  });

  it('parses the ConfigMap once loaded', () => {
    expect(toSdSpecResult(configMap(SPEC), null)).toEqual({
      spec: SPEC,
      loading: false,
      permissionError: false,
    });
  });
});

describe('getModuleValue', () => {
  const spec = parseSdSpec({ [SD_SPEC_DATA_KEY]: JSON.stringify(SPEC) });

  it('returns the module field', () => {
    expect(getModuleValue(spec, 'logging.type')).toBe('opensearch');
    expect(getModuleValue(spec, 'logging.opensearch.type')).toBe('triple');
    expect(getModuleValue(spec, 'auth.provider.type')).toBe('sso');
  });

  it('returns an empty string for unknown paths, non-string values or no spec', () => {
    expect(getModuleValue(spec, 'policy.type')).toBe('');
    expect(getModuleValue(spec, 'logging')).toBe('');
    expect(getModuleValue(null, 'logging.type')).toBe('');
  });
});
