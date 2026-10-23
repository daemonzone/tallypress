import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { Card } from "@/components/ui";
import { getDictionary } from "@/i18n";
import { currentUser } from "@/lib/auth";
import { login } from "@/lib/auth-actions";

export default async function LoginPage() {
  if (await currentUser()) redirect("/");
  const { t } = await getDictionary();

  return (
    <div className="mx-auto mt-10 w-full max-w-sm">
      <Card>
        <h1 className="text-xl font-semibold tracking-tight">{t.auth.title}</h1>
        <p className="mb-5 mt-1 text-sm text-muted">{t.auth.subtitle}</p>
        <LoginForm action={login} labels={t.auth} />
      </Card>
    </div>
  );
}
