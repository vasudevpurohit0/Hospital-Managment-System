export interface Department {
  id: string;
  name: string;
  code: string;
}

export interface OPDVisitRecord {
  id: string;
  visitId: string;
  departmentId: string;
  tokenNumber: string;
  calledAt: string | null;
  closedAt: string | null;
  createdAt: string;
  department?: Department;
  visit?: {
    id: string;
    employeeId: string;
    type: string;
    status: string;
    employee?: {
      name: string;
      employeeId: string;
      department?: string;
    };
  };
}

// ── Local Mock Databases to Bypass Backend Network Calls entirely during Mock Sessions ──
const MOCK_DEPTS: Department[] = [
  { id: '11111111-2222-3333-4444-555555555555', code: 'GEN_MED', name: 'General Medicine' },
  { id: '22222222-3333-4444-5555-666666666666', code: 'ORTHO', name: 'Orthopedics' },
  { id: '33333333-4444-5555-6666-777777777777', code: 'PEDS', name: 'Pediatrics' },
  { id: '44444444-5555-6666-7777-888888888888', code: 'CARDIO', name: 'Cardiology' },
];

let localMockQueue: OPDVisitRecord[] = [
  {
    id: 'a71a05ae-c657-4d39-bed6-453442f3c3e5',
    visitId: 'b71a05ae-c657-4d39-bed6-453442f3c3e5',
    departmentId: '11111111-2222-3333-4444-555555555555',
    tokenNumber: 'T-0043',
    calledAt: new Date(Date.now() - 300000).toISOString(),
    closedAt: null,
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    department: { id: '11111111-2222-3333-4444-555555555555', code: 'GEN_MED', name: 'General Medicine' },
    visit: {
      id: 'b71a05ae-c657-4d39-bed6-453442f3c3e5',
      employeeId: 'EMP-1001',
      type: 'OPD',
      status: 'OPEN',
      employee: { name: 'Suresh Patel', employeeId: 'EMP-1001', department: 'General Med' },
    },
  },
  {
    id: 'a5318437-c6c4-411f-a9d4-26c66b07403c',
    visitId: 'b5318437-c6c4-411f-a9d4-26c66b07403c',
    departmentId: '11111111-2222-3333-4444-555555555555',
    tokenNumber: 'T-0044',
    calledAt: null,
    closedAt: null,
    createdAt: new Date(Date.now() - 2400000).toISOString(),
    department: { id: '11111111-2222-3333-4444-555555555555', code: 'GEN_MED', name: 'General Medicine' },
    visit: {
      id: 'b5318437-c6c4-411f-a9d4-26c66b07403c',
      employeeId: 'EMP-1002',
      type: 'OPD',
      status: 'OPEN',
      employee: { name: 'Priya Devi', employeeId: 'EMP-1002', department: 'General Med' },
    },
  },
  {
    id: 'a8d1aeb6-9e5e-4fd0-8dbe-a45e2e9be593',
    visitId: 'b8d1aeb6-9e5e-4fd0-8dbe-a45e2e9be593',
    departmentId: '11111111-2222-3333-4444-555555555555',
    tokenNumber: 'T-0045',
    calledAt: null,
    closedAt: null,
    createdAt: new Date(Date.now() - 1800000).toISOString(),
    department: { id: '11111111-2222-3333-4444-555555555555', code: 'GEN_MED', name: 'General Medicine' },
    visit: {
      id: 'b8d1aeb6-9e5e-4fd0-8dbe-a45e2e9be593',
      employeeId: 'EMP-1003',
      type: 'OPD',
      status: 'OPEN',
      employee: { name: 'Rahul Kumar', employeeId: 'EMP-1003', department: 'General Med' },
    },
  },
];

async function safeJsonFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    throw new Error(`API returned ${res.status}`);
  }
  const contentType = res.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    throw new Error('Response is not JSON');
  }
  return res.json();
}

export async function fetchDepartments(token: string): Promise<Department[]> {
  if (token?.startsWith('dev-session-')) {
    return MOCK_DEPTS;
  }
  return safeJsonFetch<Department[]>('/api/departments', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function createOpdVisit(
  payload: { visitId: string; departmentId: string },
  token: string,
): Promise<{ status: string; opdVisit: OPDVisitRecord; tokenNumber: string }> {
  if (token?.startsWith('dev-session-')) {
    const matchedDept = MOCK_DEPTS.find((d) => d.id === payload.departmentId) || MOCK_DEPTS[0];
    const newRecord: OPDVisitRecord = {
      id: `mock-opd-${Date.now()}`,
      visitId: payload.visitId,
      departmentId: matchedDept.id,
      tokenNumber: `T-0${Math.floor(Math.random() * 900) + 100}`,
      calledAt: null,
      closedAt: null,
      createdAt: new Date().toISOString(),
      department: matchedDept,
      visit: {
        id: payload.visitId,
        employeeId: 'EMP-MOCK',
        type: 'OPD',
        status: 'OPEN',
        employee: { name: 'New Walk-in Patient', employeeId: 'EMP-MOCK', department: matchedDept.name },
      },
    };
    localMockQueue.push(newRecord);
    return {
      status: 'CREATED',
      opdVisit: newRecord,
      tokenNumber: newRecord.tokenNumber,
    };
  }

  return safeJsonFetch('/api/opd-visits', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
}

export async function fetchOpdQueue(
  departmentId: string,
  token: string,
): Promise<OPDVisitRecord[]> {
  if (token?.startsWith('dev-session-')) {
    return localMockQueue.filter((o) => o.departmentId === departmentId && !o.closedAt);
  }
  return safeJsonFetch<OPDVisitRecord[]>(
    `/api/opd-visits/queue?departmentId=${encodeURIComponent(departmentId)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function callOpdToken(id: string, token: string): Promise<OPDVisitRecord> {
  if (token?.startsWith('dev-session-')) {
    let updatedRecord: OPDVisitRecord | null = null;
    localMockQueue = localMockQueue.map((item) => {
      if (item.calledAt && !item.closedAt) {
        return { ...item, closedAt: new Date().toISOString() };
      }
      if (item.id === id) {
        updatedRecord = { ...item, calledAt: new Date().toISOString() };
        return updatedRecord;
      }
      return item;
    });
    if (!updatedRecord) {
      throw new Error('Record not found');
    }
    return updatedRecord;
  }

  return safeJsonFetch<OPDVisitRecord>(`/api/opd-visits/${id}/call`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function closeOpdVisit(id: string, token: string): Promise<OPDVisitRecord> {
  if (token?.startsWith('dev-session-')) {
    let updatedRecord: OPDVisitRecord | null = null;
    localMockQueue = localMockQueue.map((item) => {
      if (item.id === id) {
        updatedRecord = { ...item, closedAt: new Date().toISOString() };
        return updatedRecord;
      }
      return item;
    });
    if (!updatedRecord) {
      throw new Error('Record not found');
    }
    return updatedRecord;
  }

  return safeJsonFetch<OPDVisitRecord>(`/api/opd-visits/${id}/close`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
}
