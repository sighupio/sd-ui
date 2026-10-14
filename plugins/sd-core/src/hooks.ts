import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { buildModules, ModuleInfo } from './modules';
import {
  getModuleValue,
  SD_SPEC_CONFIGMAP_NAME,
  SD_SPEC_CONFIGMAP_NAMESPACE,
  SdSpecResult,
  toSdSpecResult,
} from './sdSpec';

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

export interface UsefulLink {
  name: string;
  url: string;
  module: string;
}

// Known infrastructure ingresses with their namespace per auth mode
interface IngressDef {
  ingressName: string;
  displayName: string;
  module: string;
  ssoNamespace: string;
  noSsoNamespace: string;
  ssoIngressName?: string;
}

const INGRESS_DEFS: IngressDef[] = [
  { ingressName: 'grafana', displayName: 'Grafana', module: 'monitoring', ssoNamespace: 'pomerium', noSsoNamespace: 'monitoring' },
  { ingressName: 'prometheus', displayName: 'Prometheus', module: 'monitoring', ssoNamespace: 'pomerium', noSsoNamespace: 'monitoring' },
  { ingressName: 'alertmanager', displayName: 'Alertmanager', module: 'monitoring', ssoNamespace: 'pomerium', noSsoNamespace: 'monitoring' },
  { ingressName: 'opensearch-dashboards', displayName: 'OpenSearch Dashboards', module: 'logging', ssoNamespace: 'pomerium', noSsoNamespace: 'logging' },
  { ingressName: 'hubble', displayName: 'Hubble UI', module: 'networking', ssoNamespace: 'pomerium', noSsoNamespace: 'kube-system' },
  { ingressName: 'gpm', displayName: 'Gatekeeper Policy Manager', module: 'policy', ssoNamespace: 'pomerium', noSsoNamespace: 'gatekeeper-system' },
  { ingressName: 'forecastle', displayName: 'Forecastle', module: 'ingress', ssoNamespace: 'pomerium', noSsoNamespace: 'forecastle' },
];

function extractHost(ingress: any): string {
  const rules = ingress?.jsonData?.spec?.rules;

  if (rules && rules.length > 0 && rules[0].host) {
    return rules[0].host;
  }

  return '';
}

// All useGet calls must be static (React hooks rules), so we call all of them
// and filter results based on which ones succeed.
export function useIngressLinks(isSso: boolean): UsefulLink[] {
  // SSO namespaces
  const [grafanaSso] = K8s.ResourceClasses.Ingress.useGet('grafana', 'pomerium');
  const [promSso] = K8s.ResourceClasses.Ingress.useGet('prometheus', 'pomerium');
  const [alertSso] = K8s.ResourceClasses.Ingress.useGet('alertmanager', 'pomerium');
  const [osdSso] = K8s.ResourceClasses.Ingress.useGet('opensearch-dashboards', 'pomerium');
  const [hubbleSso] = K8s.ResourceClasses.Ingress.useGet('hubble', 'pomerium');
  const [gpmSso] = K8s.ResourceClasses.Ingress.useGet('gpm', 'pomerium');
  const [forecastleSso] = K8s.ResourceClasses.Ingress.useGet('forecastle', 'pomerium');

  // Non-SSO namespaces
  const [grafanaNoSso] = K8s.ResourceClasses.Ingress.useGet('grafana', 'monitoring');
  const [promNoSso] = K8s.ResourceClasses.Ingress.useGet('prometheus', 'monitoring');
  const [alertNoSso] = K8s.ResourceClasses.Ingress.useGet('alertmanager', 'monitoring');
  const [osdNoSso] = K8s.ResourceClasses.Ingress.useGet('opensearch-dashboards', 'logging');
  const [hubbleNoSso] = K8s.ResourceClasses.Ingress.useGet('hubble', 'kube-system');
  const [gpmNoSso] = K8s.ResourceClasses.Ingress.useGet('gpm', 'gatekeeper-system');
  const [forecastleNoSso] = K8s.ResourceClasses.Ingress.useGet('forecastle', 'forecastle');

  const ssoIngresses = [grafanaSso, promSso, alertSso, osdSso, hubbleSso, gpmSso, forecastleSso];
  const noSsoIngresses = [grafanaNoSso, promNoSso, alertNoSso, osdNoSso, hubbleNoSso, gpmNoSso, forecastleNoSso];

  const ingresses = isSso ? ssoIngresses : noSsoIngresses;

  const links: UsefulLink[] = [];

  for (let i = 0; i < INGRESS_DEFS.length; i++) {
    const def = INGRESS_DEFS[i];
    const ing = ingresses[i];
    const host = extractHost(ing);

    if (host) {
      links.push({ name: def.displayName, url: `https://${host}`, module: def.module });
    }
  }

  return links;
}
