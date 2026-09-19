import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { EmployeeController } from './employee.controller';
import { EmployeeService } from './employee.service';
import { EmployeeVerificationService } from './services/employee-verification.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

describe('EmployeeController.update (regression: mass-assignment + reclassification scoping)', () => {
  let controller: EmployeeController;

  const mockEmployeeService = {
    update: jest.fn().mockResolvedValue({ id: 'emp-1' }),
  };

  const receptionUser: AuthenticatedUser = {
    id: 'u-reception',
    identifier: 'reception@example.com',
    roleId: 'r-1',
    roleName: 'Reception',
    type: 'hospital',
    permissions: [
      { resource: 'Employee', action: 'read' },
      { resource: 'Employee', action: 'create' },
      { resource: 'Employee', action: 'update' },
    ],
  };

  const adminUser: AuthenticatedUser = {
    id: 'u-admin',
    identifier: 'admin@example.com',
    roleId: 'r-2',
    roleName: 'Administrator',
    type: 'hospital',
    permissions: [
      { resource: 'Employee', action: 'update' },
      { resource: 'Employee', action: 'reclassify' },
    ],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EmployeeController],
      providers: [
        { provide: EmployeeService, useValue: mockEmployeeService },
        { provide: EmployeeVerificationService, useValue: {} },
      ],
    }).compile();

    controller = module.get<EmployeeController>(EmployeeController);
    jest.clearAllMocks();
  });

  it('allows a demographic-only edit for a role holding only Employee:update (e.g. Reception)', async () => {
    await controller.update('emp-1', { name: 'New Name', contactPhone: '9999999999' }, receptionUser);
    expect(mockEmployeeService.update).toHaveBeenCalledWith('emp-1', {
      name: 'New Name',
      contactPhone: '9999999999',
    });
  });

  it('rejects a reclassification field (postId/gradeId/employmentTypeId) from a role that only holds Employee:update (regression: previously any field was writable)', async () => {
    await expect(
      controller.update('emp-1', { gradeId: 'grade-999' }, receptionUser),
    ).rejects.toThrow(ForbiddenException);
    expect(mockEmployeeService.update).not.toHaveBeenCalled();
  });

  it('allows a reclassification field for a role holding Employee:reclassify (e.g. Administrator)', async () => {
    await controller.update('emp-1', { gradeId: 'grade-999' }, adminUser);
    expect(mockEmployeeService.update).toHaveBeenCalledWith('emp-1', { gradeId: 'grade-999' });
  });

  it('allows a reclassification field for a platform Super Admin regardless of the permissions array', async () => {
    const platformUser: AuthenticatedUser = {
      id: 'u-platform',
      identifier: 'super@platform.example',
      roleId: '',
      roleName: 'SuperAdmin',
      type: 'platform',
      permissions: [],
    };
    await controller.update('emp-1', { postId: 'post-1' }, platformUser);
    expect(mockEmployeeService.update).toHaveBeenCalledWith('emp-1', { postId: 'post-1' });
  });
});
