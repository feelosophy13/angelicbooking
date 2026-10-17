"use client";
import { useState } from "react";
import { Checkbox } from "@/components/ui";

/** Whether the person has a calendar column, and only then whether clients can book them online. */
export function CalendarFields({ takesAppointments, bookableOnline }: { takesAppointments: boolean; bookableOnline: boolean }) {
  const [takes, setTakes] = useState(takesAppointments);
  return (
    <>
      <Checkbox name="takesAppointments" checked={takes} onChange={(e) => setTakes(e.target.checked)} label="Takes appointments" hint="Has a calendar column. Untick for front desk, managers or an owner login that doesn't see clients." />
      {takes ? <Checkbox name="bookableOnline" defaultChecked={bookableOnline} label="Bookable online" /> : null}
    </>
  );
}
