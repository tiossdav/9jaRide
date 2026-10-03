import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { InsufficientFundsError } from '../ledger/ledger.service';
import { CategoryUnavailableError, NoPricingError, QuoteInvalidError } from '../fare/fare.service';
import { InvalidWebhookSignatureError } from '../payments/payments.service';
import { PayoutStateError, SelfApprovalError } from '../payments/payouts.service';

/** Map domain errors to honest HTTP answers, and never leak internals (stack traces, SQL) on an unexpected failure. */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger('Http');

  catch(e: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    const send = (status: number, code: string, message: string) => res.status(status).json({ statusCode: status, code, message });

    if (e instanceof HttpException) {
      const body = e.getResponse();
      const status = e.getStatus();
      if (typeof body === 'object' && body !== null) return res.status(status).json({ statusCode: status, ...(body as object) });
      return send(status, 'error', String(body));
    }
    if (e instanceof InsufficientFundsError) return send(402, 'insufficient_funds', 'not enough money in the wallet');
    if (e instanceof QuoteInvalidError) return send(422, 'quote_invalid', e.message);
    if (e instanceof CategoryUnavailableError) return send(422, 'category_unavailable', 'that kind of ride is not available right now');
    if (e instanceof NoPricingError) return send(503, 'no_pricing', 'pricing is not available for this category right now');
    if (e instanceof SelfApprovalError) return send(403, 'self_approval', e.message);
    if (e instanceof PayoutStateError) return send(409, 'payout_state', e.message);
    if (e instanceof InvalidWebhookSignatureError) return send(401, 'bad_signature', 'invalid signature');
    if (e instanceof RangeError) return send(400, 'invalid_value', e.message);

    this.log.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
    return send(500, 'internal_error', 'something went wrong on our side');
  }
}
