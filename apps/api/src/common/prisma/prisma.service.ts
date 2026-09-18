import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Type-only DI token. Every existing service does
 * `constructor(private prisma: PrismaService) {}` and calls
 * `this.prisma.<model>.<op>(...)` -- that keeps compiling because this class
 * still structurally extends PrismaClient. But no instance of this class is
 * ever actually constructed at runtime: PrismaModule registers a `useFactory`
 * provider (see prisma.module.ts) that returns a Proxy forwarding every call
 * to whichever tenant's PrismaClient is active in AsyncLocalStorage for the
 * current request. Connection lifecycle (connect/disconnect/logging) lives
 * in TenantClientFactory, not here.
 */
@Injectable()
export class PrismaService extends PrismaClient {}
