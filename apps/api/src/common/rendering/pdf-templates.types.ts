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
