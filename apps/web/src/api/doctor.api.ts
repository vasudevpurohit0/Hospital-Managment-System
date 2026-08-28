import { apiFetch } from './client';

export interface DoctorProfile {
  id: string;
  name: string;
  department: string;
  specialty: string;
  experience: string;
  timing: string;
  available: boolean;
}

export async function fetchDoctors(): Promise<DoctorProfile[]> {
  const res = await apiFetch('/api/doctors');
  if (!res.ok) throw new Error('Failed to fetch doctors');
  return res.json();
}

export async function createDoctor(data: { name: string; specialty: string; experience: string; timing: string; email: string }): Promise<DoctorProfile> {
  const res = await apiFetch('/api/doctors', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to create doctor');
  return res.json();
}
