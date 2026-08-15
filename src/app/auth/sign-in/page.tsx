import { AuthForm } from "@/components/AuthForm";
import { signInWithEmail } from "./actions";

export default function SignInPage() {
  return <AuthForm mode="sign-in" action={signInWithEmail} />;
}
