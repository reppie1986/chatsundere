// SPDX-License-Identifier: AGPL-3.0-only

import {
  CryptoError,
  finishFirstOwnerSetup,
  setBiometricPromptDue,
  startFirstOwnerSetup,
} from '@chatsundere/crypto';
import { useConnectivityStore, useSessionStore } from '@chatsundere/ui-shared';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getDb } from '../../boot/open-db.js';
import { PassphraseField } from '../../components/PassphraseField.js';
import { env } from '../../env.js';
import { HttpError } from '../../lib/fetch.js';
import { httpServerClient } from '../../lib/server-client.js';
import { useOnboardingStore } from '../../state/onboarding.store.js';

type Screen = { kind: 'ready' } | { kind: 'submitting' } | { kind: 'fatal'; message: string };

export function ServerSetup() {
  const navigate = useNavigate();
  const setOnboardingState = useOnboardingStore((s) => s.setState);
  const [serverDisplayName, setServerDisplayName] = useState('Chatsundere');
  const [username, setUsername] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [passphraseError, setPassphraseError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>({ kind: 'ready' });

  const baseUrl = env.VITE_AUTH_URL;

  async function handleSubmit() {
    setUsernameError(null);
    setPassphraseError(null);
    if (!baseUrl) {
      setScreen({ kind: 'fatal', message: 'No server URL is configured for this build.' });
      return;
    }
    if (username.trim().length === 0) {
      setUsernameError('Pick a username.');
      return;
    }
    if (passphrase.length === 0) {
      setPassphraseError('Enter a password.');
      return;
    }

    setScreen({ kind: 'submitting' });
    try {
      const setupState = await startFirstOwnerSetup({
        serverClient: httpServerClient,
        baseUrl,
        serverDisplayName: serverDisplayName.trim() || 'Chatsundere',
        passphrase,
      });
      const result = await finishFirstOwnerSetup({
        db: getDb(),
        serverClient: httpServerClient,
        baseUrl,
        setupState,
        username,
        passphrase,
      });

      useConnectivityStore.getState().onServerOk();
      useSessionStore.getState().setSession(result.session, result.mk);
      setOnboardingState({
        kind: 'setup_recovery',
        userId: result.session.userId,
        username: result.session.username,
        recoveryKeyString: result.recoveryKeyString,
      });
      await setBiometricPromptDue(getDb());
      navigate('/onboarding/setup/recovery', { replace: true });
    } catch (err) {
      const mapped = mapSetupError(err);
      if (mapped.kind === 'username') {
        setUsernameError(mapped.message);
        setScreen({ kind: 'ready' });
        return;
      }
      if (mapped.kind === 'passphrase') {
        setPassphraseError(mapped.message);
        setScreen({ kind: 'ready' });
        return;
      }
      setScreen({ kind: 'fatal', message: mapped.message });
    }
  }

  if (screen.kind === 'fatal') {
    return (
      <main className="mx-auto min-h-dvh w-full max-w-sm px-6 py-6">
        <Link to="/onboarding" className="text-2xl text-paper-soft" aria-label="Back">
          {'<-'}
        </Link>
        <p className="mt-6 rounded-[var(--radius-card)] bg-danger/10 px-4 py-3 text-sm text-danger ring-1 ring-inset ring-danger/30">
          {screen.message}
        </p>
      </main>
    );
  }

  const submitting = screen.kind === 'submitting';

  return (
    <main className="mx-auto min-h-dvh w-full max-w-sm px-6 py-6">
      <Link to="/onboarding" className="text-2xl text-paper-soft" aria-label="Back">
        {'<-'}
      </Link>
      <h1 className="mt-4 font-display text-3xl italic">Set up this server</h1>
      <p className="mt-1 text-sm text-paper-soft">
        Create the first primary admin. Your password stays inside the OPAQUE flow.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit();
        }}
        className="mt-6 space-y-4"
      >
        <Field
          id="server-display-name"
          label="Server display name"
          value={serverDisplayName}
          onChange={setServerDisplayName}
          autoComplete="organization"
        />
        <Field
          id="owner-username"
          label="Owner username"
          value={username}
          onChange={(next) => {
            setUsername(next);
            setUsernameError(null);
          }}
          autoComplete="username"
          error={usernameError}
        />
        <div>
          <PassphraseField
            id="owner-passphrase"
            label="Password"
            value={passphrase}
            onChange={(next) => {
              setPassphrase(next);
              setPassphraseError(null);
            }}
            autoComplete="new-password"
          />
          {passphraseError && (
            <p role="alert" className="mt-1 text-sm text-danger">
              {passphraseError}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-[var(--radius-card)] bg-aurora-700 px-4 py-3 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? 'Setting up...' : 'Create primary admin'}
        </button>
      </form>
    </main>
  );
}

function Field(props: {
  id: string;
  label: string;
  value: string;
  onChange(value: string): void;
  autoComplete?: string;
  error?: string | null;
}) {
  return (
    <div>
      <label
        htmlFor={props.id}
        className="block text-xs font-medium uppercase tracking-wider text-paper-soft"
      >
        {props.label}
      </label>
      <input
        id={props.id}
        type="text"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        autoComplete={props.autoComplete}
        spellCheck={false}
        className="mt-1 w-full rounded-[var(--radius-input)] bg-ink-soft px-3 py-2 font-mono ring-1 ring-inset ring-aurora-700/30 focus:outline-none focus:ring-aurora-500"
      />
      {props.error && (
        <p role="alert" className="mt-1 text-sm text-danger">
          {props.error}
        </p>
      )}
    </div>
  );
}

function mapSetupError(
  err: unknown,
):
  | { kind: 'username'; message: string }
  | { kind: 'passphrase'; message: string }
  | { kind: 'fatal'; message: string } {
  if (err instanceof CryptoError) {
    if (err.code === 'invalid_input') {
      return {
        kind: 'username',
        message: 'Use 3-32 lowercase letters, numbers, underscores, or hyphens.',
      };
    }
    if (err.code === 'conflict') {
      return { kind: 'username', message: 'This username is already taken.' };
    }
  }
  if (err instanceof HttpError) {
    if (err.code === 'setup_unavailable') {
      return { kind: 'fatal', message: 'This server already has an owner. Use an invitation.' };
    }
    if (err.code === 'username_taken') {
      return { kind: 'username', message: 'This username is already taken.' };
    }
    if (err.status >= 500 || err.status === 0) {
      return { kind: 'fatal', message: 'Server unreachable. Check the HTTPS server URL.' };
    }
  }
  return { kind: 'fatal', message: 'Setup failed. Please try again.' };
}
