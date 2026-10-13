import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';

const GK_API = '/apis/constraints.gatekeeper.sh/v1beta1';

export interface GatekeeperViolation {
  constraintKind: string;
  constraintName: string;
  enforcementAction: string;
  kind: string;
  name: string;
  namespace: string;
  message: string;
}

export async function fetchGatekeeperViolations(): Promise<GatekeeperViolation[]> {
  // 1. Discover available constraint CRD types
  const apiResponse = await ApiProxy.request(GK_API, { method: 'GET', isJSON: false });

  if (apiResponse.status !== 200) {
    throw new Error(`Failed to list Gatekeeper constraint types: ${apiResponse.statusText}`);
  }

  const apiData = await apiResponse.json();
  const resources: Array<{ name: string; kind: string }> = apiData.resources || [];

  // Filter to only list-able resources (skip /status subresources)
  const listable = resources.filter(r => !r.name.includes('/'));

  const violations: GatekeeperViolation[] = [];

  // 2. For each constraint type, list constraints and extract violations
  for (const resource of listable) {
    try {
      const listResponse = await ApiProxy.request(`${GK_API}/${resource.name}`, {
        method: 'GET',
        isJSON: false,
      });

      if (listResponse.status !== 200) continue;

      const listData = await listResponse.json();

      for (const item of listData.items || []) {
        const constraintName = item.metadata?.name || '';
        const constraintKind = item.kind || resource.kind || '';
        const enforcementAction = item.spec?.enforcementAction || 'deny';

        for (const v of item.status?.violations || []) {
          violations.push({
            constraintKind,
            constraintName,
            enforcementAction: v.enforcementAction || enforcementAction,
            kind: v.kind || '',
            name: v.name || '',
            namespace: v.namespace || '',
            message: v.message || '',
          });
        }
      }
    } catch {
      // skip if this constraint type fails
    }
  }

  return violations;
}
