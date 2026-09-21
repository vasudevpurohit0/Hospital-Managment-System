export interface HospitalBranding {
  hospitalName: string;
  tagline: string;
  primaryColor: string;
}

export interface ReceiptDetailForPdf {
  receiptNumber: string;
  billingType: string;
  issuedAt: string | Date;
  paymentMode: string;
  patient: { uhid: string | null; employeeId: string; name: string; employmentType: string };
  opdDepartment: string | null;
  collectedBy: string | null;
  lines: {
    description: string;
    category: string;
    quantity: string;
    rate: string;
    /** quantity × rate. There is no discount in this system. */
    totalAmount: string;
  }[];
  totalAmount: string;
  amountInWords: string;
}

export interface PatientHistoryForPdf {
  patient: {
    uhid: string | null;
    employeeId: string;
    name: string;
    age: string;
    gender: string;
    dob: string;
    mobile: string;
    address: string;
    employmentType: string;
  };
  hospitalName: string;
  period: { from: string | null; to: string | null };
  summary: {
    totalVisits: number;
    totalAdmissions: number;
    totalConsultations: number;
    totalLabOrders: number;
    totalPrescriptions: number;
    totalMedicines: number;
    totalProcedures: number;
    totalTherapySessions: number;
    totalBills: number;
  };
  events: {
    type: string;
    title: string;
    timestamp: string | null;
    timeRecorded: boolean;
    department: string | null;
    location: string | null;
    performedBy: string | null;
    performedByRole: string | null;
    status: string | null;
  }[];
  medicationHistory: {
    medicineName: string;
    medicineType: string;
    stage: string;
    timestamp: string | null;
    timeRecorded: boolean;
    dose: string | null;
    frequency: string | null;
    duration: string | null;
    quantity: number | null;
    by: string | null;
    notRecordedReason?: string;
  }[];
  billing: { authorized: boolean; total: number; paid: number; pending: number };
  generatedAt: string;
}

export interface LabReportForPdf {
  labNumber: string | null;
  status: string;
  patient: { uhid: string | null; employeeId: string; name: string; age: number | null; gender: string | null };
  opdOrIpdReference: string | null;
  referringDoctor: string;
  sampleDate: string | Date | null;
  reportDate: string | Date;
  panels: {
    testName: string;
    discipline: string;
    results: {
      parameter: string;
      groupLabel: string | null;
      value: string;
      unit: string | null;
      range: string | null;
      flag: string;
      interpretation: string | null;
    }[];
  }[];
  verification: { technician: string | null; pathologist: string; verifiedAt: string | Date; remarks: string | null };
}
