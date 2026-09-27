import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Button,
  IconButton,
  Tooltip,
  Drawer,
  Alert,
  CircularProgress,
  TextField,
} from "@mui/material";
import {
  BookOpen,
  Moon,
  Sun,
  X,
  ExternalLink,
  ArrowUpRight,
  Menu,
} from "lucide-react";
import { usePreferences, useAuth } from "../app/providers";
import { demoMode } from "../services/api";
export function Brand() {
  return (
    <Link to="/" className="brand" aria-label="IP-SAKTI Sahayak home">
      <span className="brand-mark">
        <BookOpen size={23} strokeWidth={1.65} />
      </span>
      <span>
        IP-SAKTI <span className="brand-light">Sahayak</span>
      </span>
    </Link>
  );
}
export function IconAction({ label, children, ...props }) {
  return (
    <Tooltip title={label}>
      <IconButton aria-label={label} size="small" {...props}>
        {children}
      </IconButton>
    </Tooltip>
  );
}
export function Preferences() {
  const { t, i18n } = useTranslation();
  const { mode, setMode, setLanguage } = usePreferences();
  return (
    <div className="preferences">
      <Button
        size="small"
        onClick={() => setLanguage(i18n.language === "en" ? "hi" : "en")}
        aria-label="Switch language"
      >
        {i18n.language === "en" ? "हिंदी" : "English"}
      </Button>
      <IconAction
        label={mode === "light" ? t("dark") : t("light")}
        onClick={() => setMode(mode === "light" ? "dark" : "light")}
      >
        {mode === "light" ? <Moon size={18} /> : <Sun size={18} />}
      </IconAction>
    </div>
  );
}
export function Header() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const links = [
    ["/library", "library"],
    ["/about", "about"],
  ];
  return (
    <header className="public-header">
      <Brand />
      <nav>
        {links.map(([path, key]) => (
          <Link key={path} to={path}>
            {t(key)}
          </Link>
        ))}
      </nav>
      <Preferences />
      <Button
        component={Link}
        to={user ? "/consultations" : "/sign-up"}
        variant="contained"
      >
        {t("start")}
        <ArrowUpRight size={16} />
      </Button>
      <div className="public-mobile-menu">
        <IconAction
          label={i18n.language === "hi" ? "मेन्यू खोलें" : "Open menu"}
          onClick={() => setMenuOpen(true)}
          aria-expanded={menuOpen}
        >
          <Menu size={21} />
        </IconAction>
      </div>
      <Drawer anchor="right" open={menuOpen} onClose={() => setMenuOpen(false)}>
        <div className="public-menu-panel">
          <div className="row between">
            <Brand compact />
            <IconAction label={t("close")} onClick={() => setMenuOpen(false)}>
              <X size={19} />
            </IconAction>
          </div>
          <nav
            aria-label={
              i18n.language === "hi" ? "मुख्य नेविगेशन" : "Main navigation"
            }
          >
            {links.map(([path, key]) => (
              <Link key={path} to={path} onClick={() => setMenuOpen(false)}>
                {t(key)}
                <ArrowUpRight size={16} />
              </Link>
            ))}
            <Link
              to={user ? "/consultations" : "/sign-in"}
              onClick={() => setMenuOpen(false)}
            >
              {t(user ? "workspace" : "signIn")}
              <ArrowUpRight size={16} />
            </Link>
          </nav>
        </div>
      </Drawer>
    </header>
  );
}
export function ModeLabel({ demo = demoMode }) {
  const { t } = useTranslation();
  return (
    <span className="mode-label">
      <span className="status-dot" />
      {t(demo ? "demo" : "live")}
    </span>
  );
}
export function Footer() {
  const { t } = useTranslation();
  return (
    <footer className="public-footer">
      <Brand compact />
      <span>{t("disclaimer")}</span>
      <ModeLabel />
    </footer>
  );
}
export function Loading() {
  const { t } = useTranslation();
  return (
    <div className="loading" role="status">
      <CircularProgress size={25} aria-hidden="true" />
      <span>{t("loading")}</span>
    </div>
  );
}
export function ErrorNotice({ error, retry }) {
  const { t } = useTranslation();
  return (
    <Alert
      severity="error"
      action={retry && <Button onClick={retry}>{t("retry")}</Button>}
    >
      {error?.message || t("error")}
    </Alert>
  );
}
export function SourceDrawer({ source, onClose }) {
  const { t, i18n } = useTranslation();
  const hi = i18n.language === "hi";
  const titleId = useId();
  const [copyState, setCopyState] = useState("");
  useEffect(() => setCopyState(""), [source]);
  const citation = source
    ? [
        source.title,
        source.authority,
        source.locator,
        source.url,
        source.version_id && `${t("version")}: ${source.version_id}`,
        `${t("retrieved")}: ${source.checked_at || t("notReviewed")}`,
      ]
        .filter(Boolean)
        .join("\n")
    : "";
  async function copyCitation() {
    setCopyState("pending");
    try {
      await navigator.clipboard.writeText(citation);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }
  return (
    <Drawer
      anchor="right"
      open={!!source}
      onClose={onClose}
      PaperProps={{
        role: "dialog",
        "aria-modal": true,
        "aria-labelledby": titleId,
        sx: { width: { xs: "100%", sm: 440 }, p: 3 },
      }}
    >
      {source && (
        <>
          <div className="row between">
            <span className="eyebrow">{t("sourceTitle")}</span>
            <IconAction label={t("close")} onClick={onClose}>
              <X size={20} />
            </IconAction>
          </div>
          <span className="source-badge">{t("official")}</span>
          <h2 id={titleId}>{source.title}</h2>
          <p className="muted">{source.authority}</p>
          <dl className="metadata">
            {[
              [t("jurisdiction"), t(source.scope)],
              [t("provision"), source.locator],
              [t("published"), source.published_at || "—"],
              [t("retrieved"), source.checked_at || t("notReviewed")],
              [t("version"), source.version_id || "—"],
            ].map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <h4>{t("original")}</h4>
          {source.excerpt ? (
            <blockquote>{source.excerpt}</blockquote>
          ) : (
            <p className="muted">{t("noExcerpt")}</p>
          )}
          <Button
            component="a"
            href={
              /^https?:\/\//i.test(source.url || "") ? source.url : undefined
            }
            disabled={!/^https?:\/\//i.test(source.url || "")}
            target="_blank"
            rel="noopener noreferrer"
            variant="contained"
            endIcon={<ExternalLink size={16} />}
          >
            {t("openSource")}
          </Button>
          <Button onClick={copyCitation} disabled={copyState === "pending"}>
            {hi ? "उद्धरण कॉपी करें" : "Copy citation"}
          </Button>
          {copyState === "copied" && <p role="status">{t("copied")}</p>}
          {copyState === "error" && (
            <>
              <Alert severity="warning">
                {hi
                  ? "कॉपी नहीं हो सका। नीचे दिए उद्धरण को चुनकर कॉपी करें।"
                  : "Could not copy automatically. Select and copy the citation below."}
              </Alert>
              <TextField
                label={hi ? "उद्धरण" : "Citation"}
                value={citation}
                multiline
                fullWidth
                autoFocus
                InputProps={{ readOnly: true }}
                onFocus={(event) => event.target.select()}
                sx={{ mt: 2 }}
              />
            </>
          )}
        </>
      )}
    </Drawer>
  );
}
