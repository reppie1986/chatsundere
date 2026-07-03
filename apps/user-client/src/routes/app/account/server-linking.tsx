// SPDX-License-Identifier: AGPL-3.0-only

import { getLinkedAccount } from '@chatsundere/crypto';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDb } from '../../../boot/open-db.js';
import { Badge } from '../../../components/ui/Badge.js';
import { Button } from '../../../components/ui/Button.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { useHelp } from '../../../content/help/use-help.js';

/**
 * Server linking sub-page (`/app/account/server-linking`). Shows the persisted
 * linked-account status and offers the invitation wizard as the explicit link
 * path when this browser is still local-only.
 */
export function ServerLinkingPage(): JSX.Element {
  const { onHelp, helpOverlay } = useHelp('server-linking');
  const navigate = useNavigate();
  const [linked, setLinked] = useState<{ baseUrl: string; role: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getLinkedAccount(getDb()).then((row) => {
      if (!cancelled) setLinked(row ? { baseUrl: row.base_url, role: row.role } : null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const statusLabel = linked ? `Linked to ${linked.baseUrl}` : 'Local-only mode';
  const statusTone = linked ? 'success' : 'neutral';

  return (
    <PageScaffold
      back="/app/account"
      crumbs={[{ label: 'My Account', to: '/app/account' }, { label: 'Server linking' }]}
      onHelp={onHelp}
    >
      {helpOverlay}

      <div className="space-y-6 px-4 pb-8 pt-2">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-widest text-paper-soft">Status</p>
          <Badge tone={statusTone}>{statusLabel}</Badge>
        </div>

        <p className="text-[11px] text-paper-soft">
          {linked
            ? `This device is linked as ${linked.role}. Future sync uses this server identity.`
            : 'Link this device to a server for cross-device identity. Local-only remains available when chosen explicitly.'}
        </p>

        <Button
          tone="primary"
          onClick={() => navigate('/onboarding/invitation?return=/app/account/server-linking')}
        >
          Link to server
        </Button>
      </div>
    </PageScaffold>
  );
}
