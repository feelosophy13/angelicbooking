"use client";
import { useActionState } from "react";
import { createBusiness } from "./actions";
import { Button, Card, Field, Input, Notice, Select } from "@/components/ui";
import { TIMEZONES } from "@/lib/utils";

export function OnboardingForm() {
  const [state, action, pending] = useActionState(createBusiness, undefined);
  const guess = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "America/New_York";
  return (
    <Card className="p-6">
      <form action={action} className="space-y-4">
        <Field label="Business name">
          <Input name="name" required placeholder="Angelic Salon" />
        </Field>
        <Field label="Timezone">
          <Select name="timezone" defaultValue={TIMEZONES.includes(guess) ? guess : "America/New_York"}>
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </Select>
        </Field>
        {state?.error ? <Notice>{state.error}</Notice> : null}
        <Button type="submit" className="w-full" disabled={pending}>{pending ? "Creating…" : "Create business"}</Button>
      </form>
    </Card>
  );
}
