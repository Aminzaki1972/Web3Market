#!/usr/bin/env bash
# Two independent PostgreSQL sessions race the REAL Safe finalizer against
# the real report-version append trigger in both lock orders.
# Disposable PostgreSQL only; no production DB or live Safe calls.
set -euo pipefail

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
PGDATABASE="${PGDATABASE:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

psql_w3m() {
  psql -X -q -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" "$@"
}
wait_for_query() {
  local app_name="$1" pattern="$2" wait_type="$3"
  for _ in $(seq 1 200); do
    if psql_w3m -At -c "SELECT EXISTS (
      SELECT 1 FROM pg_stat_activity
       WHERE application_name = '$app_name' AND state = 'active'
         AND query LIKE '%$pattern%'
         AND ('$wait_type' = 'any' OR wait_event_type = '$wait_type')
    )" | grep -qx t; then return 0; fi
    sleep 0.05
  done
  echo "FAIL: timed out waiting for $app_name ($pattern / $wait_type)"
  return 1
}
cleanup() {
  psql_w3m -c "DROP TABLE IF EXISTS public.w3m_test_finalizer_race_fixture;" >/dev/null 2>&1 || true
}
cleanup
trap cleanup EXIT

run_fixture() {
  local fixture_key="$1" prefix="$2"
  sed \
    -e "s/10000000-0000-4000-8000-000000000001/${prefix}0000-4000-8000-000000000001/g" \
    -e "s/20000000-0000-4000-8000-000000000002/${prefix}0000-4000-8000-000000000002/g" \
    -e "s/21000000-0000-4000-8000-000000000002/${prefix}1000-4000-8000-000000000002/g" \
    -e "s/22000000-0000-4000-8000-000000000002/${prefix}2000-4000-8000-000000000002/g" \
    -e "s/30000000-0000-4000-8000-000000000003/${prefix}3000-4000-8000-000000000003/g" \
    -e "s/40000000-0000-4000-8000-000000000004/${prefix}4000-4000-8000-000000000004/g" \
    -e "s/40000000-0000-4000-8000-000000000005/${prefix}4000-4000-8000-000000000005/g" \
    -e "s/50000000-0000-4000-8000-000000000005/${prefix}5000-4000-8000-000000000005/g" \
    -e "s/75000000-0000-4000-8000-000000000001/${prefix}5000-4000-8000-000000000001/g" \
    -e "s/75100000-0000-4000-8000-000000000001/${prefix}5100-4000-8000-000000000001/g" \
    -e "s/v_safe_hash text := '0x' || repeat('a', 64);/v_safe_hash text := '0x' || repeat('${prefix:1:1}', 64);/g" \
    -e "s/attempt-test-key/attempt-test-key-${fixture_key}/g" \
    -e "s/signer-race-idempotency/signer-idempotency-${fixture_key}/g" \
    -e "s/signer-race/${fixture_key}/g" \
    supabase/tests/w3m-safe-finalizer-concurrency-fixture.sql | psql_w3m
}

append_report() {
  psql_w3m <<'SQL'
INSERT INTO public.w3m_acquisition_reports (
  id,deal_id,project_id,report_version,supersedes_report_id,buyer_id,seller_id,
  status,engine_version,evidence_hash,report_hash,report_payload,signer_key_id,
  report_signature,issued_at,expires_at
)
SELECT gen_random_uuid(),r.deal_id,r.project_id,r.report_version+1,r.id,
       r.buyer_id,r.seller_id,'PASS',r.engine_version,repeat('9',64),repeat('8',64),
       r.report_payload,r.signer_key_id,r.report_signature,clock_timestamp(),
       clock_timestamp()+interval '1 hour'
  FROM public.w3m_test_finalizer_race_fixture f
  JOIN public.w3m_safe_execution_attempts a ON a.id=f.attempt_id
  JOIN public.w3m_acquisition_reports r ON r.id=a.report_id
 WHERE f.fixture_key=current_setting('w3m.test.fixture_key');
SQL
}

# Order A: finalizer holds the shared advisory lock first. Report INSERT waits,
# then must be rejected after the confirmed settlement commits.
run_fixture "report-finalizer-first" "65000000-"
(export PGAPPNAME=w3m-finalizer-before-report; psql_w3m > /tmp/w3m-finalizer-before-report.log 2>&1 <<'SQL'
BEGIN;
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT public.w3m_finalize_safe_execution_attempt(
  f.attempt_id,f.broadcast_tx_hash,f.buyer_id,f.receipt
) FROM public.w3m_test_finalizer_race_fixture f WHERE f.fixture_key='report-finalizer-first';
SELECT pg_sleep(1.5);
COMMIT;
SQL
) &
FINALIZER_PID=$!
wait_for_query "w3m-finalizer-before-report" "pg_sleep" "any"
(export PGAPPNAME=w3m-report-after-finalizer; psql_w3m > /tmp/w3m-report-after-finalizer.log 2>&1 <<'SQL'
SELECT set_config('w3m.test.fixture_key','report-finalizer-first',false);
INSERT INTO public.w3m_acquisition_reports (
  id,deal_id,project_id,report_version,supersedes_report_id,buyer_id,seller_id,
  status,engine_version,evidence_hash,report_hash,report_payload,signer_key_id,
  report_signature,issued_at,expires_at
)
SELECT gen_random_uuid(),r.deal_id,r.project_id,r.report_version+1,r.id,
       r.buyer_id,r.seller_id,'PASS',r.engine_version,repeat('9',64),repeat('8',64),
       r.report_payload,r.signer_key_id,r.report_signature,clock_timestamp(),
       clock_timestamp()+interval '1 hour'
  FROM public.w3m_test_finalizer_race_fixture f
  JOIN public.w3m_safe_execution_attempts a ON a.id=f.attempt_id
  JOIN public.w3m_acquisition_reports r ON r.id=a.report_id
 WHERE f.fixture_key='report-finalizer-first';
SQL
) &
REPORT_AFTER_PID=$!
wait_for_query "w3m-report-after-finalizer" "INSERT INTO public.w3m_acquisition_reports" "Lock"
wait "$REPORT_AFTER_PID" || true
wait "$FINALIZER_PID"
if ! grep -q "W3M acquisition reports cannot be appended after Safe settlement is confirmed" /tmp/w3m-report-after-finalizer.log; then
  echo "FAIL: report append after settlement was not rejected for the expected reason:"
  cat /tmp/w3m-report-after-finalizer.log
  exit 1
fi
psql_w3m -At -c "SELECT CASE WHEN d.status='completed' AND a.state='CONFIRMED' AND (SELECT max(report_version) FROM public.w3m_acquisition_reports WHERE deal_id=d.id::text)=1 AND (SELECT count(*) FROM public.deal_audit_logs WHERE deal_id=d.id AND action='safe_release_confirmed')=1 THEN 'PASS' ELSE 'FAIL' END FROM public.w3m_test_finalizer_race_fixture f JOIN public.deals d ON d.id=f.deal_id JOIN public.w3m_safe_execution_attempts a ON a.id=f.attempt_id WHERE f.fixture_key='report-finalizer-first';" | grep -qx PASS

# Order B: report append holds the same advisory lock first. Finalizer waits,
# then must reject because its pinned report is no longer the latest version.
run_fixture "report-first-finalizer" "66000000-"
(export PGAPPNAME=w3m-report-before-finalizer; psql_w3m > /tmp/w3m-report-before-finalizer.log 2>&1 <<'SQL'
BEGIN;
INSERT INTO public.w3m_acquisition_reports (
  id,deal_id,project_id,report_version,supersedes_report_id,buyer_id,seller_id,
  status,engine_version,evidence_hash,report_hash,report_payload,signer_key_id,
  report_signature,issued_at,expires_at
)
SELECT gen_random_uuid(),r.deal_id,r.project_id,r.report_version+1,r.id,
       r.buyer_id,r.seller_id,'PASS',r.engine_version,repeat('9',64),repeat('8',64),
       r.report_payload,r.signer_key_id,r.report_signature,clock_timestamp(),
       clock_timestamp()+interval '1 hour'
  FROM public.w3m_test_finalizer_race_fixture f
  JOIN public.w3m_safe_execution_attempts a ON a.id=f.attempt_id
  JOIN public.w3m_acquisition_reports r ON r.id=a.report_id
 WHERE f.fixture_key='report-first-finalizer';
SELECT pg_sleep(1.5);
COMMIT;
SQL
) &
REPORT_PID=$!
wait_for_query "w3m-report-before-finalizer" "pg_sleep" "any"
(export PGAPPNAME=w3m-finalizer-after-report; psql_w3m > /tmp/w3m-finalizer-after-report.log 2>&1 <<'SQL'
SELECT set_config('request.jwt.claim.role','service_role',false);
SELECT public.w3m_finalize_safe_execution_attempt(
  f.attempt_id,f.broadcast_tx_hash,f.buyer_id,f.receipt
) FROM public.w3m_test_finalizer_race_fixture f WHERE f.fixture_key='report-first-finalizer';
SQL
) &
FINALIZER_AFTER_PID=$!
wait_for_query "w3m-finalizer-after-report" "w3m_finalize_safe_execution_attempt" "Lock"
wait "$FINALIZER_AFTER_PID" || true
wait "$REPORT_PID"
if ! grep -q "Pinned acquisition report is stale, superseded, expired, or misbound" /tmp/w3m-finalizer-after-report.log; then
  echo "FAIL: finalizer did not reject the superseded pinned report for the expected reason:"
  cat /tmp/w3m-finalizer-after-report.log
  exit 1
fi
psql_w3m -At -c "SELECT CASE WHEN d.status<>'completed' AND a.state IN ('BROADCAST','RECONCILIATION_REQUIRED') AND (SELECT max(report_version) FROM public.w3m_acquisition_reports WHERE deal_id=d.id::text)=2 AND NOT EXISTS (SELECT 1 FROM public.deal_audit_logs WHERE deal_id=d.id AND action='safe_release_confirmed') THEN 'PASS' ELSE 'FAIL' END FROM public.w3m_test_finalizer_race_fixture f JOIN public.deals d ON d.id=f.deal_id JOIN public.w3m_safe_execution_attempts a ON a.id=f.attempt_id WHERE f.fixture_key='report-first-finalizer';" | grep -qx PASS

# Evidence is frozen as soon as the attempt pins the report. Race a real
# evidence INSERT against finalization: the INSERT must wait on the same
# per-deal advisory lock, then be rejected after the finalizer commits.
run_fixture "evidence-finalizer-first" "67000000-"
(export PGAPPNAME=w3m-finalizer-before-evidence; psql_w3m > /tmp/w3m-finalizer-before-evidence.log 2>&1 <<'SQL'
BEGIN;
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT public.w3m_finalize_safe_execution_attempt(
  f.attempt_id,f.broadcast_tx_hash,f.buyer_id,f.receipt
) FROM public.w3m_test_finalizer_race_fixture f WHERE f.fixture_key='evidence-finalizer-first';
SELECT pg_sleep(1.5);
COMMIT;
SQL
) &
FINALIZER_EVIDENCE_PID=$!
wait_for_query "w3m-finalizer-before-evidence" "pg_sleep" "any"
(export PGAPPNAME=w3m-evidence-after-finalizer; psql_w3m > /tmp/w3m-evidence-after-finalizer.log 2>&1 <<'SQL'
INSERT INTO public.w3m_acquisition_evidence (
  report_id,evidence_type,source_table,source_record_id,source_version,
  evidence_hash,result,mandatory,observed_at,valid_until,details
)
SELECT a.report_id,'DISPUTE_CHECK',null,null,null,repeat('9',64),'PASS',true,
       now(),now()+interval '1 hour',jsonb_build_object('test','concurrent post-finalization append')
  FROM public.w3m_test_finalizer_race_fixture f
  JOIN public.w3m_safe_execution_attempts a ON a.id=f.attempt_id
 WHERE f.fixture_key='evidence-finalizer-first';
SQL
) &
EVIDENCE_AFTER_PID=$!
wait_for_query "w3m-evidence-after-finalizer" "INSERT INTO public.w3m_acquisition_evidence" "Lock"
wait "$EVIDENCE_AFTER_PID" || true
wait "$FINALIZER_EVIDENCE_PID"
if ! grep -q "Evidence manifest is frozen after an execution attempt pins the report" /tmp/w3m-evidence-after-finalizer.log; then
  echo "FAIL: evidence append after finalization was not rejected for the expected reason:"
  cat /tmp/w3m-evidence-after-finalizer.log
  exit 1
fi
psql_w3m -At -c "SELECT CASE WHEN d.status='completed' AND a.state='CONFIRMED' AND (SELECT count(*) FROM public.w3m_acquisition_evidence WHERE report_id=a.report_id)=2 AND (SELECT count(*) FROM public.deal_audit_logs WHERE deal_id=d.id AND action='safe_release_confirmed')=1 THEN 'PASS' ELSE 'FAIL' END FROM public.w3m_test_finalizer_race_fixture f JOIN public.deals d ON d.id=f.deal_id JOIN public.w3m_safe_execution_attempts a ON a.id=f.attempt_id WHERE f.fixture_key='evidence-finalizer-first';" | grep -qx PASS

echo "PASS: two independent PostgreSQL sessions raced the real Safe finalizer against report and evidence appends; both remained fail-closed."
