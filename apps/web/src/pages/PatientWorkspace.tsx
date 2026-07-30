import React from 'react';
import { Badge } from '../components/ui/Badge';

interface PatientMasterProps {
  patientId?: string;
  onClose?: () => void;
}

export const PatientWorkspace: React.FC<PatientMasterProps> = () => {
  const [activeTab, setActiveTab] = React.useState<
    'overview' | 'timeline' | 'vitals' | 'prescriptions' | 'billing'
  >('overview');

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Sticky Patient Master Banner */}
      <div className="card p-6 bg-gradient-to-r from-primary-900 via-primary-800 to-primary-900 text-white border-none space-y-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-white/10 border-2 border-white/20 flex items-center justify-center text-xl font-bold text-white">
              RK
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-bold">Rahul Kumar</h1>
                <Badge variant="success">Active Patient</Badge>
              </div>
              <p className="text-xs text-primary-200/80 mt-1">
                Male • 42 yrs • Blood Group: B+ • Insurance: ESIC Covered (100%)
              </p>
              <div className="flex items-center gap-4 text-xs font-mono mt-2 text-secondary-300">
                <span>UHID: ESIC-MH-001042</span>
                <span>IP No: 1234567890</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="p-3 bg-white/10 rounded-xl text-right">
              <span className="text-[10px] text-primary-200/70 block uppercase">
                Primary Specialty
              </span>
              <span className="text-xs font-bold">General Medicine</span>
            </div>
          </div>
        </div>

        {/* Tab Header */}
        <div className="flex border-t border-white/10 pt-4 gap-6 text-sm">
          {[
            { id: 'overview', label: 'Overview & Demographics' },
            { id: 'timeline', label: 'Patient Journey Timeline' },
            { id: 'vitals', label: 'Vitals & EHR' },
            { id: 'prescriptions', label: 'Prescriptions History' },
            { id: 'billing', label: 'Billing & Ledger' },
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="card p-5 space-y-3 md:col-span-2">
            <h3 className="font-bold text-base text-[var(--color-text-primary)] border-b pb-2">
              Demographic Profile
            </h3>
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <span className="text-[var(--color-text-secondary)]">Full Name:</span>{' '}
                <p className="font-semibold text-sm">Rahul Kumar</p>
              </div>
              <div>
                <span className="text-[var(--color-text-secondary)]">Labour Dept ID:</span>{' '}
                <p className="font-semibold text-sm font-mono">EMP-883920</p>
              </div>
              <div>
                <span className="text-[var(--color-text-secondary)]">Employment Status:</span>{' '}
                <p className="font-semibold text-sm">PERMANENT (Covered)</p>
              </div>
              <div>
                <span className="text-[var(--color-text-secondary)]">Contact Phone:</span>{' '}
                <p className="font-semibold text-sm">+91 98765 43210</p>
              </div>
              <div>
                <span className="text-[var(--color-text-secondary)]">Emergency Contact:</span>{' '}
                <p className="font-semibold text-sm">Sunita Devi (Wife)</p>
              </div>
              <div>
                <span className="text-[var(--color-text-secondary)]">Residential Address:</span>{' '}
                <p className="font-semibold text-sm">Sector 12, Dwarka, New Delhi</p>
              </div>
            </div>
          </div>

          <div className="card p-5 space-y-4">
            <h3 className="font-bold text-base text-[var(--color-text-primary)] border-b pb-2">
              Allergies & Risk
            </h3>
            <div className="p-3 bg-danger-50 text-danger-700 border border-danger-100 rounded-xl text-xs space-y-1">
              <span className="font-bold flex items-center gap-1.5">Known Drug Allergy</span>
              <p>Penicillin, Amoxicillin (Severe Anaphylaxis Risk)</p>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'timeline' && (
        <div className="card p-6 space-y-6">
          <h3 className="font-bold text-base text-[var(--color-text-primary)] border-b pb-2">
            Healthcare Workflow Journey
          </h3>
          <div className="relative pl-6 space-y-6 border-l-2 border-primary-200">
            {[
              {
                time: '10:00 AM',
                title: 'Registration & UID Issued',
                desc: 'Labour Dept ID verified, Permanent Hospital UID card generated.',
              },
              {
                time: '10:15 AM',
                title: 'OPD Queue Token #T-0045',
                desc: 'Assigned to General Medicine OPD Queue.',
              },
              {
                time: '10:30 AM',
                title: 'Vitals Recorded',
                desc: 'Temp: 101°F, BP: 120/80, HR: 88 bpm.',
              },
              {
                time: '10:45 AM',
                title: 'Doctor Consultation Completed',
                desc: 'Diagnosed with Acute URTI. Rx created and signed by Dr. Sharma.',
              },
              {
                time: '11:15 AM',
                title: 'Pharmacy FEFO Dispense',
                desc: 'Medicines dispensed under ESIC benefit coverage.',
              },
            ].map((step, idx) => (
              <div key={idx} className="relative">
                <div className="absolute -left-[31px] top-0.5 w-4 h-4 rounded-full bg-primary-500 border-2 border-white" />
                <span className="text-xs font-mono text-[var(--color-text-tertiary)]">
                  {step.time}
                </span>
                <h4 className="text-sm font-bold text-[var(--color-text-primary)]">{step.title}</h4>
                <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
