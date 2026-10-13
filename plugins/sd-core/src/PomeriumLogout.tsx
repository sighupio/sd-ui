import { Icon } from '@iconify/react';
import { IconButton, Tooltip } from '@mui/material';
import React, { useEffect } from 'react';
import { useKfdData } from './hooks';
import { buildSignOutUrl } from './pomeriumSignOut';

function hideDefaultLogout() {
  document.querySelectorAll('[role="menuitem"]').forEach(el => {
    if (el.textContent?.trim() === 'Log out') {
      (el as HTMLElement).style.display = 'none';
    }
  });
}

export default function PomeriumLogout() {
  const { isSso, isSdCluster } = useKfdData();

  useEffect(() => {
    if (!isSso) return;

    // Hide the default logout menu item whenever the user menu opens
    const observer = new MutationObserver(() => hideDefaultLogout());
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, [isSso]);

  if (!isSdCluster || !isSso) return null;

  return (
    <Tooltip title="Sign out">
      <IconButton
        color="inherit"
        onClick={() => {
          window.location.href = buildSignOutUrl(window.location.origin);
        }}
        aria-label="Sign out"
      >
        <Icon icon="mdi:logout" width={22} height={22} />
      </IconButton>
    </Tooltip>
  );
}
