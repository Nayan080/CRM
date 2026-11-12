# ADR-0003: Authentication, sessions and MFA

- **Status:** Accepted (2026-11-10, DEC-03, DEC-05, DEC-06). Implemented in Stage 2.
- **Decision:**
  - Passwords hashed with Argon2id.
  - Access token: JWT, 10 minutes, held in browser memory. Contains only `sub` and `sid`
    (no tenant or role, so permission changes apply immediately).
  - Refresh token: opaque random value, stored **hashed**, rotated on every use, sent as an
    `HttpOnly; Secure; SameSite=Strict` cookie scoped to the refresh path. 7-day idle timeout,
    30-day absolute limit. Reuse of an old token revokes the whole session family.
  - Email verification link 24 h, password reset 30 min (revokes all sessions), invitations 7 days.
    All single-use and stored hashed.
  - TOTP MFA required for Owner, Admin and platform roles; optional for others. Hashed recovery codes.
  - Transactional email via Zoho ZeptoMail behind a mail adapter (DEC-02).
- **Consequences:** Sessions are revocable server-side; stolen refresh tokens are detectable.
  Requires CSRF protection on the refresh endpoint (SameSite + custom header).
