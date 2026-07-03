// SPDX-License-Identifier: MIT

export interface SetupStatusResponse {
  owner_exists: boolean;
  setup_available: boolean;
  server_display_name: string | null;
}

export interface OwnerSetupStartRequest {
  server_display_name: string;
  registration_request: string;
}

export interface OwnerSetupStartResponse {
  session_id: string;
  registration_response: string;
}

export interface OwnerSetupFinishRequest {
  session_id: string;
  username: string;
  registration_record: string;
  wrapped_mk_opaque: string;
  wrap_nonce_opaque: string;
  wrap_aad_opaque: string;
  wrapped_mk_recovery: string;
  wrap_nonce_recovery: string;
  wrap_aad_recovery: string;
  recovery_verifier_key: string;
}

export interface OwnerSetupFinishResponse {
  user_id: string;
  username: string;
  role: 'primary_admin';
  access_token: string;
  expires_in: number;
  is_new_account: true;
}
