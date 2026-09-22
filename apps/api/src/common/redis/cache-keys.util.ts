// Every cache key is namespaced by environment (so a shared Redis instance
// can never mix dev/staging/prod keys) and by hospitalId (so one tenant can
// never read another tenant's cached data -- see the multi-hospital
// isolation tests for department.service.spec.ts / hospital-settings).
const ENV = process.env.NODE_ENV || 'development';

export const CacheKeys = {
  departments: (hospitalId: string) => `hms:${ENV}:${hospitalId}:departments`,
  hospitalSettings: (hospitalId: string) => `hms:${ENV}:${hospitalId}:hospital-settings`,
};
