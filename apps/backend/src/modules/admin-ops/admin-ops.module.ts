import { Module } from '@nestjs/common';
import { AdminOpsController } from './admin-ops.controller';

@Module({ controllers: [AdminOpsController] })
export class AdminOpsModule {}
