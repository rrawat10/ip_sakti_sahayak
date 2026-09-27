import { lazy, Suspense } from "react";
import { Routes, Route, Navigate, useLocation, Link } from "react-router-dom";
import { Button } from "@mui/material";
import { useTranslation } from "react-i18next";
import { useAuth } from "./providers";
import { Header, Footer, Loading, ErrorNotice } from "../components/Common";
import { Home, About } from "../features/Public";
import { Knowledge } from "../features/Knowledge";
const Auth = lazy(() => import("../features/Auth"));
const Workspace = lazy(() => import("../features/Workspace"));
const Settings = lazy(() => import("../features/Settings"));
function Protected({ children }) {
  const { user, loading, error, retry } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (error)
    return (
      <Public>
        <main className="public-main">
          <ErrorNotice error={error} retry={retry} />
        </main>
      </Public>
    );
  return user ? (
    children
  ) : (
    <Navigate
      to="/sign-in"
      replace
      state={{ from: location.pathname + location.search }}
    />
  );
}
function Public({ children }) {
  return (
    <>
      <Header />
      {children}
      <Footer />
    </>
  );
}
function LibraryRedirect() {
  return <Navigate to={`/library${useLocation().search}`} replace />;
}
function NotFound() {
  const { t } = useTranslation();
  return (
    <Public>
      <main className="public-main">
        <h1>404</h1>
        <p>{t("noResults")}</p>
        <Button component={Link} to="/">
          {t("home")}
        </Button>
      </main>
    </Public>
  );
}
export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route
          path="/"
          element={
            <Public>
              <Home />
            </Public>
          }
        />
        <Route
          path="/library"
          element={
            <Public>
              <Knowledge />
            </Public>
          }
        />
        <Route
          path="/demo"
          element={<Workspace temporary />}
        />
        <Route path="/learn" element={<LibraryRedirect />} />
        <Route path="/sources" element={<LibraryRedirect />} />
        <Route
          path="/about"
          element={
            <Public>
              <About />
            </Public>
          }
        />
        {["sign-in", "sign-up"].map(
          (kind) => (
            <Route
              key={kind}
              path={`/${kind}/*`}
              element={
                <Public>
                  <Auth key={kind} kind={kind} />
                </Public>
              }
            />
          ),
        )}
        <Route
          path="/consultations"
          element={
            <Protected>
              <Workspace />
            </Protected>
          }
        />
        <Route
          path="/consultations/:id"
          element={
            <Protected>
              <Workspace />
            </Protected>
          }
        />
        <Route
          path="/settings"
          element={
            <Protected>
              <Public>
                <Settings />
              </Public>
            </Protected>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
