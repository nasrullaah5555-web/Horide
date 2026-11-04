import { Global, Module } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AdminAccountsService } from './admin-accounts.service';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminGuard } from './admin.guard';

/** Global so any feature module can protect its admin endpoints with AdminGuard and write audit logs. */
@Global()
@Module({
  controllers: [AdminAuthController],
  providers: [AuditService, AdminAuthService, AdminAccountsService, AdminGuard],
  exports: [AuditService, AdminAuthService, AdminAccountsService, AdminGuard],
})
export class AdminAuthModule {}
