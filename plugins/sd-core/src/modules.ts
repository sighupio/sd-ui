import { getNestedValue } from './sdSpec';

export { getNestedValue };

export interface ModuleInfo {
  name: string;
  version: string;
  type: string;
  active: boolean;
  icon: string;
}

const MODULE_ICONS: Record<string, string> = {
  monitoring: 'mdi:chart-line',
  ingress: 'mdi:web',
  auth: 'mdi:lock',
  logging: 'mdi:text-box-search',
  networking: 'mdi:lan',
  dr: 'mdi:backup-restore',
  tracing: 'mdi:radar',
  policy: 'mdi:shield-lock',
  utilities: 'mdi:toolbox',
};

// Map from module name to the config path that determines if it's active
const MODULE_TYPE_PATHS: Record<string, string[]> = {
  networking: ['type'],
  logging: ['type'],
  monitoring: ['type'],
  tracing: ['type'],
  policy: ['type'],
  dr: ['type'],
  auth: ['provider.type'],
  // Ingress is special: active if nginx.type OR haproxy.type != none
  ingress: ['nginx.type', 'haproxy.type'],
  // Utilities has no top-level type: active if any component (headlamp) != none
  utilities: ['headlamp.type'],
};

// Modules made of independent components, reported as "<component> (<type>)"
const COMPONENT_MODULES = new Set(['ingress', 'utilities']);

// Module name in the KFD versions when it differs from the config one
const KFD_VERSION_NAMES: Record<string, string> = {
  policy: 'opa',
};

function getModuleType(moduleConfig: Record<string, any> | undefined, moduleName: string): { active: boolean; type: string } {
  if (!moduleConfig) return { active: false, type: 'unknown' };

  const paths = MODULE_TYPE_PATHS[moduleName];
  if (!paths) return { active: false, type: 'unknown' };

  // For component modules: active if ANY component type != none
  if (COMPONENT_MODULES.has(moduleName)) {
    const types: string[] = [];

    for (const p of paths) {
      const val = getNestedValue(moduleConfig, p);
      if (val && val !== 'none') {
        const component = p.split('.')[0];
        types.push(`${component} (${val})`);
      }
    }

    if (types.length > 0) {
      return { active: true, type: types.join(', ') };
    }

    return { active: false, type: 'none' };
  }

  const val = getNestedValue(moduleConfig, paths[0]);
  const typeStr = val ? String(val) : 'none';

  if (typeStr !== 'none') {
    const subType = getNestedValue(moduleConfig, `${typeStr}.type`);

    if (subType) {
      return { active: true, type: `${typeStr} (${subType})` };
    }
  }

  return { active: typeStr !== 'none', type: typeStr };
}

// Build the module list from KFD versions, enriched with config type spec
export function buildModules(
  moduleVersions: Record<string, any>,
  moduleConfigs: Record<string, any>
): ModuleInfo[] {
  return Object.keys(MODULE_TYPE_PATHS)
    .map(name => {
      const version = moduleVersions[KFD_VERSION_NAMES[name] || name] || '';
      const config = moduleConfigs[name];
      const { active, type } = getModuleType(config, name);

      return {
        name,
        version,
        type,
        active,
        icon: MODULE_ICONS[name] || 'mdi:puzzle',
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
