import { Module } from '@nestjs/common';
import { NinService } from './nin.service';
import { NIN_VERIFIER, ninVerifierFromEnv } from './nin.verifier';

@Module({ providers: [NinService, { provide: NIN_VERIFIER, useFactory: ninVerifierFromEnv }], exports: [NinService] })
export class NinModule {}
