import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '../decorators/current-user.decorator';

/**
 * Restricts a controller to the global Super Admin (a PlatformUser,
 * authenticated via the platform JWT). Applied at the controller level for
 * platform-management endpoints (hospital onboarding, etc.) that no
 * hospital-staff token -- regardless of role or permissions -- should ever
 * reach.
 */
@Injectable()
export class PlatformOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser | undefined;

    if (!user || user.type !== 'platform') {
      throw new ForbiddenException('This endpoint is restricted to the platform Super Admin.');
    }
    return true;
  }
}
