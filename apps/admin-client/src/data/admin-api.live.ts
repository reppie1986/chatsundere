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

  async listUsers(q: UserListQuery): Promise<Paged<UserSummary>> {
    const params = new URLSearchParams();
    if (q.search) params.set('q', q.search);
    const page = q.page ?? 1;
    const perPage = q.per_page ?? 20;
    params.set('limit', String(perPage));
    params.set('offset', String((page - 1) * perPage));
    const response = await apiFetch<LiveUserListResponse>({
      baseUrl: this.baseUrl,
      path: `/api/v1/admin/users?${params.toString()}`,
      authMode: 'bearer',
    });
    const hasRoleFilter = q.role !== undefined && q.role !== 'all';
    const hasStatusFilter = q.status !== undefined && q.status !== 'all';
    let items = response.users.map(mapUserSummary);
    if (hasRoleFilter) items = items.filter((user) => user.role === q.role);
    if (hasStatusFilter) {
      items = items.filter((user) => user.status === q.status);
    }
    return {
      items,
      total: hasRoleFilter || hasStatusFilter ? items.length : response.total,
      page,
      per_page: perPage,
    };
  }

  async getUser(id: string): Promise<UserDetail> {
    const response = await apiFetch<LiveUserDetail>({
      baseUrl: this.baseUrl,
      path: `/api/v1/admin/users/${encodeURIComponent(id)}`,
      authMode: 'bearer',
    });
    return mapUserDetail(response);
  }

  async suspendUser(id: string): Promise<void> {
    await apiFetch<void>({
      baseUrl: this.baseUrl,
      path: `/api/v1/admin/users/${encodeURIComponent(id)}/suspend`,
      authMode: 'bearer',
      json: {},
    });
  }

  async unsuspendUser(id: string): Promise<void> {
    await apiFetch<void>({
      baseUrl: this.baseUrl,
      path: `/api/v1/admin/users/${encodeURIComponent(id)}/unsuspend`,
      authMode: 'bearer',
      json: {},
    });
  }

  async deleteUser(id: string): Promise<void> {
    await apiFetch<void>({
      baseUrl: this.baseUrl,
      path: `/api/v1/admin/users/${encodeURIComponent(id)}`,
      method: 'DELETE',
      authMode: 'bearer',
    });
  }

  async changeRole(id: string, role: 'user' | 'admin'): Promise<void> {
    await apiFetch<void>({
      baseUrl: this.baseUrl,
      path: `/api/v1/admin/users/${encodeURIComponent(id)}/role`,
      authMode: 'bearer',
      json: { role },
    });
  }

  async transferPrimary(id: string): Promise<void> {
    await apiFetch<void>({
      baseUrl: this.baseUrl,
      path: '/api/v1/admin/transfer-primary',
      authMode: 'bearer',
      json: { target_user_id: id },
    });
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
    const [users, invitations] = await Promise.all([
      this.listUsers({ page: 1, per_page: 100 }),
      this.listInvitations({ status: 'pending', page: 1, per_page: 100 }),
    ]);
    return {
      total_users: users.total,
      pending_invitations: invitations.total,
      suspended_users: users.items.filter((user) => user.status === 'suspended').length,
      recent_activity: [],
    };
  }
}

interface LiveUser {
  id: string;
  username: string;
  role: 'primary_admin' | 'admin' | 'user';
  suspended_at: string | null;
  created_at: string;
  last_login_at: string | null;
}

interface LiveUserListResponse {
  users: LiveUser[];
  total: number;
}

interface LiveAuthMethod {
  id: string;
  method_type: 'opaque' | 'passkey';
  label: string;
  created_at: string;
  last_used_at: string | null;
}

interface LiveUserDetail extends LiveUser {
  auth_methods: LiveAuthMethod[];
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

function mapUserSummary(row: LiveUser): UserSummary {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    status: row.suspended_at ? 'suspended' : 'active',
    created_at: row.created_at,
    last_login_at: row.last_login_at,
  };
}

function mapUserDetail(row: LiveUserDetail): UserDetail {
  return {
    ...mapUserSummary(row),
    auth_methods: row.auth_methods.map((method) => ({
      id: method.id,
      label: method.label,
      type: method.method_type === 'opaque' ? 'passphrase' : 'passkey',
      last_used_at: method.last_used_at,
    })),
  };
}
