import React, { useEffect, useState } from 'react';
import { fetchBranding, updateBranding } from '../../api/security.api';
import { fetchHospitalSettings, updateHospitalSettings } from '../../api/hospitalSettings.api';
import { Clock, IndianRupee, Bell, RefreshCw } from 'lucide-react';

const WEEK_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
const DAY_LABELS: Record<(typeof WEEK_DAYS)[number], string> = {
  MON: 'Mon',
  TUE: 'Tue',
  WED: 'Wed',
  THU: 'Thu',
  FRI: 'Fri',
  SAT: 'Sat',
  SUN: 'Sun',
};

interface SystemConfigScreenProps {
  authToken?: string;
  token?: string;
}

export const SystemConfigScreen: React.FC<SystemConfigScreenProps> = ({ authToken, token }) => {
  const activeToken = authToken || token || '';
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Form states
  const [hospitalName, setHospitalName] = useState('');
  const [tagline, setTagline] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#005691');
  const [logoUrl, setLogoUrl] = useState('');

  // Hospital settings form state
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSuccess, setSettingsSuccess] = useState<string | null>(null);
  const [workingHoursStart, setWorkingHoursStart] = useState('09:00');
  const [workingHoursEnd, setWorkingHoursEnd] = useState('17:00');
  const [workingDays, setWorkingDays] = useState<string[]>([]);
  const [currency, setCurrency] = useState('INR');
  const [taxPercent, setTaxPercent] = useState('0');
  const [billingPrefix, setBillingPrefix] = useState('INV');
  const [notifyOnAdmission, setNotifyOnAdmission] = useState(true);
  const [notifyOnDischarge, setNotifyOnDischarge] = useState(true);
  const [notifyOnLowStock, setNotifyOnLowStock] = useState(true);
  const [sendTemporaryPasswordByEmail, setSendTemporaryPasswordByEmail] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchBranding();
      setHospitalName(data.hospitalName);
      setTagline(data.tagline);
      setPrimaryColor(data.primaryColor);
      setLogoUrl(data.logoUrl);
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to load system config');
    } finally {
      setLoading(false);
    }
  };

  const loadSettings = async () => {
    setSettingsLoading(true);
    setSettingsError(null);
    try {
      const data = await fetchHospitalSettings(activeToken);
      setWorkingHoursStart(data.workingHoursStart);
      setWorkingHoursEnd(data.workingHoursEnd);
      setWorkingDays(data.workingDays);
      setCurrency(data.currency);
      setTaxPercent(data.taxPercent);
      setBillingPrefix(data.billingPrefix);
      setNotifyOnAdmission(data.notifyOnAdmission);
      setNotifyOnDischarge(data.notifyOnDischarge);
      setNotifyOnLowStock(data.notifyOnLowStock);
      setSendTemporaryPasswordByEmail(data.sendTemporaryPasswordByEmail);
    } catch (err: unknown) {
      setSettingsError((err as Error).message || 'Failed to load hospital settings');
    } finally {
      setSettingsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await updateBranding({ hospitalName, tagline, primaryColor, logoUrl }, activeToken);
      setSuccessMsg('Branding configuration updated successfully (FR-CFG-01 to FR-CFG-03)!');
      loadData();
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to update branding (SuperAdmin required)');
    } finally {
      setSaving(false);
    }
  };

  const toggleWorkingDay = (day: string) => {
    setWorkingDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsSaving(true);
    setSettingsError(null);
    setSettingsSuccess(null);
    try {
      await updateHospitalSettings(
        {
          workingHoursStart,
          workingHoursEnd,
          workingDays,
          currency,
          taxPercent: Number(taxPercent),
          billingPrefix,
          notifyOnAdmission,
          notifyOnDischarge,
          notifyOnLowStock,
          sendTemporaryPasswordByEmail,
        },
        activeToken,
      );
      setSettingsSuccess('Hospital settings updated successfully.');
      loadSettings();
    } catch (err: unknown) {
      setSettingsError((err as Error).message || 'Failed to update hospital settings');
    } finally {
      setSettingsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 flex flex-col md:flex-row justify-between md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <span>⚙️</span> System Configuration & Security Governance
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Super-Admin Module 14 • Branding Customization (FR-CFG-01), Security Posture &
            Governance Runbooks
          </p>
        </div>
        <div>
          <button
            onClick={loadData}
            className="px-3.5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-all"
          >
            Refresh Config
          </button>
        </div>
      </div>

      {successMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-sm font-semibold flex items-center gap-2">
          <span>✅</span> {successMsg}
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm font-semibold flex items-center gap-2">
          <span>❌</span> {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-100 text-gray-500">
          Loading system configuration...
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Hospital Branding Form */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200 space-y-4">
            <h2 className="text-base font-bold text-gray-900 border-b pb-3 flex items-center justify-between">
              <span>🎨 Hospital Branding & UI Customization</span>
              <span className="text-xs font-semibold text-esic-primary">SuperAdmin Access</span>
            </h2>
            <form onSubmit={handleSaveBranding} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">
                  Hospital Name *
                </label>
                <input
                  type="text"
                  required
                  value={hospitalName}
                  onChange={(e) => setHospitalName(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">
                  Tagline / Motto *
                </label>
                <input
                  type="text"
                  required
                  value={tagline}
                  onChange={(e) => setTagline(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">
                    Primary Color (Hex)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      className="w-8 h-8 rounded border p-0 cursor-pointer"
                    />
                    <input
                      type="text"
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm font-mono"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">
                    Logo Image URL
                  </label>
                  <input
                    type="url"
                    value={logoUrl}
                    onChange={(e) => setLogoUrl(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
              </div>

              {/* Branding Preview */}
              <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 space-y-2">
                <span className="text-[10px] uppercase font-bold text-gray-400 block">
                  Header Branding Preview
                </span>
                <div
                  className="p-3 rounded-lg text-white flex items-center justify-between"
                  style={{ backgroundColor: primaryColor }}
                >
                  <div>
                    <div className="font-bold text-sm">{hospitalName || 'ESIC Hospital'}</div>
                    <div className="text-[11px] opacity-90">{tagline}</div>
                  </div>
                  <div className="text-xs bg-white/20 px-2.5 py-1 rounded font-mono">FR-CFG-01</div>
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2.5 bg-esic-primary hover:bg-esic-primary-dark text-white rounded-lg text-sm font-semibold shadow-sm transition-all"
                >
                  {saving ? 'Saving Config...' : '💾 Save Branding Settings'}
                </button>
              </div>
            </form>
          </div>

          {/* Security Posture & Governance Panel */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200 space-y-4">
            <h2 className="text-base font-bold text-gray-900 border-b pb-3">
              🛡️ Security Posture & Compliance Controls
            </h2>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between">
                <div>
                  <div className="font-bold text-emerald-900">
                    Security Headers Enforcement (FR-SEC-09)
                  </div>
                  <div className="text-emerald-700 text-[11px] mt-0.5">
                    HSTS, CSP, X-Content-Type-Options: nosniff, X-Frame-Options: DENY
                  </div>
                </div>
                <span className="px-2.5 py-1 bg-emerald-600 text-white rounded font-bold">
                  ACTIVE
                </span>
              </div>

              <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl flex items-center justify-between">
                <div>
                  <div className="font-bold text-blue-900">CSRF Token Protection (FR-SEC-08)</div>
                  <div className="text-blue-700 text-[11px] mt-0.5">
                    X-CSRF-Token headers validated on all state-changing routes
                  </div>
                </div>
                <span className="px-2.5 py-1 bg-blue-600 text-white rounded font-bold">
                  ENFORCED
                </span>
              </div>

              <div className="p-3 bg-purple-50 border border-purple-200 rounded-xl flex items-center justify-between">
                <div>
                  <div className="font-bold text-purple-900">
                    MFA & Password Policy (FR-SEC-10, FR-SEC-11)
                  </div>
                  <div className="text-purple-700 text-[11px] mt-0.5">
                    TOTP MFA enabled for SuperAdmin, password lockout after 5 attempts
                  </div>
                </div>
                <span className="px-2.5 py-1 bg-purple-700 text-white rounded font-bold">
                  ENROLLED
                </span>
              </div>

              <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl space-y-2">
                <div className="font-bold text-gray-800">Governance Documentation & Runbooks</div>
                <div className="space-y-1 text-gray-600">
                  <div>
                    📄 <strong>RBAC Matrix</strong>: Documented role-by-endpoint permission table
                    for 10 roles
                  </div>
                  <div>
                    📄 <strong>Backup Runbook</strong>: Postgres dump & recovery verification
                    commands
                  </div>
                  <div>
                    📄 <strong>Incident Response Plan</strong>: Escalation SLAs (P1 &lt; 15 mins) &
                    CISO matrix
                  </div>
                  <div>
                    📄 <strong>Staging Data Masking</strong>: PII synthetic data transformation
                    script
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Hospital Configuration Settings (Phase 9) ── */}
      <div className="card p-6 bg-gradient-to-r from-primary-900 via-primary-800 to-primary-900 text-white border-none flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center text-secondary-300">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Hospital Configuration</h2>
            <p className="text-xs text-primary-200/80 mt-0.5">
              Working hours, billing defaults, and notification toggles for this hospital only.
            </p>
          </div>
        </div>
        <button onClick={loadSettings} className="btn btn-ghost btn-sm text-xs text-primary-200 hover:text-white gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {settingsError && <div className="alert-danger">{settingsError}</div>}
      {settingsSuccess && <div className="alert-success">{settingsSuccess}</div>}

      {settingsLoading ? (
        <p className="text-center text-sm text-[var(--color-text-tertiary)] py-4">Loading hospital settings...</p>
      ) : (
        <form onSubmit={handleSaveSettings} className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="card p-6 space-y-4">
            <h3 className="text-sm font-bold text-[var(--color-text-primary)] flex items-center gap-2 border-b border-[var(--color-border)] pb-3">
              <Clock className="w-4 h-4 text-primary-500" />
              Working Hours
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-[var(--color-text-secondary)]">Opens</label>
                <input
                  type="time"
                  value={workingHoursStart}
                  onChange={(e) => setWorkingHoursStart(e.target.value)}
                  className="input"
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-[var(--color-text-secondary)]">Closes</label>
                <input
                  type="time"
                  value={workingHoursEnd}
                  onChange={(e) => setWorkingHoursEnd(e.target.value)}
                  className="input"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-[var(--color-text-secondary)]">Working Days</label>
              <div className="flex flex-wrap gap-1.5">
                {WEEK_DAYS.map((day) => (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleWorkingDay(day)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                      workingDays.includes(day)
                        ? 'bg-primary-500 text-white border-primary-500'
                        : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)]'
                    }`}
                  >
                    {DAY_LABELS[day]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="card p-6 space-y-4">
            <h3 className="text-sm font-bold text-[var(--color-text-primary)] flex items-center gap-2 border-b border-[var(--color-border)] pb-3">
              <IndianRupee className="w-4 h-4 text-primary-500" />
              Billing & Tax
            </h3>
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-[var(--color-text-secondary)]">Currency</label>
              <input type="text" value={currency} onChange={(e) => setCurrency(e.target.value)} className="input" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-[var(--color-text-secondary)]">Tax Percent (%)</label>
              <input
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={taxPercent}
                onChange={(e) => setTaxPercent(e.target.value)}
                className="input"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-[var(--color-text-secondary)]">Billing Prefix</label>
              <input
                type="text"
                value={billingPrefix}
                onChange={(e) => setBillingPrefix(e.target.value)}
                className="input font-mono"
                placeholder="INV"
              />
            </div>
          </div>

          <div className="card p-6 space-y-4">
            <h3 className="text-sm font-bold text-[var(--color-text-primary)] flex items-center gap-2 border-b border-[var(--color-border)] pb-3">
              <Bell className="w-4 h-4 text-primary-500" />
              Notifications
            </h3>
            <label className="flex items-center justify-between text-sm">
              <span className="text-[var(--color-text-secondary)]">On admission</span>
              <input
                type="checkbox"
                checked={notifyOnAdmission}
                onChange={(e) => setNotifyOnAdmission(e.target.checked)}
              />
            </label>
            <label className="flex items-center justify-between text-sm">
              <span className="text-[var(--color-text-secondary)]">On discharge</span>
              <input
                type="checkbox"
                checked={notifyOnDischarge}
                onChange={(e) => setNotifyOnDischarge(e.target.checked)}
              />
            </label>
            <label className="flex items-center justify-between text-sm">
              <span className="text-[var(--color-text-secondary)]">On low stock</span>
              <input
                type="checkbox"
                checked={notifyOnLowStock}
                onChange={(e) => setNotifyOnLowStock(e.target.checked)}
              />
            </label>
          </div>

          <div className="card p-6 space-y-4">
            <h3 className="text-sm font-bold text-[var(--color-text-primary)] flex items-center gap-2 border-b border-[var(--color-border)] pb-3">
              <Bell className="w-4 h-4 text-primary-500" />
              Staff Account Security
            </h3>
            <label className="flex items-start justify-between gap-3 text-sm">
              <span className="text-[var(--color-text-secondary)]">
                Send temporary password by email
                <span className="block text-[11px] text-[var(--color-text-tertiary)] mt-0.5">
                  Off by default. An account-activation email is always sent regardless of this setting; enabling this
                  also emails the one-time temporary password directly, with a 24-hour expiry warning.
                </span>
              </span>
              <input
                type="checkbox"
                checked={sendTemporaryPasswordByEmail}
                onChange={(e) => setSendTemporaryPasswordByEmail(e.target.checked)}
                className="mt-1"
              />
            </label>
          </div>

          <div className="lg:col-span-3 flex justify-end">
            <button type="submit" disabled={settingsSaving} className="btn btn-primary">
              {settingsSaving ? 'Saving...' : 'Save Hospital Settings'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
