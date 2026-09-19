import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { RbacAdminService } from './rbac-admin.service';

describe('RbacAdminService (regression: this module previously had zero test coverage)', () => {
  let service: RbacAdminService;

  const mockPrisma = {
    role: { findMany: jest.fn(), findUnique: jest.fn() },
    permission: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), delete: jest.fn() },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RbacAdminService(mockPrisma as never);
  });

  describe('listRoles()', () => {
    it('flattens each role with its permission/user counts', async () => {
      mockPrisma.role.findMany.mockResolvedValue([
        { id: 'r-1', name: 'Doctor', isSystemRole: true, _count: { permissions: 12, users: 5 } },
      ]);

      const result = await service.listRoles();

      expect(result).toEqual([{ id: 'r-1', name: 'Doctor', isSystemRole: true, permissionCount: 12, userCount: 5 }]);
      expect(mockPrisma.role.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { name: 'asc' } }),
      );
    });
  });

  describe('listPermissionsForRole()', () => {
    it('throws NotFoundException for an unknown role', async () => {
      mockPrisma.role.findUnique.mockResolvedValue(null);
      await expect(service.listPermissionsForRole('missing')).rejects.toThrow(NotFoundException);
      expect(mockPrisma.permission.findMany).not.toHaveBeenCalled();
    });

    it('lists permissions scoped to the given role, ordered by resource/action', async () => {
      mockPrisma.role.findUnique.mockResolvedValue({ id: 'r-1', name: 'Doctor' });
      mockPrisma.permission.findMany.mockResolvedValue([{ id: 'p-1', resource: 'Patient', action: 'read' }]);

      const result = await service.listPermissionsForRole('r-1');

      expect(result).toEqual([{ id: 'p-1', resource: 'Patient', action: 'read' }]);
      expect(mockPrisma.permission.findMany).toHaveBeenCalledWith({
        where: { roleId: 'r-1' },
        orderBy: [{ resource: 'asc' }, { action: 'asc' }],
      });
    });
  });

  describe('grantPermission()', () => {
    const dto = { roleId: 'r-1', resource: 'Patient', action: 'read' };

    it('throws NotFoundException for an unknown role', async () => {
      mockPrisma.role.findUnique.mockResolvedValue(null);
      await expect(service.grantPermission(dto)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.permission.create).not.toHaveBeenCalled();
    });

    it('refuses the universal wildcard resource', async () => {
      mockPrisma.role.findUnique.mockResolvedValue({ id: 'r-1', name: 'Doctor' });
      await expect(service.grantPermission({ ...dto, resource: '*' })).rejects.toThrow(BadRequestException);
      expect(mockPrisma.permission.create).not.toHaveBeenCalled();
    });

    it('refuses the universal wildcard action', async () => {
      mockPrisma.role.findUnique.mockResolvedValue({ id: 'r-1', name: 'Doctor' });
      await expect(service.grantPermission({ ...dto, action: '*' })).rejects.toThrow(BadRequestException);
      expect(mockPrisma.permission.create).not.toHaveBeenCalled();
    });

    it('creates the permission row for a real role/resource/action', async () => {
      mockPrisma.role.findUnique.mockResolvedValue({ id: 'r-1', name: 'Doctor' });
      mockPrisma.permission.create.mockResolvedValue({ id: 'p-new', ...dto });

      const result = await service.grantPermission(dto);

      expect(result).toEqual({ id: 'p-new', ...dto });
      expect(mockPrisma.permission.create).toHaveBeenCalledWith({
        data: { roleId: 'r-1', resource: 'Patient', action: 'read' },
      });
    });

    it('translates a unique-constraint violation into a ConflictException naming the role', async () => {
      mockPrisma.role.findUnique.mockResolvedValue({ id: 'r-1', name: 'Doctor' });
      mockPrisma.permission.create.mockRejectedValue({ code: 'P2002' });

      await expect(service.grantPermission(dto)).rejects.toThrow(ConflictException);
      await expect(service.grantPermission(dto)).rejects.toThrow(/Doctor already has Patient:read/);
    });

    it('rethrows any other error from the create call unchanged', async () => {
      mockPrisma.role.findUnique.mockResolvedValue({ id: 'r-1', name: 'Doctor' });
      const dbError = new Error('connection lost');
      mockPrisma.permission.create.mockRejectedValue(dbError);

      await expect(service.grantPermission(dto)).rejects.toThrow('connection lost');
    });
  });

  describe('revokePermission()', () => {
    it('throws NotFoundException for an unknown permission grant', async () => {
      mockPrisma.permission.findUnique.mockResolvedValue(null);
      await expect(service.revokePermission('missing')).rejects.toThrow(NotFoundException);
      expect(mockPrisma.permission.delete).not.toHaveBeenCalled();
    });

    it('refuses to touch a SuperAdmin permission row', async () => {
      mockPrisma.permission.findUnique.mockResolvedValue({ id: 'p-1', role: { name: 'SuperAdmin' } });
      await expect(service.revokePermission('p-1')).rejects.toThrow(BadRequestException);
      expect(mockPrisma.permission.delete).not.toHaveBeenCalled();
    });

    it('deletes a real, non-SuperAdmin permission grant', async () => {
      mockPrisma.permission.findUnique.mockResolvedValue({ id: 'p-1', role: { name: 'Doctor' } });
      mockPrisma.permission.delete.mockResolvedValue({});

      const result = await service.revokePermission('p-1');

      expect(result).toEqual({ revoked: true });
      expect(mockPrisma.permission.delete).toHaveBeenCalledWith({ where: { id: 'p-1' } });
    });
  });
});
