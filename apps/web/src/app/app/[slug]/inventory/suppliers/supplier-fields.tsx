import { Input, Textarea } from "@/components/ui";
import { Field } from "@/components/form";

type Supplier = { name: string; contactName: string | null; email: string | null; phone: string | null; accountNumber: string | null; notes: string | null };

export function SupplierFields({ supplier }: { supplier?: Supplier }) {
  return (
    <>
      <Field label="Name" name="name" required><Input name="name" defaultValue={supplier?.name ?? ""} required autoFocus /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Contact" name="contactName"><Input name="contactName" defaultValue={supplier?.contactName ?? ""} /></Field>
        <Field label="Phone" name="phone"><Input name="phone" type="tel" defaultValue={supplier?.phone ?? ""} /></Field>
        <Field label="Email" name="email" hint="Orders are written to this address."><Input name="email" type="email" defaultValue={supplier?.email ?? ""} /></Field>
        <Field label="Your account number" name="accountNumber"><Input name="accountNumber" defaultValue={supplier?.accountNumber ?? ""} /></Field>
      </div>
      <Field label="Notes" name="notes"><Textarea name="notes" rows={3} defaultValue={supplier?.notes ?? ""} /></Field>
    </>
  );
}
