import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  TextField,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { api, post } from "../services/api";
import { ErrorNotice, Loading } from "../components/Common";

export default function Connectors() {
  const { t, i18n } = useTranslation();
  const hi = i18n.language === "hi";
  const client = useQueryClient();
  const providers = useQuery({
    queryKey: ["connectors"],
    queryFn: () => api("/connectors"),
  });
  const grants = useQuery({
    queryKey: ["connector-grants"],
    queryFn: () => api("/connectors/grants"),
  });
  const [provider, setProvider] = useState("");
  const [scope, setScope] = useState("");
  const [purpose, setPurpose] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const chosen = providers.data?.connectors.find(
    (item) => item.id === provider,
  );
  async function mutate(path, body, method = "POST") {
    setBusy(true);
    setError("");
    try {
      if (method === "POST") await post(path, body);
      else await api(path, { method });
      await client.invalidateQueries({ queryKey: ["connector-grants"] });
      setConfirmed(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h3>
        {hi ? "सदस्यता स्रोतों की अनुमति" : "Subscription source permissions"}
      </h3>
      <p className="muted">
        {hi
          ? "अनुमति एक स्रोत और अधिकार क्षेत्र के लिए 30 मिनट तक मान्य है। इसे कभी भी वापस लें।"
          : "Permissions apply to one source and jurisdiction for 30 minutes. Revoke them at any time."}
      </p>
      {error && <Alert severity="error">{error}</Alert>}
      {providers.isPending || grants.isPending ? (
        <Loading />
      ) : providers.error || grants.error ? (
        <ErrorNotice error={providers.error || grants.error} />
      ) : (
        <>
          {!providers.data.connectors.length ? (
            <p>
              {hi
                ? "अभी कोई अधिकृत सदस्यता स्रोत जुड़ा नहीं है।"
                : "No authorized subscription provider is connected yet."}
            </p>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                mutate("/connectors/grants", {
                  provider,
                  scope,
                  purpose,
                  permission_confirmed: confirmed,
                  duration_minutes: 30,
                });
              }}
            >
              <TextField
                select
                fullWidth
                margin="dense"
                label={hi ? "स्रोत" : "Provider"}
                value={provider}
                onChange={(e) => {
                  setProvider(e.target.value);
                  setScope("");
                  setConfirmed(false);
                }}
              >
                {providers.data.connectors.map((item) => (
                  <MenuItem key={item.id} value={item.id}>
                    {item.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                fullWidth
                margin="dense"
                label={t("jurisdiction")}
                value={scope}
                onChange={(e) => {
                  setScope(e.target.value);
                  setConfirmed(false);
                }}
              >
                {(chosen?.scopes || []).map((value) => (
                  <MenuItem key={value} value={value}>
                    {t(value)}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                fullWidth
                margin="dense"
                label={hi ? "उद्देश्य" : "Purpose"}
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                inputProps={{ minLength: 5, maxLength: 250 }}
                required
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                }
                label={
                  hi
                    ? "मेरे पास स्रोत उपयोग का अधिकार है और मैं इस सीमित पहुँच की अनुमति देता/देती हूँ।"
                    : "I have the right to use this source and authorize this limited access."
                }
              />
              <Button
                type="submit"
                disabled={
                  busy ||
                  !confirmed ||
                  !scope ||
                  !provider ||
                  purpose.trim().length < 5
                }
              >
                {hi ? "अनुमति दें" : "Grant permission"}
              </Button>
            </form>
          )}
          {grants.data.map((grant) => (
            <div className="setting-row" key={grant.id}>
              <div>
                <strong>
                  {grant.provider} · {t(grant.scope)}
                </strong>
                <p className="small muted">
                  {grant.purpose}
                  <br />
                  {new Date(grant.expires_at).toLocaleString(i18n.language)}
                </p>
              </div>
              {grant.revoked || new Date(grant.expires_at) <= new Date() ? (
                <span>{hi ? "निष्क्रिय" : "Inactive"}</span>
              ) : (
                <Button
                  color="error"
                  disabled={busy}
                  onClick={() =>
                    mutate(`/connectors/grants/${grant.id}`, null, "DELETE")
                  }
                >
                  {hi ? "अनुमति वापस लें" : "Revoke permission"}
                </Button>
              )}
            </div>
          ))}
        </>
      )}
    </section>
  );
}
