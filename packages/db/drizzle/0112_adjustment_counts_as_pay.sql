-- A payroll adjustment that is pay for the work (a bonus, a commission paid by hand) counts toward the overtime regular rate (FLSA);
-- reimbursements and corrections don't.
ALTER TABLE "payroll_adjustments" ADD COLUMN IF NOT EXISTS "counts_as_pay" boolean NOT NULL DEFAULT false;
