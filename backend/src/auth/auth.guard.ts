import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC, ROLES, Role } from './auth.types';
import { TokensService } from './tokens.service';

/**
 * Global guard: every route needs a valid access token unless it is marked @Public(), and a route marked
 * @Roles(...) additionally needs one of those roles. Forgetting a decorator therefore fails closed.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly tokens: TokensService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers?.authorization;
    const match = header ? /^Bearer (.+)$/i.exec(header) : null;
    if (!match) throw new UnauthorizedException('missing bearer token');
    const principal = this.tokens.verifyAccess(match[1]);
    req.principal = principal;

    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES, targets);
    if (roles && !roles.includes(principal.role)) throw new ForbiddenException('you do not have access to this');
    return true;
  }
}
