import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(private prisma: PrismaService) {}

  // Find all billing transactions from PostgreSQL DB
  async findAllTransactions() {
    return this.prisma.billingTransaction.findMany({
      include: {
        prescriptionItem: {
          include: {
            prescription: {
              include: {
                visit: {
                  include: {
                    employee: {
                      include: {
                        employmentType: true,
                        patientProfile: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Get receipt data for printable PDF from PostgreSQL DB
  async getReceipt(transactionId: string) {
    const tx = await this.prisma.billingTransaction.findUnique({
      where: { id: transactionId },
      include: {
        prescriptionItem: {
          include: {
            prescription: {
              include: {
                visit: {
                  include: {
                    employee: {
                      include: {
                        employmentType: true,
                        patientProfile: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!tx) throw new NotFoundException(`Billing transaction not found: ${transactionId}`);

    const rxItem = tx.prescriptionItem;
    const emp = rxItem?.prescription?.visit?.employee;

    return {
      receiptReference: tx.receiptReference || `RCPT-${tx.id.substring(0, 8).toUpperCase()}`,
      transactionId: tx.id,
      issueDate: tx.createdAt,
      patientName: emp?.name || (emp as any)?.patientProfile?.fullName || 'ESIC Beneficiary',
      employeeId: emp?.employeeId || 'N/A',
      employmentType: emp?.employmentType?.name || 'Contractual',
      medicineName: rxItem.medicineName,
      dose: rxItem.dose,
      frequency: rxItem.frequency,
      duration: rxItem.duration,
      outcome: tx.outcome,
      amountCharged: tx.amount ? Number(tx.amount) : 0,
      currency: 'INR',
      issuingHospital: 'ESIC Model Hospital & ODC',
      status: 'PAID & ISSUED',
    };
  }
}
