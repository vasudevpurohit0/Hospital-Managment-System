import React from 'react';
import { Badge } from '../components/ui/Badge';
import { PatientLookupResponse } from '../api/patient-lookup.api';

interface PatientMasterProps {
  patientData: PatientLookupResponse;
  onClose?: () => void;
}

export const PatientWorkspace: React.FC<PatientMasterProps> = ({ patientData }) => {
  const [activeTab, setActiveTab] = React.useState<'overview' | 'timeline' | 'prescriptions'>(
    'overview',
  );

  const { employee, historySummary, openPrescriptions, openVisit } = patientData;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Sticky Patient Master Banner */}
      <div className="card p-6 bg-gradient-to-r from-primary-900 via-primary-800 to-primary-900 text-white border-none space-y-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-white/10 border-2 border-white/20 flex items-center justify-center text-xl font-bold text-white">
              {employee.name
                .split(' ')
                .map((n) => n.charAt(0))
                .slice(0, 2)
                .join('')}
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-bold">{employee.name}</h1>
                <Badge variant={openVisit ? 'warning' : 'success'}>
                  {openVisit ? 'Open Visit In Progress' : 'Active Patient'}
                </Badge>
              </div>
              <p className="text-xs text-primary-200/80 mt-1">
                {employee.department} • {employee.employmentType} (ESIC{' '}
                {employee.eligibilityCategory})
              </p>
              <div className="flex items-center gap-4 text-xs font-mono mt-2 text-secondary-300">
                <span>UHID: {employee.uid}</span>
                <span>Employee ID: {employee.employeeId}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="p-3 bg-white/10 rounded-xl text-right">
              <span className="text-[10px] text-primary-200/70 block uppercase">Post / Grade</span>
              <span className="text-xs font-bold">
                {employee.post} ({employee.grade})
              </span>
            </div>
          </div>
        </div>

        {/* Tab Header */}
        <div className="flex border-t border-white/10 pt-4 gap-6 text-sm">
          {[
            { id: 'overview', label: 'Overview & Demographics' },
            { id: 'timeline', label: 'Visit History' },
            { id: 'prescriptions', label: 'Active Prescriptions' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`pb-2 border-b-2 font-medium transition-colors ${
                activeTab === tab.id
                  ? 'border-secondary-400 text-white font-bold'
                  : 'border-transparent text-primary-200/70 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Contents */}
      {activeTab === 'overview' && (
        <div className="card p-5 space-y-3">
          <h3 className="font-bold text-base text-[var(--color-text-primary)] border-b pb-2">
            Demographic Profile
          </h3>
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <span className="text-[var(--color-text-secondary)]">Full Name:</span>{' '}
              <p className="font-semibold text-sm">{employee.name}</p>
            </div>
            <div>
              <span className="text-[var(--color-text-secondary)]">Employee ID:</span>{' '}
              <p className="font-semibold text-sm font-mono">{employee.employeeId}</p>
            </div>
            <div>
              <span className="text-[var(--color-text-secondary)]">Department:</span>{' '}
              <p className="font-semibold text-sm">{employee.department}</p>
            </div>
            <div>
              <span className="text-[var(--color-text-secondary)]">Employment Type:</span>{' '}
              <p className="font-semibold text-sm">{employee.employmentType}</p>
            </div>
            <div>
              <span className="text-[var(--color-text-secondary)]">Eligibility Category:</span>{' '}
              <p className="font-semibold text-sm">{employee.eligibilityCategory}</p>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'timeline' && (
        <div className="card p-6 space-y-6">
          <h3 className="font-bold text-base text-[var(--color-text-primary)] border-b pb-2">
            Visit History
          </h3>
          {historySummary.length === 0 ? (
            <p className="text-sm text-[var(--color-text-tertiary)]">
              No prior visits on record for this patient.
            </p>
          ) : (
            <div className="relative pl-6 space-y-6 border-l-2 border-primary-200">
              {historySummary.map((visit) => (
                <div key={visit.visitId} className="relative">
                  <div className="absolute -left-[31px] top-0.5 w-4 h-4 rounded-full bg-primary-500 border-2 border-white" />
                  <span className="text-xs font-mono text-[var(--color-text-tertiary)]">
                    {visit.date}
                  </span>
                  <h4 className="text-sm font-bold text-[var(--color-text-primary)]">
                    {visit.type} Visit — {visit.status}
                  </h4>
                  {visit.diagnosis && (
                    <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                      {visit.diagnosis}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'prescriptions' && (
        <div className="card p-6 space-y-4">
          <h3 className="font-bold text-base text-[var(--color-text-primary)] border-b pb-2">
            Active Prescriptions
          </h3>
          {openPrescriptions.length === 0 ? (
            <p className="text-sm text-[var(--color-text-tertiary)]">
              No open prescriptions for this patient.
            </p>
          ) : (
            <div className="space-y-3">
              {openPrescriptions.map((rx) => {
                const status = (rx as { status?: string }).status;
                const items = (rx as { items?: { medicineName: string; dose: string }[] }).items;
                return (
                  <div
                    key={(rx as { id: string }).id}
                    className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] text-xs"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold">Prescription</span>
                      {status && <Badge variant="neutral">{status}</Badge>}
                    </div>
                    {items?.map((item, i) => (
                      <p key={i} className="text-[var(--color-text-secondary)]">
                        {item.medicineName} — {item.dose}
                      </p>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
