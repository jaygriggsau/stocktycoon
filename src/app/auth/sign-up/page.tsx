import { AuthForm } from "@/components/AuthForm";
import { signUpWithEmail } from "./actions";

export default function SignUpPage() {
  return <AuthForm mode="sign-up" action={signUpWithEmail} />;
}
