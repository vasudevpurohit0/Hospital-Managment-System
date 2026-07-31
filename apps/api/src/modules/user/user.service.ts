import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class UserService {
  constructor(private prisma: PrismaService) {}

  async findByRole(roleName?: string) {
    const users = await this.prisma.user.findMany({
      where: {
        active: true,
        ...(roleName ? { role: { name: roleName } } : {}),
      },
      select: {
        id: true,
        identifier: true,
        role: { select: { name: true } },
      },
      orderBy: { identifier: 'asc' },
    });

    return users.map((u) => ({ id: u.id, identifier: u.identifier, role: u.role.name }));
  }
}
