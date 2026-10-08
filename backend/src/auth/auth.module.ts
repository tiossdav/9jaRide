import { Logger, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { OTP_SENDER, OtpSender, otpTestMode } from './auth.types';
import { OtpService } from './otp.service';
import { TermiiOtpSender, termiiConfigFromEnv } from './termii.sender';
import { TokensService } from './tokens.service';

// Live codes go out through Termii when TERMII_API_KEY is set. In test mode (the default) the code is always 0000 and
// nothing is sent. Live mode without a Termii key refuses to "send" in production, so a missing provider fails loudly
// and never leaks codes into logs.
const log = new Logger('OtpSender');
const termii = termiiConfigFromEnv();
const otpSender: OtpSender = termii
  ? new TermiiOtpSender(termii)
  : {
      send: async (phone, code, channel) => {
        if (otpTestMode()) return; // nothing to send: the code is the fixed test code
        if (process.env.NODE_ENV === 'production') throw new Error('no SMS provider is configured: set TERMII_API_KEY');
        log.warn(`[stub] ${channel} code for ${phone}: ${code}`);
      },
    };

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpService,
    TokensService,
    { provide: OTP_SENDER, useValue: otpSender },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuthService, TokensService],
})
export class AuthModule {}
