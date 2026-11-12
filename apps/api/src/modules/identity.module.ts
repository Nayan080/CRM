import { Global, Module } from '@nestjs/common';
import { AuditController } from './audit/audit.controller.js';
import { AuditService } from './audit/audit.service.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';
import { JwtService } from './auth/jwt.service.js';
import { SessionService } from './auth/session.service.js';
import { InvitationsController } from './invitations/invitations.controller.js';
import { InvitationsService } from './invitations/invitations.service.js';
import { MeController } from './me/me.controller.js';
import { MeService } from './me/me.service.js';
import { MembersController } from './members/members.controller.js';
import { MembersService } from './members/members.service.js';
import { ReferenceService } from './reference/reference.service.js';
import { TenantsController } from './tenants/tenants.controller.js';
import { RoleSyncService } from './tenants/role-sync.service.js';
import { TenantsService } from './tenants/tenants.service.js';

/**
 * Stage 2: identity & tenancy (auth, sessions, MFA, workspaces, members, invitations, audit).
 * Global so the guards can use JwtService.
 */
@Global()
@Module({
  controllers: [
    AuthController,
    MeController,
    TenantsController,
    MembersController,
    InvitationsController,
    AuditController,
  ],
  providers: [
    AuditService,
    JwtService,
    SessionService,
    AuthService,
    MeService,
    TenantsService,
    MembersService,
    InvitationsService,
    ReferenceService,
    RoleSyncService,
  ],
  exports: [AuditService, JwtService, ReferenceService],
})
export class IdentityModule {}
