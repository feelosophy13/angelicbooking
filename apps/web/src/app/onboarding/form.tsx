"use client";
import { useActionState } from "react";
import { createBusiness } from "./actions";
import Link from "next/link";
import { Button, Card, Checkbox, Field, Input, Notice, Select } from "@/components/ui";
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
        <Field label="Business phone" hint="Optional. Shown on your booking page and in messages.">
          <Input name="phone" type="tel" autoComplete="tel" placeholder="(555) 123-4567" />
        </Field>
        <Checkbox
          name="terms"
          required
          label={<>I agree to the <Link href="/terms" target="_blank" className="underline">Terms</Link> and <Link href="/privacy" target="_blank" className="underline">Privacy Policy</Link>, and I will only text clients who agreed to receive texts.</>}
        />
        {state?.error ? <Notice>{state.error}</Notice> : null}
        <Button type="submit" className="w-full" disabled={pending}>{pending ? "Creating…" : "Create business"}</Button>
      </form>
    </Card>
  );
}
