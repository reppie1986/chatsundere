// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { copy } from '../../copy.js';
import type { CreateInvitationInput, InvitationCreated } from '../../data/admin-api.js';
import { getAdminApi } from '../../data/index.js';
import { env } from '../../env.js';
import { HttpError } from '../../lib/fetch.js';
import { confirmOpaqueAdminStepUp } from '../../lib/step-up.js';

interface Props {
  onCreated: (inv: InvitationCreated) => void;
  onCancel: () => void;
}

export function InvitationCreateModal({ onCreated, onCancel }: Props) {
  const [role, setRole] = useState<CreateInvitationInput['role']>('user');
  const [expiresIn, setExpiresIn] = useState<1 | 7 | 30>(7);
  const [issuerLabel, setIssuerLabel] = useState('');
  const [suggestedUsername, setSuggestedUsername] = useState('');
  const [note, setNote] = useState('');
  const [stepUpRequired, setStepUpRequired] = useState(false);
  const [stepUpPassphrase, setStepUpPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const api = getAdminApi();

  const create = useMutation({
    mutationFn: (input: CreateInvitationInput) => api.createInvitation(input),
    onSuccess: onCreated,
    onError: (err) => {
      if (err instanceof HttpError && err.code === 'step_up_required') {
        setStepUpRequired(true);
        return;
      }
      setError(mapCreateError(err));
    },
  });

  const buildInput = (): CreateInvitationInput => ({
    role,
    expires_in_days: expiresIn,
    ...(issuerLabel ? { issuer_label: issuerLabel } : {}),
    ...(suggestedUsername ? { suggested_username: suggestedUsername } : {}),
    ...(note ? { note } : {}),
  });

  const submit = () => {
    setError(null);
    create.mutate(buildInput());
  };

  const submitWithStepUp = async () => {
    setError(null);
    try {
      await confirmOpaqueAdminStepUp(env.VITE_AUTH_URL, stepUpPassphrase);
      setStepUpRequired(false);
      create.mutate(buildInput());
    } catch (err) {
      setError(mapCreateError(err));
    }
  };

  return (
    <dialog
      open
      aria-labelledby="create-invitation-title"
      className="space-y-4 rounded-md bg-[var(--color-mantle)] p-6"
    >
      <h2 id="create-invitation-title" className="text-2xl">
        {copy.invitations.modal.title}
      </h2>
      <label className="block text-sm">
        {copy.invitations.modal.role}
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as CreateInvitationInput['role'])}
          className="mt-1 w-full rounded-md border border-[var(--color-overlay-0)] bg-[var(--color-base)] px-3 py-2"
        >
          <option value="user">{copy.invitations.modal.roleOptions.user}</option>
          <option value="admin">{copy.invitations.modal.roleOptions.admin}</option>
        </select>
      </label>
      <label className="block text-sm">
        {copy.invitations.modal.expiresIn}
        <select
          value={expiresIn}
          onChange={(e) => setExpiresIn(Number(e.target.value) as 1 | 7 | 30)}
          className="mt-1 w-full rounded-md border border-[var(--color-overlay-0)] bg-[var(--color-base)] px-3 py-2"
        >
          <option value={1}>{copy.invitations.modal.expiresOptions.day}</option>
          <option value={7}>{copy.invitations.modal.expiresOptions.week}</option>
          <option value={30}>{copy.invitations.modal.expiresOptions.month}</option>
        </select>
      </label>
      <label className="block text-sm">
        {copy.invitations.modal.issuerLabel}
        <input
          value={issuerLabel}
          onChange={(e) => setIssuerLabel(e.target.value)}
          className="mt-1 w-full rounded-md border border-[var(--color-overlay-0)] bg-[var(--color-base)] px-3 py-2"
        />
        <span className="mt-1 block text-xs text-[var(--color-subtext-0)]">
          {copy.invitations.modal.issuerLabelHint}
        </span>
      </label>
      <label className="block text-sm">
        {copy.invitations.modal.suggestedUsername}
        <input
          value={suggestedUsername}
          onChange={(e) => setSuggestedUsername(e.target.value)}
          className="mt-1 w-full rounded-md border border-[var(--color-overlay-0)] bg-[var(--color-base)] px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        {copy.invitations.modal.note}
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className="mt-1 w-full resize-none rounded-md border border-[var(--color-overlay-0)] bg-[var(--color-base)] px-3 py-2"
        />
        <span className="mt-1 block text-xs text-[var(--color-subtext-0)]">
          {copy.invitations.modal.noteHint}
        </span>
      </label>

      {stepUpRequired && (
        <label className="block text-sm">
          Password confirmation
          <input
            type="password"
            value={stepUpPassphrase}
            onChange={(e) => setStepUpPassphrase(e.target.value)}
            className="mt-1 w-full rounded-md border border-[var(--color-overlay-0)] bg-[var(--color-base)] px-3 py-2"
          />
          <span className="mt-1 block text-xs text-[var(--color-subtext-0)]">
            Creating invitations requires a fresh admin step-up.
          </span>
        </label>
      )}

      {error && <p className="text-sm text-[var(--color-red)]">{error}</p>}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-1">
          {copy.invitations.modal.cancel}
        </button>
        <button
          type="button"
          onClick={() => {
            if (stepUpRequired) {
              void submitWithStepUp();
            } else {
              submit();
            }
          }}
          disabled={create.isPending}
          className="rounded-md bg-[var(--color-mauve)] px-3 py-1 text-[var(--color-base)] disabled:opacity-50"
        >
          {stepUpRequired ? 'Confirm and create' : copy.invitations.modal.submit}
        </button>
      </div>
    </dialog>
  );
}

function mapCreateError(err: unknown): string {
  if (err instanceof HttpError) {
    if (err.code === 'opaque_authentication_failed') return 'Password confirmation failed.';
    if (err.code === 'step_up_required') return 'Password confirmation is required.';
    if (err.status === 401) return 'Your admin session expired. Sign in again.';
    if (err.status === 403) return 'This account is not allowed to create invitations.';
    if (err.status >= 500 || err.status === 0) return 'Server unreachable.';
  }
  return 'Could not create invitation.';
}
