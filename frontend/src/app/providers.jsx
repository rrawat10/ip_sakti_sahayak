import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { ThemeProvider, createTheme, CssBaseline } from "@mui/material";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useAuth as useClerkAuth, useUser } from "@clerk/react";
import { api, post, demoMode, testAuth, setAuthTokenProvider } from "../services/api";
import i18n from "../locales";
const PreferencesContext = createContext();
const AuthContext = createContext();
export const usePreferences = () => useContext(PreferencesContext);
export const useAuth = () => useContext(AuthContext);
const client = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30000 },
  },
});
function DemoAuthProvider({ children }) {
  const queryClient = useQueryClient();
  const session = useQuery({
    queryKey: ["session"],
    queryFn: async () => {
      try {
        return await api("/auth/me");
      } catch (error) {
        if (error.status === 401) return null;
        throw error;
      }
    },
  });
  async function login(action, body) {
    const result = await post(`/auth/${action}`, body);
    await queryClient.cancelQueries();
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] !== "session",
    });
    queryClient.setQueryData(["session"], result);
    return result;
  }
  async function logout() {
    await post("/auth/logout");
    await queryClient.cancelQueries();
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] !== "session",
    });
    queryClient.setQueryData(["session"], null);
  }
  return (
    <AuthContext.Provider
      value={{
        user: session.data?.user,
        loading: session.isPending,
        error: session.error,
        retry: session.refetch,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
function ClerkAuthProvider({ children }) {
  const queryClient = useQueryClient();
  const { isLoaded, isSignedIn, getToken, signOut } = useClerkAuth();
  const { user: clerkUser } = useUser();
  useEffect(() => {
    setAuthTokenProvider(getToken);
    return () => setAuthTokenProvider(null);
  }, [getToken]);
  const user = isSignedIn && clerkUser
    ? {
        id: clerkUser.id,
        name: clerkUser.fullName || clerkUser.firstName || "Researcher",
        email: clerkUser.primaryEmailAddress?.emailAddress || "",
      }
    : null;
  async function logout() {
    queryClient.clear();
    await signOut();
  }
  async function deleteIdentity() {
    await clerkUser?.delete();
    queryClient.clear();
  }
  return (
    <AuthContext.Provider
      value={{ user, loading: !isLoaded, error: null, retry: () => {}, logout, deleteIdentity }}
    >
      {children}
    </AuthContext.Provider>
  );
}
function TestAuthProvider({ children }) {
  useEffect(() => {
    setAuthTokenProvider(async () => "test:browser-user");
    return () => setAuthTokenProvider(null);
  }, []);
  return <AuthContext.Provider value={{
    user: { id: "browser-user", name: "Browser Researcher", email: "browser@example.com" },
    loading: false,
    error: null,
    retry: () => {},
    logout: async () => setAuthTokenProvider(null),
  }}>{children}</AuthContext.Provider>;
}
function AuthProvider({ children }) {
  return testAuth ? (
    <TestAuthProvider>{children}</TestAuthProvider>
  ) : demoMode ? (
    <DemoAuthProvider>{children}</DemoAuthProvider>
  ) : (
    <ClerkAuthProvider>{children}</ClerkAuthProvider>
  );
}
export function Providers({ children }) {
  const [mode, setMode] = useState(() => {
    try {
      return localStorage.getItem("sakti-theme") === "dark" ? "dark" : "light";
    } catch {
      return "light";
    }
  });
  useEffect(() => {
    document.body.dataset.theme = mode;
  }, [mode]);
  useEffect(() => {
    const syncLanguage = () => {
      document.documentElement.lang = i18n.resolvedLanguage || "en";
    };
    syncLanguage();
    i18n.on("languageChanged", syncLanguage);
    return () => i18n.off("languageChanged", syncLanguage);
  }, []);
  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          mode,
          primary: { main: mode === "light" ? "#087b4b" : "#a8d5bd" },
          background: {
            default: mode === "light" ? "#ffffff" : "#171e1b",
            paper: mode === "light" ? "#ffffff" : "#202924",
          },
          text: {
            primary: mode === "light" ? "#14372b" : "#e3f1e8",
            secondary: mode === "light" ? "#626e69" : "#b1beb4",
          },
          divider: mode === "light" ? "#e5e9e7" : "#35423a",
        },
        typography: {
          fontFamily: '"Geist", "Noto Sans Devanagari", sans-serif',
          button: { textTransform: "none", fontWeight: 600 },
          h1: { fontWeight: 500 },
          h2: { fontWeight: 500 },
        },
        shape: { borderRadius: 8 },
        components: {
          MuiButton: {
            defaultProps: { disableElevation: true },
            styleOverrides: { root: { padding: "9px 17px" } },
          },
          MuiTextField: { defaultProps: { size: "small" } },
          MuiPaper: { defaultProps: { elevation: 0 } },
          MuiTooltip: { defaultProps: { arrow: true } },
          MuiDialog: { styleOverrides: { paper: { backgroundImage: "none" } } },
        },
      }),
    [mode],
  );
  const value = {
    mode,
    setMode: (value) => {
      if (!["light", "dark"].includes(value)) return;
      setMode(value);
      try {
        localStorage.setItem("sakti-theme", value);
      } catch {
        /* Preferences still work when browser storage is unavailable. */
      }
    },
    setLanguage: (value) => {
      if (!["en", "hi"].includes(value)) return;
      i18n.changeLanguage(value);
      try {
        localStorage.setItem("sakti-language", value);
      } catch {
        /* Preferences still work when browser storage is unavailable. */
      }
    },
  };
  return (
    <QueryClientProvider client={client}>
      <PreferencesContext.Provider value={value}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <div className={`theme-${mode}`}>
            <AuthProvider>{children}</AuthProvider>
          </div>
        </ThemeProvider>
      </PreferencesContext.Provider>
    </QueryClientProvider>
  );
}
