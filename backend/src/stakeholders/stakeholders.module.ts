import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { StakeholdersController } from './stakeholders.controller';
import { StakeholdersService } from './stakeholders.service';

@Module({ imports: [LedgerModule], controllers: [StakeholdersController], providers: [StakeholdersService] })
export class StakeholdersModule {}
