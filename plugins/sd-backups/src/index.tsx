import { registerRoute, registerSidebarEntry } from '@kinvolk/headlamp-plugin/lib';
import BackupsPage from './BackupsPage';

registerSidebarEntry({
  parent: null,
  name: 'sd-backups',
  label: 'SD Backups',
  url: '/sd/backups',
  icon: 'mdi:backup-restore',
});

registerRoute({
  path: '/sd/backups',
  sidebar: 'sd-backups',
  name: 'sd-backups',
  exact: true,
  component: BackupsPage,
});
