// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOnboardingStore } from '../../state/onboarding.store.js';
import { StepRecoveryReveal } from './local/step-recovery-reveal.js';

export function SetupRecoveryReveal() {
  const navigate = useNavigate();
  const state = useOnboardingStore((s) => s.state);

  useEffect(() => {
    if (state.kind !== 'setup_recovery') navigate('/onboarding', { replace: true });
  }, [state.kind, navigate]);

  if (state.kind !== 'setup_recovery') return null;

  return (
    <main className="mx-auto min-h-dvh w-full max-w-sm px-6 py-6">
      <StepRecoveryReveal
        recoveryKey={state.recoveryKeyString}
        onDone={() => {
          useOnboardingStore.getState().reset();
          navigate('/app', { replace: true });
        }}
      />
    </main>
  );
}
