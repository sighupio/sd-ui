// Distribution summary rendered by the SD distribution templates into the
// headlamp/sd-spec ConfigMap. It holds only versions, the cluster name/kind and
// the module types, so plugins never need read access to the furyctl-config Secret.
// The distribution renders it only together with Headlamp (utilities module, OnPremises and
// Immutable): on any other cluster it does not exist and the cluster is treated as non-SD.
//
// Every SD plugin is an independent npm project: keep this file identical in all of them.

export const SD_SPEC_CONFIGMAP_NAME = 'sd-spec';
export const SD_SPEC_CONFIGMAP_NAMESPACE = 'headlamp';
export const SD_SPEC_DATA_KEY = 'info.json';

export interface SdSpec {
  distributionVersion: string;
  cluster: { name: string; kind: string };
  // kfd.yaml module versions, keyed by the kfd.yaml name (e.g. `opa` for policy)
  moduleVersions: Record<string, string>;
  // Subset of spec.distribution.modules with only the `type` fields (e.g. logging.type)
  modules: Record<string, any>;
}

export interface SdSpecResult {
  spec: SdSpec | null;
  loading: boolean;
  permissionError: boolean;
}

// Navigate a nested object by dot-separated path
export function getNestedValue(obj: Record<string, any>, path: string): any {
  const parts = path.split('.');
  let current: any = obj;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = current[part];
  }

  return current;
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

// Parse the ConfigMap `data`. Returns null when the key is missing or is not valid JSON.
export function parseSdSpec(data: Record<string, string> | undefined): SdSpec | null {
  const raw = data?.[SD_SPEC_DATA_KEY];

  if (!raw) return null;

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isObject(parsed)) return null;

  const cluster = isObject(parsed.cluster) ? parsed.cluster : {};
  const moduleVersions: Record<string, string> = {};

  if (isObject(parsed.moduleVersions)) {
    for (const [name, version] of Object.entries(parsed.moduleVersions)) {
      if (typeof version === 'string') moduleVersions[name] = version;
    }
  }

  return {
    distributionVersion: asString(parsed.distributionVersion),
    cluster: { name: asString(cluster.name), kind: asString(cluster.kind) },
    moduleVersions,
    modules: isObject(parsed.modules) ? parsed.modules : {},
  };
}

// Map the result of `ConfigMap.useGet` to the result the plugins consume. A missing ConfigMap
// (404) or any other error means there is no distribution spec: not loading, no spec.
export function toSdSpecResult(configMap: any, error: any): SdSpecResult {
  if (error?.status === 403) {
    return { spec: null, loading: false, permissionError: true };
  }

  if (error) {
    return { spec: null, loading: false, permissionError: false };
  }

  if (!configMap) {
    return { spec: null, loading: true, permissionError: false };
  }

  return {
    spec: parseSdSpec(configMap?.jsonData?.data),
    loading: false,
    permissionError: false,
  };
}

// Value of a module field (e.g. `logging.type`), or '' when unknown
export function getModuleValue(spec: SdSpec | null, path: string): string {
  const value = getNestedValue(spec?.modules ?? {}, path);

  return typeof value === 'string' ? value : '';
}
