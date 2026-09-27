import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  Button,
  ToggleButtonGroup,
  ToggleButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
} from "@mui/material";
import { useAuth, usePreferences } from "../app/providers";
import { api, download, demoMode } from "../services/api";
import Connectors from "./Connectors";
export default function Settings() {
  const { t, i18n } = useTranslation();
  const { user, deleteIdentity } = useAuth();
  const { mode, setMode, setLanguage } = usePreferences();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  async function remove() {
    try {
      await api("/auth/account", { method: "DELETE" });
      await deleteIdentity?.();
      queryClient.clear();
      queryClient.setQueryData(["session"], null);
      navigate("/");
    } catch (e) {
      setError(e.message);
    }
  }
  async function exportAll() {
    try {
      download("ip-sakti-account.json", await api("/auth/export"));
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <main className="public-main settings-page">
      <span className="eyebrow">{t("settings")}</span>
      <h1>{t("preferences")}</h1>
      {error && <Alert severity="error">{error}</Alert>}
      <section className="setting-row">
        <div>
          <h3>{t("theme")}</h3>
          <p className="muted">
            {i18n.language === "hi"
              ? "इस ब्राउज़र में याद रखा जाता है।"
              : "Remembered in this browser."}
          </p>
        </div>
        <ToggleButtonGroup
          exclusive
          value={mode}
          onChange={(_, v) => v && setMode(v)}
        >
          {["light", "dark"].map((x) => (
            <ToggleButton value={x} key={x}>
              {t(x)}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </section>
      <section className="setting-row">
        <h3>{t("language")}</h3>
        <ToggleButtonGroup
          exclusive
          value={i18n.language}
          onChange={(_, v) => v && setLanguage(v)}
        >
          <ToggleButton value="en">English</ToggleButton>
          <ToggleButton value="hi">हिंदी</ToggleButton>
        </ToggleButtonGroup>
      </section>
      <section>
        <h3>{t("privacy")}</h3>
        <p>
          {user?.name} · {user?.email}
        </p>
        <p className="muted">{demoMode ? t("demoNotice") : t("disclaimer")}</p>
        <div className="row">
          <Button variant="outlined" onClick={exportAll}>
            {t("export")}
          </Button>
          <Button color="error" onClick={() => setConfirm(true)}>
            {t("deleteAccount")}
          </Button>
        </div>
      </section>
      <Connectors />
      <Dialog open={confirm} onClose={() => setConfirm(false)}>
        <DialogTitle>{t("deleteAccount")}</DialogTitle>
        <DialogContent>{t("deleteConfirm")}</DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(false)}>{t("cancel")}</Button>
          <Button color="error" onClick={remove}>
            {t("delete")}
          </Button>
        </DialogActions>
      </Dialog>
    </main>
  );
}
