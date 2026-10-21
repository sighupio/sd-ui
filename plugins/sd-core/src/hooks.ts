import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { buildIngressLinks, FetchedIngress, INGRESS_DEFS, UsefulLink } from './ingressLinks';
import { buildModules, ModuleInfo } from './modules';
import {
  getModuleValue,
  SD_SPEC_CONFIGMAP_NAME,
  SD_SPEC_CONFIGMAP_NAMESPACE,
  SdSpecResult,
  toSdSpecResult,
} from './sdSpec';

export type { UsefulLink } from './ingressLinks';
export type { ModuleInfo } from './modules';

export interface KfdData {
  kfdVersion: string;
  modules: ModuleInfo[];
  clusterName: string;
  clusterKind: string;
  isSso: boolean;
  loading: boolean;
  permissionError: boolean;
  isSdCluster: boolean;
}

export function useSdSpec(): SdSpecResult {
  const [configMap, error] = K8s.ResourceClasses.ConfigMap.useGet(
    SD_SPEC_CONFIGMAP_NAME,
    SD_SPEC_CONFIGMAP_NAMESPACE
  );

  return toSdSpecResult(configMap, error);
}

export function useKfdData(): KfdData {
  const { spec, loading, permissionError } = useSdSpec();

  const notFound = { kfdVersion: '', modules: [], clusterName: '', clusterKind: '', isSso: false, loading: false, permissionError: false, isSdCluster: false };

  if (permissionError) {
    return { ...notFound, permissionError: true };
  }

  if (loading) {
    return { ...notFound, loading: true };
  }

  // ConfigMap not found or unreadable — not a SIGHUP Distribution cluster
  if (!spec) {
    return notFound;
  }

  return {
    kfdVersion: spec.distributionVersion || 'Unknown',
    modules: buildModules(spec.moduleVersions, spec.modules),
    clusterName: spec.cluster.name || 'Unknown',
    clusterKind: spec.cluster.kind || 'Unknown',
    isSso: getModuleValue(spec, 'auth.provider.type') === 'sso',
    loading: false,
    permissionError: false,
    isSdCluster: true,
  };
}

// The defs list is a module-level constant, so the number and order of useGet
// calls is stable across renders, as required by the rules of hooks.
// useGet returns an object that is iterable like a [data, error] tuple but has no
// numeric indexes: read `.data`, never `[0]`.
export function useIngressLinks(isSso: boolean): UsefulLink[] {
  const fetched: FetchedIngress[] = INGRESS_DEFS.map(def => ({
    // eslint-disable-next-line react-hooks/rules-of-hooks
    sso: def.sso ? K8s.ResourceClasses.Ingress.useGet(def.sso.name, def.sso.namespace).data : undefined,
    // eslint-disable-next-line react-hooks/rules-of-hooks
    noSso: K8s.ResourceClasses.Ingress.useGet(def.noSso.name, def.noSso.namespace).data,
  }));

  return buildIngressLinks(INGRESS_DEFS, fetched, isSso);
}
