"use client";
import { Button, Card } from "@/components/ui";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const permission = /permission/i.test(error.message);
  return (
    <Card className="mx-auto mt-10 max-w-md p-6 text-center">
      <h1 className="text-lg font-semibold">{permission ? "Not allowed" : "Something went wrong"}</h1>
      <p className="mt-2 text-sm text-stone-600">
        {permission ? "Your role doesn't include this action. Ask an owner or manager." : error.message || "Please try again."}
      </p>
      <div className="mt-4 flex justify-center gap-2">
        <Button variant="secondary" onClick={() => history.back()}>Go back</Button>
        {!permission ? <Button onClick={reset}>Try again</Button> : null}
      </div>
    </Card>
  );
}
