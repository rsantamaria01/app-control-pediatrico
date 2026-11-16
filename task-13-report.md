# Task 13 — catalog-badges E2E login investigation

## RED

Command:

`TEST_DATABASE_URL="${DATABASE_URL%/*}/pediatrico_auth_slice2_test" CLINICAL_E2E_DATABASE_URL="${DATABASE_URL%/*}/pediatrico_auth_slice2_test" AUTH_E2E=1 CLINICAL_E2E=1 pnpm exec playwright test test/e2e/catalog-badges.spec.ts --workers=1 --reporter=line`

Result: 3 failed. All stopped at `expect(page).toHaveURL('/')` with the URL still `/acceso`.

Diagnostic run of the 375px test captured only `GET /api/auth/get-session`. There was no `POST /api/auth/sign-in/username` and no login alert. The click therefore occurred before the login form handler was active.

The existing auth and agenda E2E tests wait for `networkidle` after opening `/acceso`; catalog-badges did not. The focused existing auth sign-in test passed in the same environment. Source seed data was not added.

## GREEN

The catalog fixture now waits for `networkidle` before filling either login form. The same command then passed all 3 tests, including 375px and 1440px: `3 passed (22.9s)`.

No auth source change was required and no clinical catalog seed was added.

## Verification

`pnpm lint && pnpm typecheck && pnpm test` exited 0: lint had 18 existing Vue style warnings and no errors; typecheck passed; 162 unit tests passed across 15 files. Commit: `537395e`.
