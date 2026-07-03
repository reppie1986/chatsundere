// SPDX-License-Identifier: AGPL-3.0-only

import { getLinkedAccount, getLocalAccount } from '@chatsundere/crypto';
import {
  type OnboardingResolvedState,
  parseInvitationUrlIntent,
  resolveOnboardingState,
} from '@chatsundere/shared-types';
import { useSessionStore } from '@chatsundere/ui-shared';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getDb } from '../../boot/open-db.js';
import { env } from '../../env.js';
import { fetchSetupStatus } from '../../lib/setup-status.js';
import { useOnboardingStore } from '../../state/onboarding.store.js';

type Screen =
  | { kind: 'loading' }
  | { kind: 'ready'; state: OnboardingResolvedState; serverReachable: boolean };

export function OnboardingMatrix() {
  const navigate = useNavigate();
  const session = useSessionStore((s) => s.session);
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' });

  useEffect(() => useOnboardingStore.getState().reset(), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const configuredBaseUrl = env.VITE_AUTH_URL ?? null;
      const intent = parseInvitationUrlIntent(window.location.href, configuredBaseUrl);
      if (intent.kind === 'invitation' && intent.base_url) {
        useOnboardingStore.getState().setState({
          kind: 'invitation_input',
          baseUrl: intent.base_url,
          code: intent.code,
        });
        navigate('/onboarding/invitation/confirm', { replace: true });
        return;
      }
      if (intent.kind === 'invitation') {
        useOnboardingStore.getState().setState({
          kind: 'invitation_input',
          baseUrl: '',
          code: intent.code,
        });
        navigate('/onboarding/invitation', { replace: true });
        return;
      }

      const [localAccount, linkedAccount, setupResult] = await Promise.all([
        getLocalAccount(getDb()),
        getLinkedAccount(getDb()),
        configuredBaseUrl ? reflect(fetchSetupStatus(configuredBaseUrl)) : Promise.resolve(null),
      ]);
      if (cancelled) return;

      const setupStatus = setupResult?.ok ? setupResult.value : null;
      const resolved = resolveOnboardingState({
        urlIntent: intent,
        setupStatus,
        hasLocalAccount: !!localAccount,
        linkedAccount,
        hasSession: !!session,
      });

      if (resolved.kind === 'signed_in') {
        navigate('/app', { replace: true });
        return;
      }
      if (resolved.kind === 'account_linked') {
        navigate('/login', { replace: true });
        return;
      }

      setScreen({
        kind: 'ready',
        state: resolved,
        serverReachable: setupResult === null || setupResult.ok,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate, session]);

  if (screen.kind === 'loading') {
    return <p className="mt-12 text-center text-paper-soft">Loading...</p>;
  }

  return <OnboardingEntry state={screen.state} serverReachable={screen.serverReachable} />;
}

function OnboardingEntry(props: { state: OnboardingResolvedState; serverReachable: boolean }) {
  const setupAvailable = props.state.kind === 'server_has_no_owner';
  const serverName =
    props.state.kind === 'server_has_no_owner' || props.state.kind === 'signed_out'
      ? props.state.server_display_name
      : null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-6 py-8">
      <p className="font-mono text-xs uppercase tracking-widest text-paper-soft">
        {serverName ?? 'Chatsundere'}
      </p>
      <h1 className="mt-2 font-display text-4xl italic">
        {setupAvailable ? 'Set up this server' : 'Welcome'}
      </h1>
      <p className="mt-2 text-sm text-paper-soft">
        {entryCopy(props.state, props.serverReachable)}
      </p>

      <div className="mt-8 space-y-3">
        {setupAvailable && <PrimaryLink to="/onboarding/setup">Set up this server</PrimaryLink>}
        {!setupAvailable && (
          <PrimaryLink to="/onboarding/recovery">Sign in to existing account</PrimaryLink>
        )}
        <SecondaryLink to="/onboarding/invitation">Use invitation</SecondaryLink>
        <SecondaryLink to="/onboarding/local">Continue local-only</SecondaryLink>
      </div>
    </main>
  );
}

function entryCopy(state: OnboardingResolvedState, serverReachable: boolean): string {
  if (!serverReachable) {
    return 'The configured HTTPS server is unreachable. You can retry, use an invitation, or continue local-only.';
  }
  if (state.kind === 'server_has_no_owner') {
    return 'No owner exists yet. Create the first primary admin before inviting anyone else.';
  }
  if (state.kind === 'recovery_required') {
    return 'This browser has partial account state. Use recovery sign-in to restore a complete linked account.';
  }
  return 'Connect to your server account, redeem an invitation, or explicitly stay local-only.';
}

function PrimaryLink(props: { to: string; children: ReactNode }) {
  return (
    <Link
      to={props.to}
      className="block w-full rounded-[var(--radius-card)] bg-aurora-700 px-4 py-3 text-center text-sm font-medium text-paper transition-opacity hover:opacity-90"
    >
      {props.children}
    </Link>
  );
}

function SecondaryLink(props: { to: string; children: ReactNode }) {
  return (
    <Link
      to={props.to}
      className="block w-full rounded-[var(--radius-card)] border border-aurora-700/50 px-4 py-3 text-center text-sm font-medium text-paper transition-opacity hover:opacity-90"
    >
      {props.children}
    </Link>
  );
}

interface ReflectOk<T> {
  ok: true;
  value: T;
}

interface ReflectErr {
  ok: false;
}

async function reflect<T>(promise: Promise<T>): Promise<ReflectOk<T> | ReflectErr> {
  try {
    return { ok: true, value: await promise };
  } catch {
    return { ok: false };
  }
}
