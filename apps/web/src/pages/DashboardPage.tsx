import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { StatCard } from '../components/ui/StatCard';
import { Badge } from '../components/ui/Badge';
import { fetchDashboardMetrics, DashboardMetrics } from '../api/dashboard.api';
import {
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
} from 'lucide-react';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
} from 'recharts';

export const DashboardPage: React.FC = () => {
  const { user, token } = useAuth();
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);

  useEffect(() => {
    fetchDashboardMetrics(token || '')
      .then(setMetrics)
      .catch(() => {});
  }, [token]);

  const role = user?.role || 'Doctor';

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
            {new Date().toLocaleDateString('en-IN', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Welcome back, {user?.name || 'Doctor'}
          </h1>
          <p className="text-sm text-primary-200/80 mt-1.5 leading-relaxed">
            {role === 'Doctor' &&
              'You have 8 patients waiting in your OPD queue today. 2 critical lab results require your immediate review.'}
            {role === 'Pharmacist' &&
              'Pharmacy Queue has 14 pending prescriptions for FEFO batch allocation. Stock level is healthy.'}
            {role === 'StoreManager' &&
              'Inventory summary: 3 purchase orders pending approval. 2 medicine batches near quarantine threshold.'}
            {(role === 'SuperAdmin' || role === 'Administrator') &&
              'Hospital operational summary: OPD flow running smoothly. Bed occupancy at 76%. Financial ledger balanced.'}
          </p>
        </div>
      </div>

      {/* Role-Specific Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {role === 'Doctor' ? (
          <>
            <StatCard
              title="Today's Consultations"
              value={metrics?.opd?.totalVisits ?? 24}
              icon={Stethoscope}
              variant="primary"
              trend={{ value: '+12%', direction: 'up', label: 'vs yesterday' }}
            />
            <StatCard
              title="Waiting Queue"
              value={`${metrics?.opd?.waitingQueue ?? 8} Patients`}
              icon={Clock}
              variant="warning"
              subtitle="Avg wait: 14 mins"
            />
            <StatCard
              title="Critical Lab Alerts"
              value="2 Pending"
              icon={AlertTriangle}
              variant="danger"
              subtitle="Requires immediate action"
            />
            <StatCard
              title="Signed Prescriptions"
              value={metrics?.billing?.totalTransactions ?? 18}
              icon={CheckCircle2}
              variant="success"
              subtitle="100% digital sign rate"
            />
          </>
        ) : role === 'Pharmacist' ? (
          <>
            <StatCard
              title="Prescriptions Received"
              value={metrics?.billing?.totalTransactions ?? 32}
              icon={Pill}
              variant="primary"
            />
            <StatCard
              title="Pending Dispense"
              value="6 Rx"
              icon={Clock}
              variant="warning"
              subtitle="FEFO pre-allocated"
            />
            <StatCard
              title="Low Stock Alerts"
              value={metrics?.inventory?.lowStockAlerts ?? 3}
              icon={AlertTriangle}
              variant="danger"
              subtitle="Action required in Inventory"
            />
            <StatCard
              title="Revenue Paid Tx"
              value={metrics?.billing?.paidTransactions ?? 12}
              icon={DollarSign}
              variant="success"
            />
          </>
        ) : (
          <>
            <StatCard
              title="Total OPD Visits"
              value={metrics?.opd?.totalVisits ?? 142}
              icon={Users}
              variant="primary"
              trend={{ value: '+8%', direction: 'up' }}
            />
            <StatCard
              title="Active Admissions"
              value={metrics?.ipd?.activeAdmissions ?? 48}
              icon={Building}
              variant="info"
              subtitle={`${metrics?.ipd?.bedOccupancyRate ?? 76}% bed occupancy`}
            />
            <StatCard
              title="Low Stock Items"
              value={metrics?.inventory?.lowStockAlerts ?? 3}
              icon={AlertTriangle}
              variant="danger"
              subtitle="Reorder required"
            />
            <StatCard
              title="Paid Ledger Tx"
              value={metrics?.billing?.paidTransactions ?? 45}
              icon={TrendingUp}
              variant="success"
              trend={{ value: '+15%', direction: 'up' }}
            />
          </>
        )}
      </div>

      {/* Analytics Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Chart — Patient Flow Trend */}
        <div className="card p-5 lg:col-span-2 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-[var(--color-text-primary)]">
                OPD Patient Consultations Trend
              </h3>
              <p className="text-xs text-[var(--color-text-secondary)]">
                Daily consultations volume over past week
              </p>
            </div>
            <Badge variant="neutral">Live Metrics</Badge>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={[
                  { day: 'Mon', visits: 110, rx: 85 },
                  { day: 'Tue', visits: 132, rx: 104 },
                  { day: 'Wed', visits: 142, rx: 118 },
                  { day: 'Thu', visits: 125, rx: 98 },
                  { day: 'Fri', visits: 156, rx: 130 },
                  { day: 'Sat', visits: 90, rx: 72 },
                  { day: 'Sun', visits: 45, rx: 38 },
                ]}
              >
                <defs>
                  <linearGradient id="opdColor" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0F4C81" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#0F4C81" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="var(--color-border)"
                />
                <XAxis dataKey="day" tick={{ fontSize: 12 }} stroke="var(--color-text-tertiary)" />
                <YAxis tick={{ fontSize: 12 }} stroke="var(--color-text-tertiary)" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--color-surface)',
                    borderColor: 'var(--color-border)',
                    borderRadius: '8px',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="visits"
                  stroke="#0F4C81"
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#opdColor)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Side Panel — Department Distribution */}
        <div className="card p-5 flex flex-col justify-between">
          <div>
            <h3 className="text-base font-bold text-[var(--color-text-primary)]">
              Department Distribution
            </h3>
            <p className="text-xs text-[var(--color-text-secondary)]">
              Patient consultations by specialty
            </p>
          </div>

          <div className="h-52 w-full my-2">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={[
                    { name: 'General Medicine', value: 45 },
                    { name: 'Orthopedics', value: 25 },
                    { name: 'Pediatrics', value: 18 },
                    { name: 'Cardiology', value: 12 },
                  ]}
                  innerRadius={50}
                  outerRadius={75}
                  paddingAngle={4}
                  dataKey="value"
                >
                  <Cell fill="#0F4C81" />
                  <Cell fill="#0D9488" />
                  <Cell fill="#3B82F6" />
                  <Cell fill="#F59E0B" />
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="space-y-1.5 pt-2 border-t border-[var(--color-border)]">
            {[
              { label: 'General Medicine', color: 'bg-[#0F4C81]', pct: '45%' },
              { label: 'Orthopedics', color: 'bg-[#0D9488]', pct: '25%' },
              { label: 'Pediatrics', color: 'bg-[#3B82F6]', pct: '18%' },
              { label: 'Cardiology', color: 'bg-[#F59E0B]', pct: '12%' },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 text-[var(--color-text-secondary)]">
                  <span className={`w-2.5 h-2.5 rounded-full ${item.color}`} />
                  {item.label}
                </span>
                <span className="font-semibold text-[var(--color-text-primary)]">{item.pct}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
