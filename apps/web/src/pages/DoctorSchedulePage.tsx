import React, { useState, useMemo, useEffect } from 'react';
import { Clock, Calendar, Stethoscope, Loader2, Plus } from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { fetchDoctors, createDoctor, DoctorProfile } from '../api/doctor.api';

export const DoctorSchedulePage: React.FC = () => {
  const [filterSpecialty, setFilterSpecialty] = useState<string>('All');
  const [doctors, setDoctors] = useState<DoctorProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [newDoc, setNewDoc] = useState({ name: '', email: '', specialty: '', experience: '', timing: '' });

  const loadDoctors = () => {
    setIsLoading(true);
    fetchDoctors()
      .then((data) => {
        setDoctors(data);
        setIsLoading(false);
      })
      .catch((err) => {
        setError(err.message || 'Error loading doctors');
        setIsLoading(false);
      });
  };

  useEffect(() => {
    loadDoctors();
  }, []);

  const handleAddDoctor = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError(null);
    setIsAdding(true);
    try {
      await createDoctor(newDoc);
      setShowAddModal(false);
      setNewDoc({ name: '', email: '', specialty: '', experience: '', timing: '' });
      loadDoctors();
    } catch (err: any) {
      setAddError(err.message || 'Failed to add doctor');
    } finally {
      setIsAdding(false);
    }
  };

  const specialties = useMemo(() => {
    const specs = Array.from(new Set(doctors.map((d: DoctorProfile) => d.specialty)));
    specs.sort();
    return ['All', ...specs];
  }, [doctors]);

  const groupedDoctors = useMemo(() => {
    const filtered = doctors.filter(
      (doc: DoctorProfile) => filterSpecialty === 'All' || doc.specialty === filterSpecialty
    );

    const groups: Record<string, DoctorProfile[]> = {};
    filtered.forEach((doc: DoctorProfile) => {
      if (!groups[doc.specialty]) {
        groups[doc.specialty] = [];
      }
      groups[doc.specialty].push(doc);
    });
    return groups;
  }, [doctors, filterSpecialty]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-6 border-red-500 text-red-500">
        Failed to load doctor schedule: {error}
      </div>
    );
  }

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
            {specialties.map((spec) => (
              <option key={spec} value={spec}>{spec}</option>
            ))}
          </select>
          <button
            onClick={() => setShowAddModal(true)}
            className="btn btn-primary btn-sm whitespace-nowrap gap-2"
          >
            <Plus className="w-4 h-4" /> Add Doctor
          </button>
        </div>
      </div>

      <div className="space-y-8">
        {Object.entries(groupedDoctors).map(([specialty, docs]) => (
          <div key={specialty} className="space-y-4">
            <div className="flex items-center gap-2 border-b-2 border-primary-100 dark:border-primary-900 pb-2">
              <Stethoscope className="w-5 h-5 text-primary-500" />
              <h2 className="text-lg font-bold text-primary-900 dark:text-primary-100">
                {specialty}
              </h2>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {docs.map((doc: DoctorProfile) => (
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

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="card w-full max-w-md p-6 animate-scale-in">
            <h2 className="text-lg font-bold mb-4">Add New Doctor</h2>
            <form onSubmit={handleAddDoctor} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold mb-1">Name</label>
                <input required type="text" className="input w-full" value={newDoc.name} onChange={e => setNewDoc({...newDoc, name: e.target.value})} placeholder="Dr. John Doe" />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Email</label>
                <input required type="email" className="input w-full" value={newDoc.email} onChange={e => setNewDoc({...newDoc, email: e.target.value})} placeholder="john.doe@esic.gov.in" />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Specialty</label>
                <input required type="text" className="input w-full" value={newDoc.specialty} onChange={e => setNewDoc({...newDoc, specialty: e.target.value})} placeholder="Cardiologist" />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Experience</label>
                <input required type="text" className="input w-full" value={newDoc.experience} onChange={e => setNewDoc({...newDoc, experience: e.target.value})} placeholder="10 Years" />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Timing</label>
                <input required type="text" className="input w-full" value={newDoc.timing} onChange={e => setNewDoc({...newDoc, timing: e.target.value})} placeholder="10:00 AM - 02:00 PM" />
              </div>

              {addError && <div className="text-sm text-red-500 font-semibold">{addError}</div>}
              
              <div className="flex justify-end gap-3 pt-4 border-t border-[var(--color-border)] mt-4">
                <button type="button" onClick={() => setShowAddModal(false)} className="btn btn-secondary">Cancel</button>
                <button type="submit" disabled={isAdding} className="btn btn-primary">{isAdding ? 'Adding...' : 'Add Doctor'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
