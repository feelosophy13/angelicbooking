import { describe, expect, it } from "vitest";
import { emailAllowed } from "../report-error";

describe("error email throttle", () => {
  it("sends one email per distinct error every ten minutes, ignoring ids in the summary", () => {
    const t0 = 1_000_000_000_000;
    expect(emailAllowed("GET /app/x/sales/0c7b3b7e-1b7f-4f2f-9b3a-123456789abc → boom", t0)).toBe(true);
    expect(emailAllowed("GET /app/x/sales/9a9a9a9a-2c2c-4d4d-8e8e-abcdefabcdef → boom", t0 + 1000)).toBe(false);
    expect(emailAllowed("POST /api/jobs/notifications → other", t0 + 2000)).toBe(true);
    expect(emailAllowed("GET /app/x/sales/0c7b3b7e-1b7f-4f2f-9b3a-123456789abc → boom", t0 + 11 * 60_000)).toBe(true);
  });
  it("caps emails at twenty an hour", () => {
    const t0 = 2_000_000_000_000;
    let sent = 0;
    for (let i = 0; i < 40; i++) if (emailAllowed(`distinct error ${i}`, t0 + i)) sent++;
    expect(sent).toBe(20);
    expect(emailAllowed("after the hour", t0 + 61 * 60_000)).toBe(true);
  });
});
