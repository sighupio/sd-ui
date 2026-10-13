import { registerRoute, registerSidebarEntry } from '@kinvolk/headlamp-plugin/lib';
import PolicyPage from './PolicyPage';

registerSidebarEntry({
  parent: null,
  name: 'sd-policy',
  label: 'SD Policy',
  url: '/sd/policy',
  icon: 'mdi:police-badge',
});

registerRoute({
  path: '/sd/policy',
  sidebar: 'sd-policy',
  name: 'sd-policy',
  exact: true,
  component: PolicyPage,
});
