import { apiFetch } from './http';

export interface BillingTransactionRecord {
  id: string;
  prescriptionItemId: string;
  outcome: 'FREE' | 'COVERED' | 'PAID';
  amount?: number | null;
  receiptReference?: string | null;
  createdAt: string;
  prescriptionItem?: {
    medicineName: string;
    dose: string;
    frequency: string;
    duration: string;
    prescription?: {
      id: string;
      visit?: {
        employee?: {
          employeeId?: string;
          employmentType?: { name: string };
          patientProfile?: { fullName: string; gender: string };
        };
      };
    };
  };
}

export interface ReceiptRecord {
  receiptReference: string;
  transactionId: string;
  issueDate: string;
  patientName: string;
  employeeId: string;
  employmentType: string;
  medicineName: string;
  dose: string;
  frequency: string;
  duration: string;
  outcome: string;
  amountCharged: number;
  currency: string;
  issuingHospital: string;
  status: string;
}

export async function fetchBillingTransactions(token: string): Promise<BillingTransactionRecord[]> {
  return apiFetch<BillingTransactionRecord[]>(
    '/api/billing/transactions',
    { headers: { Authorization: `Bearer ${token}` } },
    'Failed to fetch billing transactions',
  );
}

export async function fetchReceipt(transactionId: string, token: string): Promise<ReceiptRecord> {
  return apiFetch<ReceiptRecord>(
    `/api/billing/receipts/${transactionId}`,
    { headers: { Authorization: `Bearer ${token}` } },
    'Failed to fetch receipt data',
  );
}
