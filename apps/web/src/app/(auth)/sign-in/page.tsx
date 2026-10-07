import { Suspense } from "react";
import { AuthForm } from "../auth-form";
import { googleEnabled } from "@/lib/auth-providers";
export default function SignInPage() {
  return (
    <Suspense>
      <AuthForm mode="sign-in" googleEnabled={googleEnabled} />
    </Suspense>
  );
}
