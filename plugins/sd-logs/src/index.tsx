import { registerRoute, registerSidebarEntry } from '@kinvolk/headlamp-plugin/lib';
import LogsPage from './LogsPage';

registerSidebarEntry({
  parent: null,
  name: 'sd-logs',
  label: 'SD Logs',
  url: '/sd/logs',
  icon: 'mdi:text-box-search-outline',
});

registerRoute({
  path: '/sd/logs',
  sidebar: 'sd-logs',
  name: 'sd-logs',
  exact: true,
  component: LogsPage,
});
