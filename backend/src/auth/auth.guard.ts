import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import Redis from 'ioredis';
import { REDIS } from '../common/infra.module';
import { IS_PUBLIC, ROLES, Role } from './auth.types';
import { TokensService } from './tokens.service';

export const suspendedKey = (userId: string) => `suspended:${userId}`;

/**
 * Global guard: every route needs a valid access token unless it is marked @Public(), and a route marked
 * @Roles(...) additionally needs one of those roles. Forgetting a decorator therefore fails closed.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers?.authorization;
    const match = header ? /^Bearer (.+)$/i.exec(header) : null;
    if (!match) throw new UnauthorizedException('missing bearer token');
    const principal = this.tokens.verifyAccess(match[1]);
    // A suspended account is stopped at once, even though its access token is still valid for a few minutes.
    if (principal.kind === 'user' && (await this.redis.exists(suspendedKey(principal.id)))) {
      throw new ForbiddenException('this account is suspended');
    }
    req.principal = principal;

    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES, targets);
    if (roles && !roles.includes(principal.role)) throw new ForbiddenException('you do not have access to this');
    return true;
  }
}
