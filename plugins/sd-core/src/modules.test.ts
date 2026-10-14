import { describe, expect, it } from 'vitest';
import { buildModules, getNestedValue } from './modules';
import { parseSdSpec, SD_SPEC_DATA_KEY } from './sdSpec';

// Versions as found in the kfd.yaml of distribution v1.36.0
const KFD_VERSIONS = {
  auth: 'v0.8.0-rc.5',
  aws: 'v5.4.0-rc.0',
  dr: 'v3.5.0-rc.0',
  ingress: 'v5.2.0-rc.0',
  logging: 'v5.5.0-rc.3',
  monitoring: 'v4.3.0-rc.2',
  opa: 'v1.18.0-rc.3',
  networking: 'v4.1.0-rc.1',
  tracing: 'v1.6.0-rc.0',
  utilities: 'v0.1.1',
};

function findModule(modules: ReturnType<typeof buildModules>, name: string) {
  const mod = modules.find(m => m.name === name);
  expect(mod).toBeDefined();
  return mod!;
}

describe('getNestedValue', () => {
  it('reads a dot-separated path', () => {
    expect(getNestedValue({ a: { b: { c: 'x' } } }, 'a.b.c')).toBe('x');
  });

  it('returns undefined when an intermediate key is missing or scalar', () => {
    expect(getNestedValue({ a: {} }, 'a.b.c')).toBeUndefined();
    expect(getNestedValue({ a: 'scalar' }, 'a.b')).toBeUndefined();
  });
});

describe('buildModules', () => {
  it('lists the utilities module with its KFD version', () => {
    const utilities = findModule(buildModules(KFD_VERSIONS, {}), 'utilities');
    expect(utilities.version).toBe('v0.1.1');
    expect(utilities.icon).toBe('mdi:toolbox');
  });

  it('reports utilities as inactive when not in the config (e.g. KFDDistribution)', () => {
    const utilities = findModule(buildModules(KFD_VERSIONS, {}), 'utilities');
    expect(utilities.active).toBe(false);
  });

  it('reports utilities as inactive when headlamp.type is none', () => {
    const modules = buildModules(KFD_VERSIONS, { utilities: { headlamp: { type: 'none' } } });
    expect(findModule(modules, 'utilities')).toMatchObject({ active: false, type: 'none' });
  });

  it.each(['sso', 'token-auth'])('reports utilities as active when headlamp.type is %s', type => {
    const modules = buildModules(KFD_VERSIONS, { utilities: { headlamp: { type } } });
    expect(findModule(modules, 'utilities')).toMatchObject({ active: true, type: `headlamp (${type})` });
  });

  it('does not list modules without a config mapping (aws)', () => {
    expect(buildModules(KFD_VERSIONS, {}).map(m => m.name)).not.toContain('aws');
  });

  it('returns modules sorted by name', () => {
    expect(buildModules(KFD_VERSIONS, {}).map(m => m.name)).toEqual([
      'auth',
      'dr',
      'ingress',
      'logging',
      'monitoring',
      'networking',
      'policy',
      'tracing',
      'utilities',
    ]);
  });

  it('takes the policy version from the opa KFD entry', () => {
    expect(findModule(buildModules(KFD_VERSIONS, {}), 'policy').version).toBe('v1.18.0-rc.3');
  });

  it('leaves the version empty when missing from KFD', () => {
    expect(findModule(buildModules({}, {}), 'utilities').version).toBe('');
  });

  it('reports ingress components that are not none', () => {
    const modules = buildModules(KFD_VERSIONS, {
      ingress: { nginx: { type: 'single' }, haproxy: { type: 'dual' } },
    });
    expect(findModule(modules, 'ingress')).toMatchObject({
      active: true,
      type: 'nginx (single), haproxy (dual)',
    });
  });

  it('reports ingress as inactive when all components are none', () => {
    const modules = buildModules(KFD_VERSIONS, {
      ingress: { nginx: { type: 'none' }, haproxy: { type: 'none' } },
    });
    expect(findModule(modules, 'ingress')).toMatchObject({ active: false, type: 'none' });
  });

  it('appends the sub-type for single-type modules', () => {
    const modules = buildModules(KFD_VERSIONS, { policy: { type: 'gatekeeper', gatekeeper: { type: 'x' } } });
    expect(findModule(modules, 'policy')).toMatchObject({ active: true, type: 'gatekeeper (x)' });
  });

  it('reads auth activity from provider.type', () => {
    const modules = buildModules(KFD_VERSIONS, { auth: { provider: { type: 'sso' } } });
    expect(findModule(modules, 'auth')).toMatchObject({ active: true, type: 'sso' });
  });

  it('reports single-type modules set to none as inactive', () => {
    const modules = buildModules(KFD_VERSIONS, { tracing: { type: 'none' } });
    expect(findModule(modules, 'tracing')).toMatchObject({ active: false, type: 'none' });
  });
});

describe('buildModules from the sd-spec ConfigMap', () => {
  // info.json of distribution tests/templates/onpremises/05-headlamp-sso/baseline/manifests/utilities/resources/sd-spec.yml
  const RENDERED_SPEC = {
    'cluster': {
      'kind': 'OnPremises',
      'name': 'headlamp-sso'
    },
    'distributionVersion': 'v1.36.0',
    'moduleVersions': {
      'auth': 'v0.8.0-rc.5',
      'aws': 'v5.4.0-rc.0',
      'dr': 'v3.5.0-rc.0',
      'ingress': 'v5.2.0-rc.0',
      'logging': 'v5.5.0-rc.3',
      'monitoring': 'v4.3.0-rc.4',
      'networking': 'v4.1.0-rc.1',
      'opa': 'v1.18.0-rc.4',
      'tracing': 'v1.6.0-rc.0',
      'utilities': 'v0.1.1'
    },
    'modules': {
      'auth': {
        'provider': {
          'type': 'sso'
        }
      },
      'dr': {
        'type': 'on-premises'
      },
      'ingress': {
        'haproxy': {
          'type': 'none'
        },
        'nginx': {
          'type': 'dual'
        }
      },
      'logging': {
        'type': 'loki'
      },
      'monitoring': {
        'type': 'mimir'
      },
      'networking': {
        'type': 'calico'
      },
      'policy': {
        'type': 'gatekeeper'
      },
      'tracing': {
        'type': 'tempo'
      },
      'utilities': {
        'headlamp': {
          'type': 'sso'
        }
      }
    }
  };

  const spec = parseSdSpec({ [SD_SPEC_DATA_KEY]: JSON.stringify(RENDERED_SPEC) })!;
  const modules = buildModules(spec.moduleVersions, spec.modules);

  it('combines kfd versions and module types', () => {
    expect(findModule(modules, 'monitoring')).toMatchObject({ version: 'v4.3.0-rc.4', type: 'mimir', active: true });
    expect(findModule(modules, 'policy')).toMatchObject({ version: 'v1.18.0-rc.4', type: 'gatekeeper', active: true });
    expect(findModule(modules, 'auth')).toMatchObject({ type: 'sso', active: true });
    expect(findModule(modules, 'ingress')).toMatchObject({ type: 'nginx (dual)', active: true });
    expect(findModule(modules, 'utilities')).toMatchObject({ version: 'v0.1.1', type: 'headlamp (sso)', active: true });
  });

  it('reports the logging sub-type rendered for opensearch', () => {
    const opensearch = buildModules(spec.moduleVersions, {
      ...spec.modules,
      logging: { type: 'opensearch', opensearch: { type: 'triple' } },
    });

    expect(findModule(opensearch, 'logging')).toMatchObject({ type: 'opensearch (triple)', active: true });
  });
});
