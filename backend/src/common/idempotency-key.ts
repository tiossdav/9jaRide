import { BadRequestException, ExecutionContext, createParamDecorator } from '@nestjs/common';

/**
 * The client generates one key per user action and re-sends it on every retry (spec: a flaky network must never
 * create a second ride, payout or SOS). Required on every route that creates something.
 */
export const IdempotencyKey = createParamDecorator((_d: unknown, ctx: ExecutionContext): string => {
  const raw = ctx.switchToHttp().getRequest().headers['idempotency-key'];
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (typeof key !== 'string' || !/^[A-Za-z0-9_.:-]{8,100}$/.test(key)) {
    throw new BadRequestException('Idempotency-Key header is required (8 to 100 letters, digits, - _ . :)');
  }
  return key;
});
