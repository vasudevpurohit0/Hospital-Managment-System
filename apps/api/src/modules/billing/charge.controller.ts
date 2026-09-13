import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';
import { ChargeStatus } from '@prisma/client';
import { ChargeService } from './charge.service';
import { ReceiptService } from './receipt.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BenefitRuleService } from '../benefit/benefit-rule.service';
import { DocumentRenderService } from '../../common/rendering/document-render.service';
import { renderReceiptHtml, renderStatementHtml } from '../../common/rendering/pdf-templates';
import { CancelChargeDto, IssueReceiptDto, PostServiceChargeDto } from './dto/charge.dto';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { buildPatientExpenseExcel } from './excel-export.util';

/**
 * The unified charge ledger and payment collection surface (Features 3, 4, 17).
 *
 * Reading a patient's ledger is available wherever `Charge:read` is granted;
 * issuing a receipt (i.e. collecting payment) and posting an ad-hoc service
 * charge are separate, narrower permissions — a role that can see charges
 * cannot necessarily create or collect them.
 */
@Controller()
export class ChargeController {
  constructor(
    private readonly charges: ChargeService,
    private readonly receipts: ReceiptService,
    private readonly benefitRules: BenefitRuleService,
    private readonly prisma: PrismaService,
    private readonly documentRender: DocumentRenderService,
  ) {}

  /** Feature 4 — one patient's complete financial history, by Employee ID. */
  @Get('patients/:employeeId/ledger')
  @RequirePermission('Charge', 'read')
  async patientLedger(@Param('employeeId') employeeId: string) {
    return this.charges.patientLedger(employeeId);
  }

  /** Feature 14 — the printable Patient Financial Statement. */
  @Get('patients/:employeeId/statement/pdf')
  @RequirePermission('Charge', 'read')
  @Header('Content-Type', 'application/pdf')
  async getStatementPdf(@Param('employeeId') employeeId: string, @Res() res: Response) {
    const ledger = await this.charges.patientLedger(employeeId);
    const branding = await this.documentRender.getBranding();
    const pdf = await this.documentRender.renderPdf(
      renderStatementHtml(branding, {
        patient: { uhid: ledger.uhid, name: ledger.name, employeeId: ledger.employeeId },
        period: {},
        summary: ledger.summary,
        transactions: ledger.transactions.map((t) => ({
          date: t.date as unknown as string,
          service: t.service,
          category: t.category,
          quantity: t.quantity,
          rate: t.rate,
          totalAmount: t.totalAmount,
        })),
      }),
    );
    res.setHeader('Content-Disposition', `inline; filename="statement-${employeeId}.pdf"`);
    res.send(pdf);
  }

  /** All charges for one visit — the raw material behind a receipt or statement. */
  @Get('visits/:visitId/charges')
  @RequirePermission('Charge', 'read')
  async visitCharges(@Param('visitId') visitId: string) {
    return this.charges.listByVisit(visitId);
  }

  /** Total charges summary for all patients across a given date range (used for ledger period totals). */
  @Get('charges/summary')
  @RequirePermission('Charge', 'read')
  async getChargesSummary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.charges.getSummary(from ? new Date(from) : undefined, to ? new Date(to) : undefined);
  }

  /** Detailed patient expense report exported to Excel for all patients in a selected period. */
  @Get('charges/export/excel')
  @RequirePermission('Charge', 'read')
  async exportPatientExpensesExcel(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('period') period: string | undefined,
    @Res() res: Response,
  ) {
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;

    let periodLabel = 'Selected Period';
    if (period === '1_WEEK') periodLabel = '1 Week';
    else if (period === '15_DAYS') periodLabel = '15 Days';
    else if (period === '1_MONTH') periodLabel = '1 Month';

    const reportData = await this.charges.getDetailedPatientExpenses(fromDate, toDate, periodLabel);
    const xml = buildPatientExpenseExcel(reportData);

    const periodSlug = (period || 'all').toLowerCase().replace(/_/g, '-');
    const dateSlug = new Date().toISOString().slice(0, 10);
    const filename = `patient-expense-report-${periodSlug}-${dateSlug}.xls`;

    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(xml);
  }

  @Get('charges')
  @RequirePermission('Charge', 'read')
  async listCharges(@Query('status') status?: ChargeStatus) {
    return this.prisma.chargeItem.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { service: { select: { code: true, name: true } }, receipt: { select: { receiptNumber: true } } },
    });
  }

  /**
   * Posts a charge for a catalogue service against a visit. The benefit
   * outcome is resolved the same way pharmacy dispensing resolves it — by the
   * employee's employment type, via the existing wildcard-fallback evaluator —
   * rather than inventing a second rule engine for non-medicine charges.
   */
  @Post('charges/service')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('Charge', 'create')
  async postServiceCharge(
    @Body() dto: PostServiceChargeDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const visit = await this.prisma.visit.findUnique({
      where: { id: dto.visitId },
      include: { employee: { include: { employmentType: true } } },
    });
    if (!visit) throw new NotFoundException(`Visit not found: ${dto.visitId}`);

    const outcome = await this.benefitRules.evaluate(visit.employee.employmentType.code);

    return this.charges.postServiceCharge(
      {
        visitId: dto.visitId,
        serviceId: dto.serviceId,
        admissionId: dto.admissionId,
        quantity: dto.quantity,
        actorUserId: user?.id,
      },
      outcome,
    );
  }

  @Post('charges/:id/cancel')
  @RequirePermission('Charge', 'cancel')
  async cancelCharge(
    @Param('id') id: string,
    @Body() dto: CancelChargeDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    if (!user?.id) throw new UnauthorizedException('User context missing');
    await this.charges.cancelCharge(id, dto.reason, user.id);
    return { status: 'CANCELLED' };
  }

  /** Collects payment for a set of pending charges, issuing one receipt. */
  @Post('receipts')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('Receipt', 'create')
  async issueReceipt(@Body() dto: IssueReceiptDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.receipts.issue({
      chargeIds: dto.chargeIds,
      paymentMode: dto.paymentMode as never,
      billingType: dto.billingType as never,
      collectedById: user?.id,
    });
  }

  @Get('receipts/:id')
  @RequirePermission('Receipt', 'read')
  async getReceipt(@Param('id') id: string) {
    return this.receipts.getById(id);
  }

  @Get('receipts/:id/pdf')
  @RequirePermission('Receipt', 'read')
  @Header('Content-Type', 'application/pdf')
  async getReceiptPdf(@Param('id') id: string, @Res() res: Response) {
    const receipt = await this.receipts.getById(id);
    const branding = await this.documentRender.getBranding();
    const pdf = await this.documentRender.renderPdf(renderReceiptHtml(branding, receipt));
    res.setHeader('Content-Disposition', `inline; filename="${receipt.receiptNumber.replace(/\//g, '-')}.pdf"`);
    res.send(pdf);
  }
}
