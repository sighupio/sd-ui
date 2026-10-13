import { registerRoute, registerSidebarEntry } from '@kinvolk/headlamp-plugin/lib';
import AlertsPage from './AlertsPage';

registerSidebarEntry({
  parent: null,
  name: 'sd-alerts',
  label: 'SD Alerts',
  url: '/sd/alerts',
  icon: 'mdi:bell-alert',
});

registerRoute({
  path: '/sd/alerts',
  sidebar: 'sd-alerts',
  name: 'sd-alerts',
  exact: true,
  component: AlertsPage,
});
