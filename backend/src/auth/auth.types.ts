import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';

export type Role = 'rider' | 'driver' | 'support' | 'finance' | 'admin';

/** Who is calling. Always taken from the verified token, never from the request body or URL. */
export interface Principal {
  id: string;
  kind: 'user' | 'staff';
  role: Role;
}

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';

/** Opt a route OUT of authentication. Everything else requires a valid access token. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Restrict a route (or a whole controller) to these roles. Without it, any signed-in caller may use the route. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): Principal => {
  return ctx.switchToHttp().getRequest().principal;
});

/** Sends the one-time code. Real SMS/voice providers plug in here. */
export interface OtpSender {
  send(phone: string, code: string, channel: 'sms' | 'voice'): Promise<void>;
}
export const OTP_SENDER = Symbol('OTP_SENDER');

export const ACCESS_TOKEN_SECONDS = Number(process.env.ACCESS_TOKEN_SECONDS ?? 900);
export const USER_REFRESH_SECONDS = Number(process.env.USER_REFRESH_SECONDS ?? 30 * 86400);
export const STAFF_REFRESH_SECONDS = Number(process.env.STAFF_REFRESH_SECONDS ?? 12 * 3600);
export const OTP_TTL_SECONDS = 300;
export const OTP_MAX_ATTEMPTS = 5;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}
