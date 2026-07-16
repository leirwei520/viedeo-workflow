import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import './i18n';
import { AuthProvider, useAuthState } from './hooks/useAuth';
import { ThemeProvider, useThemeState } from './hooks/useTheme';
import { CanvasBackgroundProvider, useCanvasBackgroundState } from './hooks/useCanvasBackground';
import { initServerUrl } from './config/api';
import { useDataPreload } from './hooks/useDataPreload';

const App = React.lazy(() => import('./App'));
const LoginPage = React.lazy(() => import('./components/pages/LoginPage').then(m => ({ default: m.LoginPage })));
const AdminPage = React.lazy(() => import('./components/pages/AdminPage').then(m => ({ default: m.AdminPage })));

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen w-screen flex items-center justify-center" style={{ background: '#020a12' }}>
          <div className="flex flex-col items-center gap-4 max-w-md text-center px-6">
            <div className="text-4xl">⚠️</div>
            <h2 className="text-lg font-medium text-white">Something went wrong</h2>
            <p className="text-sm text-neutral-400">{this.state.error?.message}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-2 px-4 py-2 rounded-lg bg-white/10 text-white text-sm hover:bg-white/20 transition-colors"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function AuthGate() {
  const auth = useAuthState();
  const themeCtx = useThemeState();
  const canvasBgCtx = useCanvasBackgroundState();
  useDataPreload(auth.token);

  return (
    <AuthProvider value={auth}>
    <ThemeProvider value={themeCtx}>
    <CanvasBackgroundProvider value={canvasBgCtx}>
      <Suspense fallback={<LoadingScreen />}>
      <Routes>
        <Route path="/login" element={
          auth.token ? <Navigate to="/" replace /> : <LoginPage />
        } />
        <Route path="/admin" element={
          auth.loading ? (
            <LoadingScreen />
          ) : auth.token ? (
            <AdminPage />
          ) : (
            <Navigate to="/login" replace />
          )
        } />
        <Route path="/*" element={
          auth.loading ? (
            <LoadingScreen />
          ) : auth.token ? (
            <App />
          ) : (
            <Navigate to="/login" replace />
          )
        } />
      </Routes>
      </Suspense>
    </CanvasBackgroundProvider>
    </ThemeProvider>
    </AuthProvider>
  );
}

function LoadingScreen() {
  return (
    <div
      className="h-screen w-screen flex items-center justify-center"
      style={{ background: '#020a12' }}
      data-theme="dark"
    >
      <div className="flex flex-col items-center gap-4">
        <div
          className="w-8 h-8 rounded-full animate-spin"
          style={{
            border: '2px solid rgba(255,255,255,0.1)',
            borderTopColor: 'transparent',
            borderImage: 'linear-gradient(135deg, #ff6b9d, #c084fc, #60a5fa, #34d399) 1',
            borderRadius: '50%',
          }}
        />
        <span
          className="text-xs tracking-[0.3em] uppercase sf-rainbow-text"
          style={{ opacity: 0.7 }}
        >
          Initializing...
        </span>
      </div>
    </div>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

async function bootstrap() {
  await initServerUrl();

  const root = ReactDOM.createRoot(rootElement!);
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <HashRouter>
          <AuthGate />
        </HashRouter>
      </ErrorBoundary>
    </React.StrictMode>
  );
}

bootstrap();
