// SPDX-License-Identifier: AGPL-3.0-only
import { HttpError, apiFetch } from '../lib/fetch.js';
import type {
  AdminApi,
  AuditEvent,
  AuditListQuery,
  CreateInvitationInput,
  DashboardSummary,
  InvitationCreated,
  InvitationListQuery,
  InvitationSummary,
  Paged,
  UserDetail,
  UserListQuery,
  UserSummary,
} from './admin-api.js';

function notImplemented(): never {
  throw new HttpError(501, 'not_implemented', 'admin endpoint not yet implemented');
}

/** Live admin API against the running auth-service. */
export class LiveAdminApi implements AdminApi {
  constructor(private readonly baseUrl: string) {}

  async listUsers(_q: UserListQuery): Promise<Paged<UserSummary>> {
    return notImplemented();
  }
  async getUser(_id: string): Promise<UserDetail> {
    return notImplemented();
  }
  async suspendUser(_id: string): Promise<void> {
    return notImplemented();
  }
  async unsuspendUser(_id: string): Promise<void> {
    return notImplemented();
  }
  async deleteUser(_id: string): Promise<void> {
    return notImplemented();
  }
  async changeRole(_id: string, _role: 'user' | 'admin'): Promise<void> {
    return notImplemented();
  }
  async transferPrimary(_id: string): Promise<void> {
    return notImplemented();
  }
  async listInvitations(_q: InvitationListQuery): Promise<Paged<InvitationSummary>> {
    const params = new URLSearchParams();
    if (_q.status && _q.status !== 'all') params.set('status', _q.status);
    const page = _q.page ?? 1;
    const perPage = _q.per_page ?? 20;
    params.set('limit', String(perPage));
    params.set('offset', String((page - 1) * perPage));
    const response = await apiFetch<LiveInvitationListResponse>({
      baseUrl: this.baseUrl,
      path: `/api/v1/admin/invitations?${params.toString()}`,
      authMode: 'bearer',
    });
    return {
      items: response.invitations.map(mapInvitation),
      total: response.total,
      page,
      per_page: perPage,
    };
  }
  async createInvitation(input: CreateInvitationInput): Promise<InvitationCreated> {
    if (input.role === 'primary_admin') {
      throw new HttpError(400, 'invalid_input', 'primary admin invitations are not supported');
    }
    const response = await apiFetch<LiveInvitationCreateResponse>({
      baseUrl: this.baseUrl,
      path: '/api/v1/admin/invitations',
      authMode: 'bearer',
      json: {
        role: input.role,
        expires_in_seconds: input.expires_in_days * 24 * 60 * 60,
        issuer_label: input.issuer_label,
        suggested_username: input.suggested_username,
        note: input.note,
      },
    });
    return {
      id: response.invitation_id,
      role: input.role,
      status: 'pending',
      redeemed_by: null,
      created_at: new Date().toISOString(),
      expires_at: response.expires_at,
      issuer_label: input.issuer_label ?? null,
      suggested_username: input.suggested_username ?? null,
      note: input.note ?? null,
      qr_payload: response.qr_url,
      url: response.qr_url,
    };
  }
  async revokeInvitation(id: string): Promise<void> {
    await apiFetch<void>({
      baseUrl: this.baseUrl,
      path: `/api/v1/admin/invitations/${encodeURIComponent(id)}`,
      method: 'DELETE',
      authMode: 'bearer',
    });
  }
  async listAudit(_q: AuditListQuery): Promise<Paged<AuditEvent>> {
    return notImplemented();
  }
  async getDashboardSummary(): Promise<DashboardSummary> {
    return notImplemented();
  }
}

interface LiveInvitation {
  id: string;
  role: 'admin' | 'user';
  issuer_label: string | null;
  suggested_username: string | null;
  note: string | null;
  created_at: string;
  expires_at: string;
  redeemed_by_user_id: string | null;
  status: 'pending' | 'redeemed' | 'expired' | 'revoked';
}

interface LiveInvitationListResponse {
  invitations: LiveInvitation[];
  total: number;
}

interface LiveInvitationCreateResponse {
  invitation_id: string;
  code: string;
  qr_url: string;
  expires_at: string;
}

function mapInvitation(row: LiveInvitation): InvitationSummary {
  return {
    id: row.id,
    role: row.role,
    status: row.status,
    redeemed_by: row.redeemed_by_user_id,
    created_at: row.created_at,
    expires_at: row.expires_at,
    issuer_label: row.issuer_label,
    suggested_username: row.suggested_username,
    note: row.note,
  };
}
