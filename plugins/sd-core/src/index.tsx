import { registerAppBarAction, registerRoute } from '@kinvolk/headlamp-plugin/lib';
import ClusterLanding from './ClusterLanding';
import PomeriumLogout from './PomeriumLogout';

// Override the default cluster overview with our landing page
registerRoute({
  path: '/',
  sidebar: 'cluster',
  name: 'cluster',
  exact: true,
  component: ClusterLanding,
});

// Custom logout button for Pomerium SSO (hides the default one that doesn't work behind SSO)
registerAppBarAction(PomeriumLogout);
