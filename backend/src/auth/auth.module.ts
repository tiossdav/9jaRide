import { Logger, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { OTP_SENDER, OtpSender } from './auth.types';
import { OtpService } from './otp.service';
import { TokensService } from './tokens.service';

// Placeholder until an SMS/voice provider is chosen. Outside production it logs the code so you can sign in locally;
// in production it refuses to "send", so a missing provider fails loudly and never leaks codes into logs.
const log = new Logger('OtpSender');
const otpSender: OtpSender = {
  send: async (phone, code, channel) => {
    if (process.env.NODE_ENV === 'production') throw new Error('no SMS/voice provider is configured');
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
