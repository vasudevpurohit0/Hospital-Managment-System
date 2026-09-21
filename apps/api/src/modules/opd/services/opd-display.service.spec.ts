import { OpdDisplayService } from './opd-display.service';

describe('OpdDisplayService', () => {
  let service: OpdDisplayService;

  const mockOpdService = { getHospitalQueue: jest.fn() };
  const mockDepartmentService = { findAll: jest.fn() };

  const dept = (id: string, name: string, code: string) => ({ id, name, code, active: true });

  const row = (overrides: Record<string, any>) => ({
    tokenNumber: 'TKN-1',
    departmentId: 'dept-1',
    status: 'WAITING',
    queuePosition: 1,
    doctor: { employee: { name: 'Dr. Rao', consultationRoom: '204' } },
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OpdDisplayService(mockOpdService as never, mockDepartmentService as never);
  });

  it('fetches departments and the hospital queue with exactly one call each (no N+1 as departments grow)', async () => {
    mockDepartmentService.findAll.mockResolvedValue([dept('dept-1', 'Cardiology', 'CARDIO')]);
    mockOpdService.getHospitalQueue.mockResolvedValue([]);

    await service.getHospitalSnapshot();

    expect(mockDepartmentService.findAll).toHaveBeenCalledTimes(1);
    expect(mockOpdService.getHospitalQueue).toHaveBeenCalledTimes(1);
  });

  it('includes a department with zero active visits, with empty buckets rather than hiding it', async () => {
    mockDepartmentService.findAll.mockResolvedValue([dept('dept-1', 'Cardiology', 'CARDIO')]);
    mockOpdService.getHospitalQueue.mockResolvedValue([]);

    const snapshot = await service.getHospitalSnapshot();

    expect(snapshot.departments).toEqual([
      { id: 'dept-1', name: 'Cardiology', code: 'CARDIO', nowServing: [], waiting: [], waitingCount: 0 },
    ]);
  });

  it('buckets CALLED/IN_CONSULTATION into nowServing and WAITING into waiting, per department', async () => {
    mockDepartmentService.findAll.mockResolvedValue([
      dept('dept-1', 'Cardiology', 'CARDIO'),
      dept('dept-2', 'Dermatology', 'DERMA'),
    ]);
    mockOpdService.getHospitalQueue.mockResolvedValue([
      row({ tokenNumber: 'CARDIO-001', departmentId: 'dept-1', status: 'CALLED' }),
      row({ tokenNumber: 'CARDIO-002', departmentId: 'dept-1', status: 'WAITING', queuePosition: 1 }),
      row({ tokenNumber: 'CARDIO-003', departmentId: 'dept-1', status: 'WAITING', queuePosition: 2 }),
      row({ tokenNumber: 'DERMA-001', departmentId: 'dept-2', status: 'IN_CONSULTATION' }),
    ]);

    const snapshot = await service.getHospitalSnapshot();
    const cardio = snapshot.departments.find((d) => d.id === 'dept-1')!;
    const derma = snapshot.departments.find((d) => d.id === 'dept-2')!;

    expect(cardio.nowServing).toEqual([
      { token: 'CARDIO-001', status: 'CALLED', doctorName: 'Dr. Rao', room: '204' },
    ]);
    expect(cardio.waiting).toEqual([
      { token: 'CARDIO-002', position: 1 },
      { token: 'CARDIO-003', position: 2 },
    ]);
    expect(cardio.waitingCount).toBe(2);

    expect(derma.nowServing).toEqual([
      { token: 'DERMA-001', status: 'IN_CONSULTATION', doctorName: 'Dr. Rao', room: '204' },
    ]);
    expect(derma.waitingCount).toBe(0);
  });

  it('waitingCount reflects only the WAITING bucket, not every row for the department', async () => {
    mockDepartmentService.findAll.mockResolvedValue([dept('dept-1', 'Cardiology', 'CARDIO')]);
    mockOpdService.getHospitalQueue.mockResolvedValue([
      row({ tokenNumber: 'CARDIO-001', status: 'CALLED' }),
      row({ tokenNumber: 'CARDIO-002', status: 'WAITING' }),
    ]);

    const snapshot = await service.getHospitalSnapshot();
    expect(snapshot.departments[0].waitingCount).toBe(1);
  });

  it('silently drops a row whose department is not in the active department list (deactivated mid-flight)', async () => {
    mockDepartmentService.findAll.mockResolvedValue([dept('dept-1', 'Cardiology', 'CARDIO')]);
    mockOpdService.getHospitalQueue.mockResolvedValue([
      row({ tokenNumber: 'ORPHAN-001', departmentId: 'dept-99', status: 'WAITING' }),
    ]);

    const snapshot = await service.getHospitalSnapshot();
    expect(snapshot.departments).toHaveLength(1);
    expect(snapshot.departments[0].waiting).toEqual([]);
  });

  it('strips PII: a nowServing entry never carries patient name/mobile/diagnosis, only token/status/doctorName/room', async () => {
    mockDepartmentService.findAll.mockResolvedValue([dept('dept-1', 'Cardiology', 'CARDIO')]);
    mockOpdService.getHospitalQueue.mockResolvedValue([
      row({
        tokenNumber: 'CARDIO-001',
        status: 'CALLED',
        visit: { employee: { name: 'Rahul Sharma', mobile: '9999999999' } },
      }),
    ]);

    const snapshot = await service.getHospitalSnapshot();
    expect(Object.keys(snapshot.departments[0].nowServing[0]).sort()).toEqual([
      'doctorName',
      'room',
      'status',
      'token',
    ]);
  });

  it('returns an empty departments array (not an error) when the hospital has no active departments', async () => {
    mockDepartmentService.findAll.mockResolvedValue([]);
    mockOpdService.getHospitalQueue.mockResolvedValue([]);

    const snapshot = await service.getHospitalSnapshot();
    expect(snapshot.departments).toEqual([]);
  });
});
