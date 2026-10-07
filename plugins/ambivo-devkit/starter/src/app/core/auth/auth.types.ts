// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
/** The signed-in person. Field names follow ambivo-nx `AuthUserInterface`. */
export interface AuthUser {
  id: string;
  firstName?: string;
  lastName?: string;
  name: string;
  email: string;
  tenantId?: string;
  isAdmin: boolean;
  /** `module_access` from the API: module name -> privilege letters (C, R, U, D, A). */
  permissions: Record<string, string[] | string>;
}

export type MfaChannel = 'email' | 'sms';

export interface MfaFactor {
  factorId: string;
  type: MfaChannel;
  destinationMasked: string;
}

/**
 * Where a sign-in attempt stands. The screens move through these states:
 * signed-in, or a code to enter, or a method to pick, or a method to set up.
 */
export type SignInStep =
  | { kind: 'signed-in'; user: AuthUser }
  | {
      kind: 'enter-code';
      userId: string;
      challengeId: string;
      factorId?: string;
      channel: MfaChannel;
      destination?: string;
    }
  | { kind: 'choose-method'; preMfaToken: string; factors: MfaFactor[] }
  | { kind: 'set-up-email'; enrollmentToken: string; email?: string }
  | { kind: 'email-codes-only' };

export function mapUser(data: any): AuthUser {
  const first = data?.first_name ?? '';
  const last = data?.last_name ?? '';
  return {
    // /user/data names it userid; the sign-in reply's user names it id.
    id: data?.userid ?? data?.id,
    firstName: first || undefined,
    lastName: last || undefined,
    name: [first, last].filter(Boolean).join(' ') || data?.email || '',
    email: data?.email ?? '',
    tenantId: data?.tenant_id,
    isAdmin: !!data?.is_tenant_admin,
    permissions: data?.module_access ?? {},
  };
}
