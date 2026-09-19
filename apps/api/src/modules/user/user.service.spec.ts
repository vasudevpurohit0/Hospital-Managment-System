import { UserService } from './user.service';

describe('UserService (regression: this module previously had zero test coverage)', () => {
  let service: UserService;

  const mockPrisma = {
    user: { findMany: jest.fn() },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UserService(mockPrisma as never);
  });

  describe('findByRole()', () => {
    it('queries only active users and flattens the role relation to its name', async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 'u-1', identifier: 'doctor@esic.gov.in', role: { name: 'Doctor' } },
      ]);

      const result = await service.findByRole('Doctor');

      expect(result).toEqual([{ id: 'u-1', identifier: 'doctor@esic.gov.in', role: 'Doctor' }]);
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        where: { active: true, role: { name: 'Doctor' } },
        select: { id: true, identifier: true, role: { select: { name: true } } },
        orderBy: { identifier: 'asc' },
      });
    });

    it('omits the role filter entirely when no roleName is given, returning every active role', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);

      await service.findByRole();

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { active: true } }),
      );
    });

    it('returns an empty array when no users match', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      const result = await service.findByRole('Pathologist');
      expect(result).toEqual([]);
    });
  });
});
