import { registerRoute, registerSidebarEntry } from '@kinvolk/headlamp-plugin/lib';
import EventsPage from './EventsPage';

registerSidebarEntry({
  parent: null,
  name: 'sd-events',
  label: 'SD Events',
  url: '/sd/events',
  icon: 'mdi:timeline-clock',
});

registerRoute({
  path: '/sd/events',
  sidebar: 'sd-events',
  name: 'sd-events',
  exact: true,
  component: EventsPage,
});
