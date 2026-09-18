import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthenticatedUser {
  id: string;
  identifier: string;
  roleId: string;
  roleName: string;
  permissions: { resource: string; action: string }[];
  /** Present for hospital-staff tokens; absent for platform tokens. */
  hospitalId?: string;
  /** Discriminates a hospital-staff token from a global Super Admin (platform) token. */
  type: 'hospital' | 'platform';
}

export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser;

    return data ? user?.[data] : user;
  },
);
