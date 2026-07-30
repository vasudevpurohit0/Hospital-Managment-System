import React, { useState, useEffect, useCallback } from 'react';
import {
  fetchFacilityRules,
  updateFacilityRule,
  FacilityEligibilityRuleRecord,
} from '../../api/facility.api';

interface FacilityRulesScreenProps {
  authToken: string;
}

export const FacilityRulesScreen: React.FC<FacilityRulesScreenProps> = ({ authToken }) => {
  const [rules, setRules] = useState<FacilityEligibilityRuleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit Modal State
  const [editingRule, setEditingRule] = useState<FacilityEligibilityRuleRecord | null>(null);
  const [category, setCategory] = useState<'A' | 'B' | 'C' | 'D' | 'CONTRACTUAL'>('C');
  const [wardEligibility, setWardEligibility] = useState('');
  const [room, setRoom] = useState('');
  const [facilityLevel, setFacilityLevel] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadRules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchFacilityRules(authToken);
      setRules(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [authToken]);

  useEffect(() => {
    if (authToken) {
      loadRules();
    }
  }, [authToken, loadRules]);

  const handleEditClick = (rule: FacilityEligibilityRuleRecord) => {
    setEditingRule(rule);
    setCategory(rule.category);
    setWardEligibility(rule.wardEligibility);
    setRoom(rule.room);
    setFacilityLevel(rule.facilityLevel);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRule) return;

    setSubmitting(true);
    setError(null);
    try {
      await updateFacilityRule(
        editingRule.id,
        {
          category,
          wardEligibility: wardEligibility.trim(),
          room: room.trim(),
          facilityLevel: facilityLevel.trim(),
        },
        authToken,
      );
      setEditingRule(null);
      await loadRules();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // Group rules by post / grade to show active ones and version history
  const activeRules = rules.filter((r) => r.active);
  const historyRules = rules.filter((r) => !r.active);

  const getCategoryBadgeClass = (cat: string) => {
    switch (cat) {
      case 'A':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'B':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'C':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'D':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'CONTRACTUAL':
        return 'bg-teal-100 text-teal-800 border-teal-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-gray-200">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight">
            Facility Eligibility Rules
          </h2>
          <p className="text-sm text-gray-500">
            Configure how post / grade mappings resolve to eligible IPD categories and room classes.
          </p>
        </div>
        <button
          onClick={loadRules}
          className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 text-gray-700 bg-white shadow-sm transition-all"
        >
          🔄 Refresh Rules
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg flex items-start">
          <svg
            className="w-5 h-5 mr-2 text-red-500 flex-shrink-0 mt-0.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center items-center py-12">
          <svg
            className="animate-spin h-8 w-8 text-esic-primary"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            ></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          {/* Active Rules Grid */}
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-gray-800">Active Rule Mappings</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {activeRules.map((rule) => {
                const ruleHistory = historyRules.filter(
                  (h) => h.postId === rule.postId && h.gradeId === rule.gradeId,
                );

                return (
                  <div
                    key={rule.id}
                    className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex flex-col justify-between hover:border-gray-200 transition-all"
                  >
                    <div>
                      {/* Top Header */}
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <span className="text-xs font-semibold text-gray-400 block uppercase tracking-wider">
                            Applicable Match
                          </span>
                          <h4 className="font-bold text-lg text-gray-900">
                            {rule.post?.title || rule.postId || 'Any Post'}
                          </h4>
                          {rule.grade && (
                            <span className="text-xs text-gray-600 bg-gray-100 px-2 py-0.5 rounded font-medium mt-1 inline-block">
                              Grade: {rule.grade.payLevel}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center space-x-2">
                          <span
                            className={`px-2.5 py-1 rounded-full text-xs font-bold border ${getCategoryBadgeClass(rule.category)}`}
                          >
                            Category {rule.category}
                          </span>
                          <span className="bg-gray-100 text-gray-600 border border-gray-200 px-2 py-0.5 rounded text-[10px] font-bold">
                            v{rule.version}
                          </span>
                        </div>
                      </div>

                      {/* Rule details */}
                      <div className="grid grid-cols-3 gap-2 py-3 border-t border-b border-gray-50 my-3 text-xs">
                        <div>
                          <span className="text-gray-400 block">Ward Type</span>
                          <span className="font-semibold text-gray-800">
                            {rule.wardEligibility}
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-400 block">Room Class</span>
                          <span className="font-semibold text-gray-800">{rule.room}</span>
                        </div>
                        <div>
                          <span className="text-gray-400 block">Facility Level</span>
                          <span className="font-semibold text-gray-800">{rule.facilityLevel}</span>
                        </div>
                      </div>
                    </div>

                    {/* Footer Actions */}
                    <div className="flex items-center justify-between mt-3 pt-2">
                      <span className="text-[11px] text-gray-400">
                        {ruleHistory.length > 0
                          ? `Has ${ruleHistory.length} previous version(s)`
                          : 'Original configuration'}
                      </span>
                      <button
                        onClick={() => handleEditClick(rule)}
                        className="px-3.5 py-1.5 bg-esic-primary hover:bg-esic-primary-dark text-white rounded-lg text-xs font-semibold shadow-sm transition-all"
                      >
                        ✏️ Edit Rule
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Version History Table */}
          {historyRules.length > 0 && (
            <div className="space-y-4 pt-4 border-t border-gray-200">
              <h3 className="text-lg font-bold text-gray-800">
                Historical Audit Records (Inactive Rules)
              </h3>
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50 text-gray-500 uppercase tracking-wider text-xs font-semibold">
                    <tr>
                      <th className="px-6 py-3 text-left">Post / Grade</th>
                      <th className="px-6 py-3 text-left">Version</th>
                      <th className="px-6 py-3 text-left">Category</th>
                      <th className="px-6 py-3 text-left">Ward Eligibility</th>
                      <th className="px-6 py-3 text-left">Room</th>
                      <th className="px-6 py-3 text-left">Facility Level</th>
                      <th className="px-6 py-3 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-gray-700 bg-white">
                    {historyRules.map((hRule) => (
                      <tr key={hRule.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 font-semibold text-gray-900">
                          {hRule.post?.title || 'Any Post'}
                          {hRule.grade && (
                            <span className="text-[10px] block text-gray-500 font-normal">
                              Grade: {hRule.grade.payLevel}
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 font-mono text-xs">v{hRule.version}</td>
                        <td className="px-6 py-4">
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-semibold border ${getCategoryBadgeClass(hRule.category)}`}
                          >
                            {hRule.category}
                          </span>
                        </td>
                        <td className="px-6 py-4">{hRule.wardEligibility}</td>
                        <td className="px-6 py-4">{hRule.room}</td>
                        <td className="px-6 py-4">{hRule.facilityLevel}</td>
                        <td className="px-6 py-4 text-xs font-semibold text-amber-600">
                          ⚠️ Superceded (Inactive)
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Edit Rule Modal Dialog */}
      {editingRule && (
        <div className="fixed inset-0 bg-gray-900/60 flex items-center justify-center p-4 z-50 backdrop-blur-sm transition-opacity">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full border border-gray-100 overflow-hidden transform scale-100 transition-transform">
            <div className="bg-esic-primary text-white px-6 py-4">
              <h3 className="font-bold text-lg">Modify Facility Rule</h3>
              <p className="text-xs text-blue-100">
                Updating {editingRule.post?.title || 'this rule'} will automatically create version{' '}
                {editingRule.version + 1}.
              </p>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4">
              {/* Category Dropdown */}
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">
                  Category Classification
                </label>
                <select
                  value={category}
                  onChange={(e) =>
                    setCategory(e.target.value as 'A' | 'B' | 'C' | 'D' | 'CONTRACTUAL')
                  }
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-esic-primary focus:border-transparent transition-all"
                >
                  <option value="A">A — Senior Officers</option>
                  <option value="B">B — Officers</option>
                  <option value="C">C — Clerks & Assistants</option>
                  <option value="D">D — Support Staff</option>
                  <option value="CONTRACTUAL">Contractual — Contractual Employees</option>
                </select>
              </div>

              {/* Ward Eligibility */}
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">
                  Ward Eligibility
                </label>
                <input
                  type="text"
                  required
                  value={wardEligibility}
                  onChange={(e) => setWardEligibility(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-esic-primary focus:border-transparent transition-all"
                />
              </div>

              {/* Room */}
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">
                  Room Class
                </label>
                <input
                  type="text"
                  required
                  value={room}
                  onChange={(e) => setRoom(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-esic-primary focus:border-transparent transition-all"
                />
              </div>

              {/* Facility Level */}
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">
                  Facility Level
                </label>
                <input
                  type="text"
                  required
                  value={facilityLevel}
                  onChange={(e) => setFacilityLevel(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-esic-primary focus:border-transparent transition-all"
                />
              </div>

              {/* Actions */}
              <div className="pt-4 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setEditingRule(null)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 text-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 bg-esic-secondary hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold shadow-sm transition-all"
                >
                  {submitting ? 'Creating Version...' : 'Save New Version'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
