/** Single-branch business: Super Admin, Admin (operations), Booking Staff (counter), Accountant. */
export const ROLES = ['SUPER_ADMIN', 'ADMIN', 'BOOKING_STAFF', 'ACCOUNTANT', 'CUSTOMER'] as const;
export type Role = (typeof ROLES)[number];

/** Roles that see every branch. Everyone else is restricted to their own branch. */
export const GLOBAL_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'];
/** Roles allowed to see partner name, partner AWB, partner cost and margin. */
export const INTERNAL_COST_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'];
export const STAFF_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN', 'BOOKING_STAFF', 'ACCOUNTANT'];

export interface AuthUser { id: string; email: string; name: string; role: Role; branchId: string | null }

/** Returns the branch filter to apply, or null for unrestricted. Throws if a scoped user has no branch. */
export function branchScope(user: AuthUser): string | null {
  if (GLOBAL_ROLES.includes(user.role)) return null;
  if (!user.branchId) throw new Error('Branch-scoped user has no branch assigned');
  return user.branchId;
}
