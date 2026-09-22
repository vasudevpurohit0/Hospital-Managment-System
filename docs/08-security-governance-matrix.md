# ESIC Security Governance, RBAC Matrix & Disaster Recovery Runbook

> **Correction (2026-09-22 independent security audit):** this document previously listed `GET /api/auth/csrf-token` as a real, universally-accessible endpoint. It does not exist — confirmed via both source (`security.middleware.ts`'s CSRF logic was deliberately *removed*, not implemented, per that file's own comment explaining why Bearer-token auth doesn't need it) and a live `404` against the deployed API. The row below has been removed. The Backup/Recovery and Incident Response sections further down describe an *intended* operational process that could not be corroborated against anything in this repository (backup schedules and incident tooling may legitimately live outside version control, e.g. in Railway's own configuration) — treat those sections as a target policy to verify against actual infrastructure, not a confirmed-implemented control, until someone checks and updates this note.

---

## 1. Role-by-Endpoint Permission Matrix (FR-SEC-01 - FR-SEC-07)

The table below defines the authoritative Access Control Matrix across all 10 system roles and key API route groups. Unauthorized cross-role access is rejected with `403 Forbidden` at the NestJS `RbacGuard` layer.

| Route Group / Feature | Super Admin | Administrator | Doctor | Nurse | Pharmacist | Store Manager | Procurement Officer | Reception | DEO | Patient / User |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `GET /api/branding` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `PUT /api/branding` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `POST /api/employees` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| `GET /api/patients/lookup` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ |
| `POST /api/visits` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| `GET /api/opd-visits/queue` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| `POST /api/prescriptions` | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `POST /api/prescriptions/:id/sign` | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `GET /api/pharmacy/queue` | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `POST /api/pharmacy/dispense` | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `GET /api/inventory/medicines` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `POST /api/inventory/batches/:id/dispose` | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `POST /api/procurement/requisitions` | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `POST /api/procurement/requisitions/:id/approve` | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `POST /api/procurement/purchase-orders` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| `GET /api/billing/transactions` | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `GET /api/dashboard/summary` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |

---

## 2. Postgres Backup & Recovery Runbook

### Automated Backup Schedule
- **Full Backup**: Daily at 01:00 AM UTC via `pg_dump`.
- **WAL Archiving**: Continuous point-in-time recovery (PITR) logging.

### Restore Verification Command
```bash
# 1. Create target recovery database
createdb -h localhost -U postgres esic_recovery_db

# 2. Restore full backup archive
pg_restore -h localhost -U postgres -d esic_recovery_db --clean --if-exists ./backups/esic_production_latest.dump

# 3. Verify data integrity
psql -h localhost -U postgres -d esic_recovery_db -c "SELECT COUNT(*) FROM users; SELECT COUNT(*) FROM prescriptions;"
```

---

## 3. Security Incident Response Plan (IRP)

### Severity Matrix & SLAs
- **P1 (Critical - Active Data Breach / Total Outage)**: Response SLA < 15 mins. Escalation to Chief Information Security Officer (CISO) and ESIC Cyber Cell.
- **P2 (High - Unauthorized Access Attempt / Unpatched CVE)**: Response SLA < 1 hour. Immediate account lockout and firewall mitigation.
- **P3 (Medium - Minor Header Misconfiguration)**: Response SLA < 24 hours. Patch in next deployment cycle.
- **P4 (Low - Audit Log Discrepancy)**: Response SLA < 72 hours. Routine investigation.
