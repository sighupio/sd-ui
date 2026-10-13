import { registerRoute, registerSidebarEntry } from '@kinvolk/headlamp-plugin/lib';
import CertificatesPage from './CertificatesPage';

registerSidebarEntry({
  parent: null,
  name: 'sd-certificates',
  label: 'SD Certificates',
  url: '/sd/certificates',
  icon: 'mdi:certificate',
});

registerRoute({
  path: '/sd/certificates',
  sidebar: 'sd-certificates',
  name: 'sd-certificates',
  exact: true,
  component: CertificatesPage,
});
