import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button, TextField, Alert } from "@mui/material";
import { ArrowRight, BookOpen } from "lucide-react";
import { SignIn, SignUp } from "@clerk/react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../app/providers";
import { demoMode } from "../services/api";
import { ModeLabel } from "../components/Common";

function Story({ children }) {
  const { t } = useTranslation();
  return <main className="auth-layout">
    <div className="auth-story">
      <BookOpen size={35} strokeWidth={1.4} />
      <span className="eyebrow">IP-SAKTI SAHAYAK</span>
      <h1>Research Ayurveda IP with the source in view.</h1>
      <p>{t("subtitle")}</p>
      <div className="auth-note">
        <p>Save consultations, revisit citations, and keep each market in its own discussion.</p>
        <Button component={Link} to="/demo" variant="outlined">Open demo workspace</Button>
      </div>
    </div>
    <section className="auth-form">
      <div className="auth-form-inner">
        <div className="auth-form-top">
          <ModeLabel />
        </div>
        {children}
        <p className="auth-disclaimer small muted">{t("disclaimer")}</p>
      </div>
    </section>
  </main>;
}

function ClerkAuth({ kind }) {
  const appearance = {
    variables: {
      colorPrimary: "var(--accent)",
      colorBackground: "transparent",
      colorText: "var(--text)",
      colorTextSecondary: "var(--muted)",
      colorInputBackground: "var(--surface)",
      colorInputText: "var(--text)",
      borderRadius: "8px",
      fontFamily: "inherit",
    },
    elements: {
      rootBox: { width: "100%" },
      cardBox: { width: "100%", boxShadow: "none" },
      card: { width: "100%", padding: 0, boxShadow: "none", background: "transparent" },
      headerTitle: { fontSize: "1.4rem", fontWeight: 650, letterSpacing: "-0.03em" },
      headerSubtitle: { fontSize: "0.82rem" },
      formFieldLabel: { fontSize: "0.78rem" },
      formFieldInput: { minHeight: "42px", fontSize: "0.84rem" },
      socialButtonsBlockButton: { minHeight: "42px", fontSize: "0.82rem" },
      formButtonPrimary: { minHeight: "42px", boxShadow: "none", fontSize: "0.84rem", fontWeight: 650 },
      footer: { background: "transparent", padding: "1rem 0 0" },
      footerActionLink: { color: "var(--accent)", fontWeight: 650 },
    },
  };
  return <Story>
    {kind === "sign-up"
      ? <SignUp appearance={appearance} routing="path" path="/sign-up" signInUrl="/sign-in" fallbackRedirectUrl="/consultations" />
      : <SignIn appearance={appearance} routing="path" path="/sign-in" signUpUrl="/sign-up" fallbackRedirectUrl="/consultations" />}
  </Story>;
}

function DemoAuth({ kind }) {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const signup = kind === "sign-up";
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(signup ? "register" : "login", Object.fromEntries(new FormData(event.currentTarget)));
      const target = location.state?.from;
      navigate(typeof target === "string" && target.startsWith("/") && !target.startsWith("//") ? target : "/consultations", { replace: true });
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  return <Story>
    <h2>{signup ? t("signUp") : t("welcome")}</h2>
    <p className="muted">{t("signInSub")}</p>
    {error && <Alert severity="error">{error}</Alert>}
    <form onSubmit={submit}>
      {signup && <TextField label={t("name")} name="name" required fullWidth />}
      <TextField label={t("email")} name="email" type="email" required fullWidth />
      <TextField label={t("password")} name="password" type="password" required fullWidth inputProps={{ minLength: signup ? 12 : 1 }} />
      <Button type="submit" variant="contained" fullWidth disabled={busy} endIcon={<ArrowRight size={17} />}>
        {busy ? t("loading") : signup ? t("signUp") : t("signIn")}
      </Button>
    </form>
    <Button component={Link} to="/demo" fullWidth variant="outlined">{t("demoLogin")}</Button>
    <p className="small"><Link to={signup ? "/sign-in" : "/sign-up"}>{signup ? t("signIn") : t("signUp")}</Link></p>
    <p className="small muted">{t("demoNotice")}</p>
  </Story>;
}

export default function Auth({ kind = "sign-in" }) {
  return demoMode ? <DemoAuth kind={kind} /> : <ClerkAuth kind={kind} />;
}
