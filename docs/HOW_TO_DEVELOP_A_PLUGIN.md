# How to Develop a Headlamp Plugin for SIGHUP Distribution

## Prerequisites

- [mise](https://mise.jdx.dev/) installed (`mise install` to get all tools)
- Dev cluster running (`mise run up && mise run dev`)
- Node.js (managed by mise)

## Plugin Structure

Every SD plugin lives in `plugins/<name>/` and has this structure:

```
plugins/sd-example/
├── package.json            # name, scripts, devDependencies
├── tsconfig.json           # extends headlamp plugin config
├── src/
│   ├── index.tsx           # entry point — registrations
│   ├── ExamplePage.tsx     # main page component
│   ├── hooks.ts            # data hooks (optional)
│   ├── client.ts           # API client (optional)
│   └── headlamp-plugin.d.ts # type reference (copy from any existing plugin)
└── dist/
    └── main.js             # built output (committed)
```

## Creating a New Plugin

```bash
# 1. Create directory and files
mkdir -p plugins/sd-example/src

# 2. Copy package.json from an existing plugin and change the name
cp plugins/sd-events/package.json plugins/sd-example/package.json
# Edit: change "name" to "sd-example"

# 3. Copy tsconfig and type reference
cp plugins/sd-events/tsconfig.json plugins/sd-example/tsconfig.json
cp plugins/sd-events/src/headlamp-plugin.d.ts plugins/sd-example/src/headlamp-plugin.d.ts

# 4. Install dependencies
cd plugins/sd-example && npm install

# 5. Write your code in src/index.tsx

# 6. Build
npm run tsc && npm run lint && npm run build
```

## Registration Patterns

### Sidebar Entry + Route (most common)

```typescript
// src/index.tsx
import { registerRoute, registerSidebarEntry } from '@kinvolk/headlamp-plugin/lib';
import MyPage from './MyPage';

registerSidebarEntry({
  parent: null,          // top-level entry
  name: 'sd-example',
  label: 'SD Example',
  url: '/sd/example',
  icon: 'mdi:puzzle',   // Iconify MDI icon
});

registerRoute({
  path: '/sd/example',
  sidebar: 'sd-example',
  name: 'sd-example',
  exact: true,
  component: MyPage,
});
```

### Override the Cluster Landing Page

```typescript
// sd-core does this to replace the default overview
registerRoute({
  path: '/',
  sidebar: 'cluster',
  name: 'cluster',
  exact: true,
  component: ClusterLanding,
});
```

### Auto-configure Another Plugin

```typescript
// sd-prometheus-autoconfig sets the Prometheus plugin address
import { ConfigStore } from '@kinvolk/headlamp-plugin/lib';

new ConfigStore<Record<string, any>>('prometheus').update({
  main: {
    autoDetect: false,
    isMetricsEnabled: true,
    address: 'monitoring/prometheus-k8s:9090',
  },
});
```

## Reading Distribution Config

When Headlamp is enabled (`utilities.headlamp.type` is `token-auth` or `sso`, so only on
OnPremises and Immutable), the distribution phase renders the `headlamp/sd-spec`
ConfigMap (template `templates/distribution/manifests/utilities/resources/sd-spec.yml.tpl`
in the distribution repository). Its `info.json` key holds only non-sensitive fields:

```json
{
  "distributionVersion": "v1.36.0",
  "cluster": { "name": "my-cluster", "kind": "OnPremises" },
  "moduleVersions": { "monitoring": "v4.3.0", "opa": "v1.18.0", "...": "..." },
  "modules": {
    "auth": { "provider": { "type": "sso" } },
    "ingress": { "nginx": { "type": "dual" }, "haproxy": { "type": "none" } },
    "logging": { "type": "opensearch", "opensearch": { "type": "triple" } },
    "utilities": { "headlamp": { "type": "sso" } }
  }
}
```

`moduleVersions` comes from `kfd.yaml`, which furyctl exposes to the templates as `.kfd`. With
a furyctl version that does not provide `.kfd`, `moduleVersions` is empty.

Do **not** read the `furyctl-config` / `furyctl-kfd` secrets: they contain the whole
`furyctl.yaml`, which can include credentials. If a plugin needs a new field, add it explicitly
to the distribution template.

Copy `src/sdSpec.ts` from `sd-core` (it must stay identical in every plugin, checked by
`mise run plugins-check-shared`) and read it with `useGet`:

```typescript
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import {
  getModuleValue,
  SD_SPEC_CONFIGMAP_NAME,
  SD_SPEC_CONFIGMAP_NAMESPACE,
  toSdSpecResult,
} from './sdSpec';

export function useMonitoringType(): { monitoringType: string; loading: boolean } {
  const [configMap, error] = K8s.ResourceClasses.ConfigMap.useGet(
    SD_SPEC_CONFIGMAP_NAME,
    SD_SPEC_CONFIGMAP_NAMESPACE
  );
  const { spec, loading } = toSdSpecResult(configMap, error);

  return { monitoringType: getModuleValue(spec, 'monitoring.type'), loading };
}
```

## Querying Prometheus

Use the K8s API service proxy. RBAC is already configured for Capsule users (`sd-prometheus-proxy` ClusterRole).

```typescript
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';

const PROM_PREFIX = 'monitoring/services/prometheus-k8s:9090';

const response = await ApiProxy.request(
  `/api/v1/namespaces/${PROM_PREFIX}/proxy/api/v1/query?query=up`,
  { method: 'GET', isJSON: false }
);
const data = await response.json();
// data.data.result = [{ metric: {...}, value: [timestamp, "value"] }]
```

**Example:** sd-certificates queries `x509_cert_not_after`, sd-alerts queries `/api/v1/rules?type=alert`.

## Querying Loki

Same pattern as Prometheus but different service. RBAC via `sd-loki-proxy` ClusterRole.

```typescript
const LOKI_PREFIX = 'logging/services/loki-stack:3100';

const response = await ApiProxy.request(
  `/api/v1/namespaces/${LOKI_PREFIX}/proxy/loki/api/v1/query_range?query={flow="events"}&limit=100&...`,
  { method: 'GET', isJSON: false }
);
```

**Example:** sd-events queries Loki for K8s events stored by the event-tailer.

## Reading Ingress for Service Links

Capsule Proxy blocks `list` of namespaced resources outside the tenant, but allows `get` by name. Use `useGet` for each known ingress:

```typescript
// With SSO (Pomerium): ingresses are in 'pomerium' namespace
const [grafanaSso] = K8s.ResourceClasses.Ingress.useGet('grafana', 'pomerium');
// Without SSO: ingresses are in module namespace
const [grafanaNoSso] = K8s.ResourceClasses.Ingress.useGet('grafana', 'monitoring');

// Extract host
const host = ingress?.jsonData?.spec?.rules?.[0]?.host;
const url = host ? `https://${host}` : '';
```

**Example:** sd-core reads all distribution ingresses to show service links. sd-alerts reads the Prometheus ingress to build "View in Prometheus" links.

## Build and Deploy

```bash
# Type check
npm run tsc

# Lint (must pass with 0 warnings)
npm run lint

# Build (creates dist/main.js)
npm run build
```

After building, add the plugin to the `Dockerfile`:
```dockerfile
COPY plugins/sd-example/dist/main.js /headlamp/plugins/sd-example/main.js
COPY plugins/sd-example/package.json /headlamp/plugins/sd-example/package.json
```

Tilt watches `plugins/*/dist/` and `plugins/*/package.json` (ignores node_modules, src, etc.) and rebuilds automatically.

## Adding RBAC for Capsule Users

If your plugin needs to access resources outside the tenant (services/proxy, secrets, ingresses), add RBAC to `dev/kind/plugins/kustomize/capsule-rbac/rbac.yaml`:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: sd-my-proxy
rules:
  - apiGroups: [""]
    resources: ["services/proxy"]
    resourceNames: ["my-service", "my-service:8080"]  # include the port!
    verbs: ["get", "create"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: sd-my-proxy
subjects:
  - kind: Group
    name: capsule.clastix.io
    apiGroup: rbac.authorization.k8s.io
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: sd-my-proxy
```

Then apply: `mise run furyctl-apply`

## Lessons Learned and Workarounds

### Capsule Proxy and Resource Access
- **`get` works, `list` doesn't** for namespaced resources outside the tenant. Use `useGet(name, namespace)` instead of `useList()` when accessing infrastructure resources (ingresses, services).
- **`services/proxy` resourceNames must include the port**: `["loki-stack", "loki-stack:3100"]`. The K8s API uses the port-suffixed name in the URL path.
- **Namespace may not exist**: Don't use `Role` in namespaces that might not exist (e.g., `logging` when logging is disabled). Use `ClusterRole` instead.

### Headlamp Table Component
- The `Table` from `CommonComponents` uses Material React Table (MRT) internally.
- `filterVariant: 'multi-select'` requires `accessorKey` (string), not `accessorFn`. But in practice it's unreliable — **use custom filter dropdowns** (MUI Select/Autocomplete) above the table instead.
- Column definitions: use `header` + `accessorFn` for display. `accessorKey` for filtering.
- `enableColumnFilters={false}` removes the "Show filters" button.

### Headlamp Overview Page
- `registerOverviewChartsProcessor` puts components in a 300px grid — not suitable for full-width sections.
- To add full-width content to the cluster landing, override the route `/` with `registerRoute` and render your own page (like sd-core does).

### MUI Grid Versions
- Some plugins get MUI Grid v1 (`item xs={6}`), others get v2 (`size={6}`). This depends on the headlamp-plugin version installed.
- **Safe alternative**: Use `Box display="flex" gap={2}` with `Box flex={1}` for equal-width cards.

### Loki Log Parsing
- Loki events from the distribution's event-tailer have **double JSON encoding**: the log entry has a `message` field containing a stringified JSON with the actual K8s event.
- Parse sequence: `JSON.parse(logLine)` → `JSON.parse(entry.message)` → `event.involvedObject`, etc.

### Prometheus Plugin Configuration
- The built-in Prometheus plugin's `address` format is `namespace/service:port` (e.g., `monitoring/prometheus-k8s:9090`). The plugin adds `services/` automatically — don't include it in the address.
- Auto-detect doesn't work with Capsule (requires `list` pods/services). Use `ConfigStore('prometheus').update()` to pre-configure.

### Prometheus Alerts vs Rules
- `/api/v1/alerts` returns flat alerts without the rule group name.
- `/api/v1/rules?type=alert` returns alerts grouped by rule group — use this for categorized alert views.

### Internal APIs Not Available to Plugins
- `useNamespaces` from `@kinvolk/headlamp-plugin/lib/redux/filterSlice` is not exported. Use `K8s.ResourceClasses.Namespace.useList()` instead.

## References

- [Headlamp Plugin API](https://headlamp.dev/docs/latest/development/api/) — official API reference
- [Headlamp Plugin Guide](https://headlamp.dev/docs/latest/development/plugins/) — getting started
- Example plugins: `node_modules/@kinvolk/headlamp-plugin/examples/`
- Official plugins: `node_modules/@kinvolk/headlamp-plugin/official-plugins/`
