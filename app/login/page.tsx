"use client";
import { Suspense, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  ClipboardCheck,
  Droplets,
  Eye,
  EyeOff,
  Factory,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  MailCheck,
  Package,
  ShieldCheck,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { api } from "@/lib/api";
import { BRAND } from "@/lib/brand";
import { homeFor } from "@/lib/navigation";
import { toast } from "@/lib/toast-store";
import type { Role } from "@/lib/types";
import { errorMessage } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const email = z.string().trim().min(1, "Enter your email address").email("Enter a valid email address");
const loginSchema = z.object({ email, password: z.string().min(1, "Enter your password") });
const forgotSchema = z.object({ email });
type LoginForm = z.infer<typeof loginSchema>;
type ForgotForm = z.infer<typeof forgotSchema>;

type View = { name: "signin" } | { name: "forgot"; email: string } | { name: "sent"; email: string; message: string };

const PROCESS: Array<{ label: string; icon: LucideIcon }> = [
  { label: "Yarn", icon: Package },
  { label: "Knitting", icon: Factory },
  { label: "Dyeing", icon: Droplets },
  { label: "QC", icon: ClipboardCheck },
  { label: "Delivery", icon: Truck },
];

/** Only allow same-origin relative paths as a post-login redirect. */
const safeNext = (value: string | null) =>
  value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/login") ? value : null;

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <span id={id} className="login-field__error">
      <AlertCircle size={13} aria-hidden /> {message}
    </span>
  );
}

function SignInForm({ onForgot }: { onForgot: (email: string) => void }) {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });

  const submit = async (values: LoginForm) => {
    setError("");
    try {
      const r = await api<{ data: { role: Role; name: string } }>("/auth/login", {
        method: "POST",
        body: JSON.stringify(values),
        silent: true,
      });
      toast.success(`Welcome back, ${r.data.name}.`, "Signed in");
      router.replace(safeNext(params.get("next")) ?? homeFor(r.data.role));
    } catch (e) {
      setError(errorMessage(e, "Sign in failed. Please try again."));
    }
  };

  const trackCapsLock = (event: React.KeyboardEvent<HTMLInputElement>) =>
    setCapsLock(event.getModifierState?.("CapsLock") ?? false);

  return (
    <form noValidate onSubmit={handleSubmit(submit)} aria-labelledby="login-title">
      <p className="login-eyebrow">
        <ShieldCheck size={13} aria-hidden /> Secure sign in
      </p>
      <h1 id="login-title" className="login-title">
        Welcome back
      </h1>
      <p className="login-subtitle">Sign in with your ERP account to continue.</p>

      <div className="mt-7 space-y-4">
        <label className="login-field">
          <span className="erp-label">Email address</span>
          <span className="login-field__control">
            <Mail size={17} className="login-field__icon" aria-hidden />
            <Input
              type="email"
              inputMode="email"
              autoComplete="username"
              autoFocus
              placeholder="you@company.com"
              className="login-input"
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? "login-email-error" : undefined}
              {...register("email")}
            />
          </span>
          <FieldError id="login-email-error" message={errors.email?.message} />
        </label>

        <div className="login-field">
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <label htmlFor="login-password" className="erp-label !mb-0">
              Password
            </label>
            <button type="button" className="login-link" onClick={() => onForgot(getValues("email").trim())}>
              Forgot password?
            </button>
          </div>
          <span className="login-field__control">
            <Lock size={17} className="login-field__icon" aria-hidden />
            <Input
              id="login-password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="Enter your password"
              className="login-input pr-11"
              aria-invalid={Boolean(errors.password)}
              aria-describedby={errors.password ? "login-password-error" : capsLock ? "login-caps" : undefined}
              onKeyDown={trackCapsLock}
              onKeyUp={trackCapsLock}
              {...register("password", { onBlur: () => setCapsLock(false) })}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="login-field__toggle"
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </span>
          <FieldError id="login-password-error" message={errors.password?.message} />
          {capsLock && !errors.password && (
            <span id="login-caps" className="login-field__hint">
              Caps Lock is on
            </span>
          )}
        </div>
      </div>

      {error && (
        <div role="alert" className="login-alert mt-5">
          <AlertCircle size={17} className="shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      <Button type="submit" className="login-submit mt-6 w-full" disabled={isSubmitting}>
        {isSubmitting ? <Loader2 className="animate-spin" size={17} /> : null}
        {isSubmitting ? "Signing in..." : "Sign in"}
        {!isSubmitting && <ArrowRight size={17} className="login-submit__arrow" />}
      </Button>

      <p className="mt-6 text-center text-xs text-gray-500">
        Don’t have an account? Ask your administrator for access.
      </p>
    </form>
  );
}

function ForgotPasswordForm({
  initialEmail,
  onBack,
  onSent,
}: {
  initialEmail: string;
  onBack: () => void;
  onSent: (email: string, message: string) => void;
}) {
  const [error, setError] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotForm>({ resolver: zodResolver(forgotSchema), defaultValues: { email: initialEmail } });

  const submit = async ({ email }: ForgotForm) => {
    setError("");
    try {
      const r = await api<{ message: string }>("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email }),
        silent: true,
      });
      onSent(email, r.message);
    } catch (e) {
      setError(errorMessage(e, "Could not send the request. Please try again."));
    }
  };

  return (
    <form noValidate onSubmit={handleSubmit(submit)} aria-labelledby="forgot-title">
      <button type="button" className="login-back" onClick={onBack}>
        <ArrowLeft size={15} /> Back to sign in
      </button>
      <span className="login-badge mt-6" aria-hidden>
        <KeyRound size={20} />
      </span>
      <h1 id="forgot-title" className="login-title mt-4">
        Forgot your password?
      </h1>
      <p className="login-subtitle">
        Enter your account email. Your administrator will be notified and will set a new password for you.
      </p>

      <label className="login-field mt-7">
        <span className="erp-label">Email address</span>
        <span className="login-field__control">
          <Mail size={17} className="login-field__icon" aria-hidden />
          <Input
            type="email"
            inputMode="email"
            autoComplete="username"
            autoFocus
            placeholder="you@company.com"
            className="login-input"
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? "forgot-email-error" : undefined}
            {...register("email")}
          />
        </span>
        <FieldError id="forgot-email-error" message={errors.email?.message} />
      </label>

      {error && (
        <div role="alert" className="login-alert mt-5">
          <AlertCircle size={17} className="shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      <Button type="submit" className="login-submit mt-6 w-full" disabled={isSubmitting}>
        {isSubmitting ? <Loader2 className="animate-spin" size={17} /> : null}
        {isSubmitting ? "Sending request..." : "Request password reset"}
      </Button>
    </form>
  );
}

function ResetRequested({ email, message, onBack }: { email: string; message: string; onBack: () => void }) {
  return (
    <div role="status" aria-labelledby="sent-title">
      <span className="login-badge login-badge--success" aria-hidden>
        <MailCheck size={20} />
      </span>
      <h1 id="sent-title" className="login-title mt-4">
        Request received
      </h1>
      <p className="login-subtitle">{message}</p>
      <div className="login-note mt-6">
        <p className="font-semibold text-gray-800">{email}</p>
        <p className="mt-1">
          Once your administrator sets a new password, sign in with it and change it if asked. For urgent access,
          contact them directly.
        </p>
      </div>
      <Button type="button" className="login-submit mt-6 w-full" onClick={onBack}>
        <ArrowLeft size={17} /> Back to sign in
      </Button>
    </div>
  );
}

function AuthCard() {
  const [view, setView] = useState<View>({ name: "signin" });
  const toSignIn = () => setView({ name: "signin" });

  return (
    <div className="login-card">
      <div className="mb-7 flex items-center gap-3 lg:hidden">
        <span className="login-card__logo">
          <Image src={BRAND.logo} alt="" width={44} height={44} className="h-full w-full object-cover" />
        </span>
        <div className="min-w-0">
          <p className="truncate font-bold leading-tight">{BRAND.name}</p>
          <p className="truncate text-xs text-gray-500">{BRAND.tagline}</p>
        </div>
      </div>
      {/* Keyed so each view mounts fresh and its first field takes focus. */}
      <div key={view.name} className="login-view">
        {view.name === "signin" && <SignInForm onForgot={(email) => setView({ name: "forgot", email })} />}
        {view.name === "forgot" && (
          <ForgotPasswordForm
            initialEmail={view.email}
            onBack={toSignIn}
            onSent={(email, message) => setView({ name: "sent", email, message })}
          />
        )}
        {view.name === "sent" && <ResetRequested email={view.email} message={view.message} onBack={toSignIn} />}
      </div>
    </div>
  );
}

export default function Login() {
  return (
    <div className="login-page grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <aside className="login-hero hidden lg:flex">
        <div className="login-hero__glow" aria-hidden />
        <div className="relative z-10 flex items-center gap-3">
          <span className="login-hero__logo">
            <Image src={BRAND.logo} alt={BRAND.name} width={56} height={56} priority className="h-full w-full object-cover" />
          </span>
          <div>
            <p className="text-xl font-bold">{BRAND.name}</p>
            <p className="text-sm text-white/60">{BRAND.tagline}</p>
          </div>
        </div>

        <div className="relative z-10">
          <p className="login-hero__eyebrow">Complete traceability</p>
          <h2 className="login-hero__title">
            Every kilogram accounted for, <span>from yarn to delivery.</span>
          </h2>
          <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-white/65">
            Orders, production stages, quality checks and dispatch — tracked in one place for your whole mill.
          </p>
          <ol className="login-flow" aria-label="Production flow">
            {PROCESS.map(({ label, icon: Icon }) => (
              <li key={label} className="login-flow__step">
                <span className="login-flow__icon">
                  <Icon size={18} aria-hidden />
                </span>
                <span className="login-flow__label">{label}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="relative z-10 flex items-center justify-between gap-4 text-xs text-white/45">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck size={14} aria-hidden /> Encrypted, role-based access
          </span>
          <span>
            © {new Date().getFullYear()} {BRAND.name}
          </span>
        </div>
      </aside>

      <main className="login-main">
        <Suspense fallback={null}>
          <AuthCard />
        </Suspense>
        <p className="mt-6 text-center text-xs text-gray-400 lg:hidden">
          © {new Date().getFullYear()} {BRAND.name}
        </p>
      </main>
    </div>
  );
}
