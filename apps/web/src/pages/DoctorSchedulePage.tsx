import React, { useState, useMemo } from 'react';
import { Clock, Calendar, Stethoscope } from 'lucide-react';
import { Badge } from '../components/ui/Badge';

const DOCTOR_SCHEDULE = [
  { id: 1, name: 'Dr. Ramesh Sharma', specialty: 'General Physician', experience: '15 Years', timing: '09:00 AM - 01:00 PM' },
  { id: 2, name: 'Dr. Ankit Verma', specialty: 'General Physician', experience: '10 Years', timing: '02:00 PM - 06:00 PM' },
  { id: 3, name: 'Dr. Anita Desai', specialty: 'Cardiologist', experience: '12 Years', timing: '10:00 AM - 02:00 PM' },
  { id: 4, name: 'Dr. Sanjay Mehra', specialty: 'Cardiologist', experience: '18 Years', timing: '03:00 PM - 07:00 PM' },
  { id: 5, name: 'Dr. Vikram Singh', specialty: 'Orthopedics', experience: '8 Years', timing: '09:00 AM - 01:00 PM, 04:00 PM - 07:00 PM' },
  { id: 6, name: 'Dr. Sunita Rao', specialty: 'Pediatrician', experience: '20 Years', timing: '08:00 AM - 12:00 PM' },
  { id: 7, name: 'Dr. Manish Gupta', specialty: 'Neurologist', experience: '10 Years', timing: '02:00 PM - 06:00 PM' },
  { id: 8, name: 'Dr. Priya Patel', specialty: 'Dermatologist', experience: '5 Years', timing: '11:00 AM - 03:00 PM' },
];

export const DoctorSchedulePage: React.FC = () => {
  const [filterSpecialty, setFilterSpecialty] = useState<string>('All');

  const specialties = useMemo(() => {
    const specs = Array.from(new Set(DOCTOR_SCHEDULE.map(d => d.specialty)));
    specs.sort();
    return ['All', ...specs];
  }, []);

  const groupedDoctors = useMemo(() => {
    const filtered = DOCTOR_SCHEDULE.filter(
      doc => filterSpecialty === 'All' || doc.specialty === filterSpecialty
    );

    const groups: Record<string, typeof DOCTOR_SCHEDULE> = {};
    filtered.forEach(doc => {
      if (!groups[doc.specialty]) {
        groups[doc.specialty] = [];
      }
      groups[doc.specialty].push(doc);
    });
    return groups;
  }, [filterSpecialty]);

  return (
    <div className="space-y-6 animate-fade-in pb-12 max-w-5xl">
      <div className="card p-6 flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Calendar className="w-6 h-6 text-primary-600" />
            Doctor Schedule
          </h1>
          <p className="text-[var(--color-text-secondary)] text-sm mt-1">
            View available doctors grouped by specialty
          </p>
        </div>

        <div className="flex items-center gap-3">
          <label className="text-sm font-semibold text-[var(--color-text-secondary)] whitespace-nowrap">
            Filter Specialty:
          </label>
          <select
            value={filterSpecialty}
            onChange={(e) => setFilterSpecialty(e.target.value)}
            className="input text-sm py-2"
          >
            {specialties.map(spec => (
              <option key={spec} value={spec}>{spec}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-8">
        {Object.entries(groupedDoctors).map(([specialty, doctors]) => (
          <div key={specialty} className="space-y-4">
            <div className="flex items-center gap-2 border-b-2 border-primary-100 dark:border-primary-900 pb-2">
              <Stethoscope className="w-5 h-5 text-primary-500" />
              <h2 className="text-lg font-bold text-primary-900 dark:text-primary-100">
                {specialty}
              </h2>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {doctors.map(doc => (
                <div
                  key={doc.id}
                  className="card p-4 hover:shadow-md transition-shadow border-l-4 border-primary-500 flex flex-col justify-between h-full"
                >
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-sm font-bold text-[var(--color-text-primary)]">{doc.name}</h3>
                      <p className="text-[11px] text-[var(--color-text-tertiary)] uppercase tracking-wider font-semibold mt-1">
                        {doc.specialty}
                      </p>
                    </div>
                    <Badge variant="neutral">{doc.experience}</Badge>
                  </div>
                  
                  <div className="flex items-center gap-2 pt-3 border-t border-[var(--color-border)] text-xs font-semibold text-[var(--color-text-secondary)]">
                    <Clock className="w-4 h-4 text-amber-500 shrink-0" />
                    <span className="text-amber-800 dark:text-amber-300 leading-tight">
                      {doc.timing}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {Object.keys(groupedDoctors).length === 0 && (
          <div className="card p-12 text-center text-[var(--color-text-tertiary)]">
            No doctors found for the selected filter.
          </div>
        )}
      </div>
    </div>
  );
};
