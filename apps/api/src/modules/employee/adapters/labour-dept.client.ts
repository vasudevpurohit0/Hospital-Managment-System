import { Injectable, Logger } from '@nestjs/common';

export interface VerifiedEmployeeData {
  employeeId: string;
  name: string;
  department: string;
  postTitle: string;
  gradePayLevel: string;
  employmentTypeCode: 'PERMANENT' | 'CONTRACTUAL';
  contactPhone?: string;
  contactEmail?: string;
}

export interface LabourDeptClient {
  verifyEmployee(employeeId: string): Promise<VerifiedEmployeeData | null>;
}

export const LABOUR_DEPT_CLIENT = Symbol('LABOUR_DEPT_CLIENT');

/**
 * Mock implementation of Labour Dept External API.
 * Swappable per environment via NestJS Dependency Injection.
 * See docs/01-architecture.md §2.5 & docs/02-tech-stack.md §6.
 */
@Injectable()
export class MockLabourDeptClient implements LabourDeptClient {
  private readonly logger = new Logger(MockLabourDeptClient.name);

  // Realistic sample database matching Labour Dept records
  private readonly mockRecords: Record<string, VerifiedEmployeeData> = {
    'EMP-1001': {
      employeeId: 'EMP-1001',
      name: 'Rajesh Kumar',
      department: 'Public Works Department',
      postTitle: 'Clerk',
      gradePayLevel: 'Pay Level 4',
      employmentTypeCode: 'PERMANENT',
      contactPhone: '+91 9876543210',
      contactEmail: 'rajesh.kumar@labour.gov.in',
    },
    'EMP-1002': {
      employeeId: 'EMP-1002',
      name: 'Sunita Sharma',
      department: 'Health & Family Welfare',
      postTitle: 'Senior Officer',
      gradePayLevel: 'Pay Level 10',
      employmentTypeCode: 'PERMANENT',
      contactPhone: '+91 9876543211',
      contactEmail: 'sunita.sharma@labour.gov.in',
    },
    'EMP-CONTRACT-01': {
      employeeId: 'EMP-CONTRACT-01',
      name: 'Amit Patel',
      department: 'Urban Development',
      postTitle: 'Contract Worker',
      gradePayLevel: 'Pay Level 1',
      employmentTypeCode: 'CONTRACTUAL',
      contactPhone: '+91 9876543212',
      contactEmail: 'amit.patel@contractor.com',
    },
  };

  async verifyEmployee(employeeId: string): Promise<VerifiedEmployeeData | null> {
    this.logger.log(`🔍 [MockLabourDeptClient] Verifying Employee ID: ${employeeId}`);

    // Simulate async network call latency (mockable)
    await new Promise((resolve) => setTimeout(resolve, 50));

    const record = this.mockRecords[employeeId.trim()];
    if (record) {
      return record;
    }

    // Dynamically generate verified record for any new valid EMP-* identifier
    const trimmedUpper = employeeId.trim().toUpperCase();
    if (trimmedUpper.startsWith('EMP-') || trimmedUpper.startsWith('ESIC-')) {
      const formattedId = employeeId.trim();
      return {
        employeeId: formattedId,
        name: `Beneficiary ${formattedId}`,
        department: 'Labour & State Services',
        postTitle: 'Officer',
        gradePayLevel: 'Pay Level 7',
        employmentTypeCode: 'PERMANENT',
        contactPhone: '+91 9876543299',
        contactEmail: `${formattedId.toLowerCase()}@labour.gov.in`,
      };
    }

    this.logger.warn(`⚠️ [MockLabourDeptClient] Employee ID not found: ${employeeId}`);
    return null;
  }
}
