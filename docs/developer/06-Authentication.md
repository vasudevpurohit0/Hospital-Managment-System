# 06 — Authentication (VERIFIED)

## Flow

```
LoginPage (identifier + password)
 → POST /api/auth/login  (@Public, LoginDto{identifier,password})
 → AuthService.validateUser: trim identifier → findUnique + role+permissions
   → active? → bcrypt.compare(pass, passwordHash) → user or 401 generic
 → login(): sign access {sub,identifier,roleId,roleName,type:access} 8h (JWT_EXPIRES_IN||'8h')
             sign refresh {sub,identifier,type:refresh} 7d
 → frontend stores {token,user,expiresAt: now+8h} in localStorage `esic-hms-auth`
 → apiFetch attaches `Authorization: Bearer`; 401 clears storage → back to LoginPage
 → POST /api/auth/refresh (@Public, RefreshTokenDto) re-issues access after DB active-check
 → GET /api/auth/me (authenticated) returns profile
```

Files: `src/modules/auth/auth.controller.ts`, `auth.service.ts:24-161`,
`strategies/jwt.strategy.ts`, `guards/jwt-auth.guard.ts`, `dto/login.dto.ts + refresh-token.dto.ts`,
`web/src/hooks/useAuth.ts`, `web/src/api/client.ts + http.ts`.

## Password handling (VERIFIED)

- Hash: `bcryptjs`, cost 10 (`seed.ts` `bcrypt.hash(...,10)`, `doctor.service.ts:64`).
- Compare: `bcrypt.compare`, generic `401 'Invalid credentials…'` on miss/inactive/malformed (no user enumeration).
- Seed passwords (DEV ONLY — predictable, see §23 CRITICAL):
  `SuperAdminSecret123!`, `DoctorPass123!`, `NursePass123!`, `AdmissionPass123!`,
  `AdminPass123!`, `PharmacistPass123!`, `StoreManagerPass123!`, `ProcurementPass123!`,
  `ReceptionPass123!`, `DataEntryPass123!`, `QueueManagerPass123!`, `LabTechPass123!`,
  `PathologistPass123!` (`seed.ts:694-913`).
- Doctor self-onboarding (`DoctorService.createDoctor`, `doctor.service.ts:50-123`):
  random `randomBytes(9).base64url` temp password (previously hardcoded `DoctorPass123!` —
  fixed in code, noted in comment lines 57-62), bcrypt-hashed, returned once to the creating admin,
  never stored/logged in plaintext. Creates `User + Employee(DOC-<localpart>) + DoctorProfile` in one `$transaction`.

## Session behaviour (VERIFIED)

- Access TTL 8h, refresh 7d; frontend mirrors 8h `expiresAt` with 60s expiry poll (`useAuth.ts`).
- `JwtStrategy.validate` reloads user + role + permissions per request — permission changes take effect on next request (no token-version revocation; deactivation enforced at validate + refresh).
- Stateless: no server session store, no `logout-all-sessions` endpoint found (spec §M13 mentions it — NOT VERIFIED in code).
- MFA/TOTP, password policy/breach/lockout, session limits: mentioned in `docs/06–08` — NOT VERIFIED in code.

## Account creation

- System users: `prisma/seed.ts` (13 users + 8 DoctorProfiles).
- Doctors at runtime: `POST /api/doctors` (`Doctor:create`, Admin) — see above.
- Generic users: `user.controller.ts` (`GET /users` gated on `Admission:update` — odd coupling, §23).

## Expiry / clock notes

`ignoreExpiration:false`; `JWT_EXPIRES_IN` env overrides access TTL; refresh fixed `7d`.
Frontend `expiresAt` is advisory — real expiry is server-side `exp` claim.
