import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../common/prisma/prisma.service';

export interface JwtPayload {
  sub: string;
  identifier: string;
  roleId: string;
  roleName: string;
  type?: 'access' | 'refresh';
}

const DEV_MEMORY_USERS: Record<string, any> = {
  '00000000-0000-0000-0000-000000000010': {
    id: '00000000-0000-0000-0000-000000000010',
    identifier: 'superadmin@esic.gov.in',
    roleId: '00000000-0000-0000-0000-000000000001',
    active: true,
    role: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'SuperAdmin',
      isSystemRole: true,
      permissions: [{ resource: '*', action: '*' }],
    },
  },
  '00000000-0000-0000-0000-000000000088': {
    id: '00000000-0000-0000-0000-000000000088',
    identifier: 'doctor@esic.gov.in',
    roleId: '00000000-0000-0000-0000-000000000003',
    active: true,
    role: {
      id: '00000000-0000-0000-0000-000000000003',
      name: 'Doctor',
      isSystemRole: true,
      permissions: [
        { resource: 'Employee', action: 'read' },
        { resource: 'Visit', action: 'read' },
        { resource: 'OPDVisit', action: 'read' },
        { resource: 'Diagnosis', action: 'create' },
        { resource: 'Diagnosis', action: 'read' },
        { resource: 'Prescription', action: 'create' },
        { resource: 'Prescription', action: 'read' },
        { resource: 'Prescription', action: 'sign' },
        { resource: 'Admission', action: 'create' },
        { resource: 'Admission', action: 'read' },
        { resource: 'Admission', action: 'approve' },
      ],
    },
  },
  '00000000-0000-0000-0000-000000000099': {
    id: '00000000-0000-0000-0000-000000000099',
    identifier: 'reception@esic.gov.in',
    roleId: '00000000-0000-0000-0000-000000000002',
    active: true,
    role: {
      id: '00000000-0000-0000-0000-000000000002',
      name: 'Reception',
      isSystemRole: true,
      permissions: [
        { resource: 'Employee', action: 'create' },
        { resource: 'Employee', action: 'read' },
        { resource: 'Employee', action: 'update' },
        { resource: 'HospitalUID', action: 'create' },
        { resource: 'HospitalUID', action: 'read' },
        { resource: 'Visit', action: 'create' },
        { resource: 'Visit', action: 'read' },
        { resource: 'OPDVisit', action: 'create' },
        { resource: 'OPDVisit', action: 'read' },
      ],
    },
  },
  '00000000-0000-0000-0000-000000000077': {
    id: '00000000-0000-0000-0000-000000000077',
    identifier: 'nurse@esic.gov.in',
    roleId: '00000000-0000-0000-0000-000000000004',
    active: true,
    role: {
      id: '00000000-0000-0000-0000-000000000004',
      name: 'Nurse',
      isSystemRole: true,
      permissions: [
        { resource: 'Employee', action: 'read' },
        { resource: 'Visit', action: 'read' },
        { resource: 'Admission', action: 'read' },
        { resource: 'AdmissionNote', action: 'create' },
        { resource: 'AdmissionNote', action: 'read' },
      ],
    },
  },
  '00000000-0000-0000-0000-000000000066': {
    id: '00000000-0000-0000-0000-000000000066',
    identifier: 'admission@esic.gov.in',
    roleId: '00000000-0000-0000-0000-000000000005',
    active: true,
    role: {
      id: '00000000-0000-0000-0000-000000000005',
      name: 'AdmissionDesk',
      isSystemRole: true,
      permissions: [
        { resource: 'Employee', action: 'read' },
        { resource: 'Visit', action: 'read' },
        { resource: 'Admission', action: 'create' },
        { resource: 'Admission', action: 'read' },
        { resource: 'Admission', action: 'update' },
      ],
    },
  },
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_ACCESS_SECRET || 'dev_jwt_access_secret_key_12345',
    });
  }

  async validate(payload: JwtPayload) {
    if (payload.type && payload.type !== 'access') {
      throw new UnauthorizedException('Invalid token type');
    }

    let user: any = null;
    try {
      user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        include: {
          role: {
            include: {
              permissions: true,
            },
          },
        },
      });
    } catch {
      user = DEV_MEMORY_USERS[payload.sub];
    }

    if (!user) {
      user = DEV_MEMORY_USERS[payload.sub];
    }

    if (!user || !user.active) {
      throw new UnauthorizedException('User account inactive or missing');
    }

    return {
      id: user.id,
      identifier: user.identifier,
      roleId: user.roleId,
      roleName: user.role.name,
      permissions: user.role.permissions.map((p: any) => ({
        resource: p.resource,
        action: p.action,
      })),
    };
  }
}
