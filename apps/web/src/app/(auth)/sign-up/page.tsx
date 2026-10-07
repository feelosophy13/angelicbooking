import { Suspense } from "react";
import { AuthForm } from "../auth-form";
import { googleEnabled } from "@/lib/auth-providers";
export default function SignUpPage() {
  return (
    <Suspense>
      <AuthForm mode="sign-up" googleEnabled={googleEnabled} />
    </Suspense>
  );
}
