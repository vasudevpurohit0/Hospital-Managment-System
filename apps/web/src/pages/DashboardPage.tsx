import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { StatCard } from '../components/ui/StatCard';
import { Badge } from '../components/ui/Badge';
import { fetchDashboardMetrics, fetchMyDashboardSummary, DashboardMetrics, MyDashboardSummary } from '../api/dashboard.api';
import {
  ArrowRight,
  Users,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Stethoscope,
  Pill,
  DollarSign,
  TrendingUp,
  Building,
  ShieldCheck,
  ClipboardList,
  PackageX,
  Truck,
  BedDouble,
  UserPlus,
  ReceiptText,
  UserCog,
} from 'lucide-react';
import { Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { formatDateFull } from '../utils/date';

const CATEGORY_COLORS = ['#0F4C81', '#0D9488', '#3B82F6', '#F59E0B', '#8B5CF6', '#EF4444'];

/** Where each role's "Go to my workspace" quick-link should land -- reuses existing pages/screens, never a new route. */
const WORKSPACE_PATH: Record<string, string> = {
  Doctor: '/consultations',
  Nurse: '/ward-console',
  Reception: '/registration',
  Pharmacist: '/pharmacy',
  LabTechnician: '/laboratory',
  Pathologist: '/laboratory',
  AdmissionDesk: '/ipd-admissions',
  QueueManager: '/opd-queue',
  StoreManager: '/inventory',
  ProcurementOfficer: '/supply-chain',
  DataEntryOperator: '/employee-directory',
  Administrator: '/staff-management',
};

/** A lean "my work today" tile row, sourced from GET /dashboard/my-summary -- a handful of real counts plus a shortcut into the role's existing full workspace, never a re-implementation of it. */
const MyWorkPanel: React.FC<{ summary: MyDashboardSummary | null; role: string }> = ({ summary, role }) => {
  const navigate = useNavigate();
  const workspacePath = WORKSPACE_PATH[role];

  const tiles: { label: string; value: React.ReactNode }[] = [];
  if (summary) {
    switch (summary.role) {
      case 'Doctor':
        tiles.push({ label: 'Waiting', value: summary.waitingCount as number });
        tiles.push({ label: 'In Consultation', value: summary.calledCount as number });
        tiles.push({ label: 'Draft Prescriptions', value: summary.pendingPrescriptionDrafts as number });
        break;
      case 'Nurse':
        tiles.push({ label: 'Assigned Patients', value: summary.assignedAdmissions as number });
        tiles.push({ label: 'Notes Today', value: summary.notesToday as number });
        break;
      case 'Reception':
        tiles.push({ label: "Today's OPD Visits", value: summary.todayOpdVisits as number });
        tiles.push({ label: 'Waiting Queue', value: summary.waitingQueue as number });
        break;
      case 'Pharmacist':
        tiles.push({ label: 'Pending Dispense Queue', value: summary.pendingQueue as number });
        tiles.push({ label: 'Low Stock Items', value: summary.lowStock as number });
        break;
      case 'LabTechnician':
        tiles.push({ label: 'Pending Collection', value: summary.pendingCollection as number });
        tiles.push({ label: 'In Progress', value: summary.inProgress as number });
        break;
      case 'Pathologist':
        tiles.push({ label: 'Awaiting Verification', value: summary.awaitingVerification as number });
        tiles.push({ label: 'Critical Unverified', value: summary.criticalUnverified as number });
        break;
      case 'AdmissionDesk':
        tiles.push({ label: 'Pending Requests', value: summary.pendingRequests as number });
        tiles.push({ label: 'Available Beds', value: summary.availableBeds as number });
        break;
      case 'QueueManager':
        tiles.push({ label: 'Waiting Across Departments', value: summary.waitingAcrossDepartments as number });
        break;
      case 'StoreManager':
        tiles.push({ label: 'Low Stock', value: summary.lowStock as number });
        tiles.push({ label: 'Open Requisitions', value: summary.openRequisitions as number });
        break;
      case 'ProcurementOfficer':
        tiles.push({ label: 'Awaiting Approval', value: summary.awaitingApproval as number });
        tiles.push({ label: 'Open POs', value: summary.openPOsAwaitingGRN as number });
        break;
      case 'DataEntryOperator':
        tiles.push({ label: 'Employees Added Today', value: summary.employeesAddedToday as number });
        break;
      case 'Administrator':
        tiles.push({ label: 'Active Staff', value: summary.activeStaff as number });
        tiles.push({ label: 'Inactive Staff', value: summary.inactiveStaff as number });
        tiles.push({ label: 'Security Events Today', value: summary.securityEventsToday as number });
        break;
      default:
        break;
    }
  }

  if (tiles.length === 0 && !workspacePath) return null;

  return (
    <div className="card p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div className="flex flex-wrap gap-6">
        {tiles.map((t) => (
          <div key={t.label}>
            <p className="text-2xl font-bold text-[var(--color-text-primary)]">{t.value ?? '—'}</p>
            <p className="text-xs text-[var(--color-text-secondary)]">{t.label}</p>
          </div>
        ))}
      </div>
      {workspacePath && (
        <button onClick={() => navigate(workspacePath)} className="btn btn-primary btn-sm gap-2 whitespace-nowrap">
          Go to My Workspace <ArrowRight className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};

export const DashboardPage: React.FC = () => {
  const { user, token } = useAuth();
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [mySummary, setMySummary] = useState<MyDashboardSummary | null>(null);

  useEffect(() => {
    fetchDashboardMetrics(token || '')
      .then(setMetrics)
      .catch((err: unknown) => {
        setMetricsError(err instanceof Error ? err.message : 'Failed to load dashboard metrics');
      });
    fetchMyDashboardSummary(token || '')
      .then(setMySummary)
      .catch(() => undefined); // non-fatal: the rest of the dashboard still renders from the aggregate metrics
  }, [token]);

  // No fallback role here on purpose: defaulting an unauthenticated/loading
  // user to 'Doctor' previously made every role-specific section below
  // (banner text, StatCards, MyWorkPanel) silently render Doctor content for
  // anyone whose `user` wasn't resolved yet, rather than just rendering
  // nothing until it is.
  const role = user?.role || '';

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Welcome Banner */}
      <div className="card p-6 bg-gradient-to-r from-primary-900 via-primary-800 to-primary-900 text-white border-none relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 opacity-10 flex items-center pr-10 pointer-events-none">
          <Building className="w-64 h-64" />
        </div>
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md text-xs font-semibold text-primary-200 mb-3 border border-white/10">
            <ShieldCheck className="w-3.5 h-3.5 text-secondary-400" />
            ESIC Hospital Operations Console •{' '}
            {formatDateFull(new Date())}
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Welcome back, {user?.name || 'User'}
          </h1>
          <p className="text-sm text-primary-200/80 mt-1.5 leading-relaxed">
            {role === 'Doctor' &&
              (metrics?.opd
                ? `You have ${metrics.opd.waitingQueue} patients waiting in the OPD queue today.`
                : 'Loading today’s OPD queue...')}
            {role === 'Pharmacist' &&
              (metrics?.billing && metrics.inventory
                ? `${metrics.billing.totalTransactions} prescriptions in the billing ledger. ${metrics.inventory.lowStockAlerts} low-stock alerts.`
                : 'Loading pharmacy summary...')}
            {role === 'StoreManager' &&
              (metrics?.procurement && metrics.inventory
                ? `Inventory summary: ${metrics.procurement.pendingRequisitions} requisitions pending approval. ${metrics.inventory.quarantinedBatches} batches quarantined.`
                : 'Loading inventory summary...')}
            {role === 'Nurse' &&
              (metrics?.ipd
                ? `${metrics.ipd.activeAdmissions} patients currently admitted. ${metrics.ipd.availableBeds} beds available.`
                : 'Loading ward summary...')}
            {role === 'Reception' &&
              (metrics?.opd
                ? `${metrics.opd.waitingQueue} patients waiting in the OPD queue. ${metrics.opd.totalVisits} total visits today.`
                : 'Loading front desk summary...')}
            {role === 'AdmissionDesk' &&
              (metrics?.ipd
                ? `${metrics.ipd.availableBeds} beds available out of ${metrics.ipd.totalBeds}. ${metrics.ipd.activeAdmissions} active admissions.`
                : 'Loading bed availability...')}
            {role === 'DataEntryOperator' &&
              (metrics?.staff
                ? `${metrics.staff.totalEmployees} employees registered. ${metrics.staff.employeesAddedToday} added today.`
                : 'Loading employee directory summary...')}
            {(role === 'SuperAdmin' || role === 'Administrator') &&
              (metrics?.ipd && metrics.billing
                ? `Hospital operational summary: Bed occupancy at ${metrics.ipd.bedOccupancyRate}%. ${metrics.billing.paidTransactions} paid billing transactions.`
                : 'Loading hospital operational summary...')}
          </p>
        </div>
      </div>

      {metricsError && <div className="alert alert-danger">{metricsError}</div>}

      <MyWorkPanel summary={mySummary} role={role} />

      {/* Role-Specific Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {role === 'Doctor' ? (
          <>
            <StatCard
              title="Today's OPD Visits"
              value={metrics?.opd?.totalVisits ?? '—'}
              icon={Stethoscope}
              variant="primary"
            />
            <StatCard
              title="Waiting Queue"
              value={metrics?.opd ? `${metrics.opd.waitingQueue} Patients` : '—'}
              icon={Clock}
              variant="warning"
            />
            <StatCard
              title="Billing Transactions"
              value={metrics?.billing?.totalTransactions ?? '—'}
              icon={CheckCircle2}
              variant="success"
            />
          </>
        ) : role === 'Pharmacist' ? (
          <>
            <StatCard
              title="Billing Transactions"
              value={metrics?.billing?.totalTransactions ?? '—'}
              icon={Pill}
              variant="primary"
            />
            <StatCard
              title="Low Stock Alerts"
              value={metrics?.inventory?.lowStockAlerts ?? '—'}
              icon={AlertTriangle}
              variant="danger"
              subtitle="Action required in Inventory"
            />
            <StatCard
              title="Revenue Paid Tx"
              value={metrics?.billing?.paidTransactions ?? '—'}
              icon={DollarSign}
              variant="success"
            />
          </>
        ) : role === 'StoreManager' ? (
          <>
            {/* Store Manager's job is stock and procurement, not OPD/IPD — so
                this dashboard shows the four numbers its own welcome banner
                already talks about, instead of the generic hospital tiles
                that were showing here before (Total OPD Visits, Active
                Admissions) and meant nothing to this role. */}
            <StatCard
              title="Low Stock Alerts"
              value={metrics?.inventory?.lowStockAlerts ?? '—'}
              icon={AlertTriangle}
              variant="danger"
              subtitle="Reorder required"
            />
            <StatCard
              title="Quarantined Batches"
              value={metrics?.inventory?.quarantinedBatches ?? '—'}
              icon={PackageX}
              variant="warning"
              subtitle="Expired / set aside"
            />
            <StatCard
              title="Requisitions Pending Approval"
              value={metrics?.procurement?.pendingRequisitions ?? '—'}
              icon={ClipboardList}
              variant="info"
            />
            <StatCard
              title="Open Purchase Orders"
              value={metrics?.procurement?.openPurchaseOrders ?? '—'}
              icon={Truck}
              variant="success"
            />
          </>
        ) : role === 'ProcurementOfficer' ? (
          <>
            {/* Same reasoning as Store Manager — a Procurement Officer never
                touches OPD/IPD, so their numbers are Supply Chain ones. */}
            <StatCard
              title="Requisitions Awaiting Approval"
              value={metrics?.procurement?.pendingRequisitions ?? '—'}
              icon={ClipboardList}
              variant="warning"
              subtitle="Needs your decision"
            />
            <StatCard
              title="Approved Requisitions"
              value={metrics?.procurement?.approvedRequisitions ?? '—'}
              icon={CheckCircle2}
              variant="info"
              subtitle="Ready to become a PO"
            />
            <StatCard
              title="Open Purchase Orders"
              value={metrics?.procurement?.openPurchaseOrders ?? '—'}
              icon={Truck}
              variant="success"
            />
            <StatCard
              title="Low Stock Alerts"
              value={metrics?.inventory?.lowStockAlerts ?? '—'}
              icon={AlertTriangle}
              variant="danger"
              subtitle="May need a new requisition"
            />
          </>
        ) : role === 'Nurse' ? (
          <>
            <StatCard
              title="Active Admissions"
              value={metrics?.ipd?.activeAdmissions ?? '—'}
              icon={Users}
              variant="primary"
            />
            <StatCard
              title="Available Beds"
              value={metrics?.ipd?.availableBeds ?? '—'}
              icon={BedDouble}
              variant="success"
            />
            <StatCard
              title="Occupied Beds"
              value={metrics?.ipd?.occupiedBeds ?? '—'}
              icon={Building}
              variant="info"
            />
            <StatCard
              title="Bed Occupancy"
              value={metrics?.ipd ? `${metrics.ipd.bedOccupancyRate}%` : '—'}
              icon={TrendingUp}
              variant="warning"
            />
          </>
        ) : role === 'Reception' ? (
          <>
            <StatCard
              title="Today's OPD Visits"
              value={metrics?.opd?.totalVisits ?? '—'}
              icon={Stethoscope}
              variant="primary"
            />
            <StatCard
              title="Waiting Queue"
              value={metrics?.opd ? `${metrics.opd.waitingQueue} Patients` : '—'}
              icon={Clock}
              variant="warning"
            />
            <StatCard
              title="Receipts Issued"
              value={metrics?.billing?.totalTransactions ?? '—'}
              icon={ReceiptText}
              variant="success"
            />
            <StatCard
              title="Beds Available"
              value={metrics?.ipd?.availableBeds ?? '—'}
              icon={BedDouble}
              variant="info"
              subtitle="For admission referral"
            />
          </>
        ) : role === 'AdmissionDesk' ? (
          <>
            <StatCard
              title="Available Beds"
              value={metrics?.ipd?.availableBeds ?? '—'}
              icon={BedDouble}
              variant="success"
            />
            <StatCard
              title="Occupied Beds"
              value={metrics?.ipd?.occupiedBeds ?? '—'}
              icon={Building}
              variant="info"
            />
            <StatCard
              title="Active Admissions"
              value={metrics?.ipd?.activeAdmissions ?? '—'}
              icon={Users}
              variant="primary"
            />
            <StatCard
              title="Bed Occupancy"
              value={metrics?.ipd ? `${metrics.ipd.bedOccupancyRate}%` : '—'}
              icon={TrendingUp}
              variant="warning"
            />
          </>
        ) : role === 'DataEntryOperator' ? (
          <>
            <StatCard
              title="Total Employees"
              value={metrics?.staff?.totalEmployees ?? '—'}
              icon={UserCog}
              variant="primary"
            />
            <StatCard
              title="Added Today"
              value={metrics?.staff?.employeesAddedToday ?? '—'}
              icon={UserPlus}
              variant="success"
            />
            <StatCard
              title="Today's OPD Visits"
              value={metrics?.opd?.totalVisits ?? '—'}
              icon={Stethoscope}
              variant="info"
            />
            <StatCard
              title="Waiting Queue"
              value={metrics?.opd ? `${metrics.opd.waitingQueue} Patients` : '—'}
              icon={Clock}
              variant="warning"
            />
          </>
        ) : (
          <>
            <StatCard
              title="Total OPD Visits"
              value={metrics?.opd?.totalVisits ?? '—'}
              icon={Users}
              variant="primary"
            />
            <StatCard
              title="Active Admissions"
              value={metrics?.ipd?.activeAdmissions ?? '—'}
              icon={Building}
              variant="info"
              subtitle={metrics?.ipd ? `${metrics.ipd.bedOccupancyRate}% bed occupancy` : undefined}
            />
            <StatCard
              title="Low Stock Items"
              value={metrics?.inventory?.lowStockAlerts ?? '—'}
              icon={AlertTriangle}
              variant="danger"
              subtitle="Reorder required"
            />
            <StatCard
              title="Paid Ledger Tx"
              value={metrics?.billing?.paidTransactions ?? '—'}
              icon={TrendingUp}
              variant="success"
            />
          </>
        )}
      </div>

      {/* Ward Category Distribution — real active-admission breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card p-5 flex flex-col justify-between lg:col-span-1">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="text-base font-bold text-[var(--color-text-primary)]">
                Ward Category Distribution
              </h3>
              <p className="text-xs text-[var(--color-text-secondary)]">
                Active admissions by eligibility category
              </p>
            </div>
            <Badge variant="neutral">Live</Badge>
          </div>

          {!metrics?.ipd || metrics.ipd.categorySplit.length === 0 ? (
            <p className="text-xs text-[var(--color-text-tertiary)] py-8 text-center">
              {metrics ? 'No active admissions to chart.' : 'Loading...'}
            </p>
          ) : (
            <>
              <div className="h-52 w-full my-2">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={metrics.ipd.categorySplit}
                      innerRadius={50}
                      outerRadius={75}
                      paddingAngle={4}
                      dataKey="count"
                      nameKey="category"
                    >
                      {metrics.ipd.categorySplit.map((item, idx) => (
                        <Cell key={item.category || String(idx)} fill={CATEGORY_COLORS[idx % CATEGORY_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="space-y-1.5 pt-2 border-t border-[var(--color-border)]">
                {metrics.ipd.categorySplit.map((item, idx) => {
                  const total = metrics.ipd.categorySplit.reduce((sum, c) => sum + c.count, 0);
                  const pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
                  return (
                    <div key={item.category} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-2 text-[var(--color-text-secondary)]">
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: CATEGORY_COLORS[idx % CATEGORY_COLORS.length] }}
                        />
                        Category {item.category}
                      </span>
                      <span className="font-semibold text-[var(--color-text-primary)]">
                        {item.count} ({pct}%)
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
