import { PrismaClient } from '.prisma/platform-client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Bootstraps the first Super Admin (PlatformUser) account. Override via env
// vars for anything beyond local dev; defaults mirror the demo-credential
// convention already used by prisma/seed.ts.
const EMAIL = process.env.PLATFORM_ADMIN_EMAIL || 'superadmin@platform.local';
const PASSWORD = process.env.PLATFORM_ADMIN_PASSWORD || 'SuperAdminPlatform123!';
const NAME = process.env.PLATFORM_ADMIN_NAME || 'Platform Super Admin';

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const user = await prisma.platformUser.upsert({
    where: { email: EMAIL },
    update: {},
    create: {
      email: EMAIL,
      passwordHash,
      name: NAME,
    },
  });

  console.log(`Platform seed complete. Super Admin: ${user.email} (id: ${user.id})`);
}

main()
  .catch((e) => {
    console.error('Platform seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
