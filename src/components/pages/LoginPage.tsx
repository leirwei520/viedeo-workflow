import React, { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { User, Lock, Eye, EyeOff, ShieldCheck, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AuroraBackground } from "../ui/aurora-background";
import { HoverBorderGradient } from "../ui/hover-border-gradient";
import { useAuth } from "../../hooks/useAuth";
import { sanitizeError } from "../../utils/errorSanitizer";

const REMEMBER_KEY = 'login_remember';

function loadSavedCredentials() {
  try {
    const raw = localStorage.getItem(REMEMBER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as { username: string; password: string };
  } catch { return null; }
}

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const { t } = useTranslation();

  const saved = loadSavedCredentials();
  const [username, setUsername] = useState(saved?.username ?? "");
  const [password, setPassword] = useState(saved?.password ?? "");
  const [rememberMe, setRememberMe] = useState(!!saved);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError("");
      setLoading(true);

      try {
        await login({ username, password });
        if (rememberMe) {
          localStorage.setItem(REMEMBER_KEY, JSON.stringify({ username, password }));
        } else {
          localStorage.removeItem(REMEMBER_KEY);
        }
        navigate("/", { replace: true });
      } catch (err: any) {
        setError(err.message || t('login.failed'));
      } finally {
        setLoading(false);
      }
    },
    [username, password, rememberMe, login, navigate]
  );

  const inputStyle = {
    background: "rgba(0,0,0,0.3)",
    border: "1px solid rgba(255,255,255,0.1)",
    color: "#e2d4f0",
    caretColor: "#c084fc",
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.style.borderColor = "rgba(192,132,252,0.3)";
    e.target.style.boxShadow = "0 0 12px rgba(192,132,252,0.15)";
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.style.borderColor = "rgba(255,255,255,0.1)";
    e.target.style.boxShadow = "none";
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden" data-theme="dark" style={{ background: "#020a12" }}>
      <AuroraBackground
        variant="cyber"
        speed={1.2}
        blobCount={6}
        className="absolute inset-0 h-full w-full"
        childrenClassName="flex h-full w-full items-center justify-center"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="relative w-full max-w-md mx-4"
        >
          <HoverBorderGradient
            containerClassName="rounded-2xl w-full"
            className="rounded-[14px] bg-[rgba(6,17,28,0.92)] px-8 py-10"
            duration={3}
          >
            {/* Header */}
            <div className="text-center mb-8">
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
              >
                <div className="flex items-center justify-center gap-2 mb-1">
                  <div
                    className="h-2 w-2 rounded-full"
                    style={{ background: "linear-gradient(135deg, #ff6b9d, #c084fc, #60a5fa)", boxShadow: "0 0 8px rgba(192,132,252,0.5)" }}
                  />
                  <span
                    className="text-xs tracking-[0.3em] uppercase"
                    style={{ color: "rgba(192,132,252,0.6)" }}
                  >
                    System Online
                  </span>
                </div>
                <h1
                  className="text-3xl font-bold tracking-wider mt-3"
                  style={{
                    color: "#e2d4f0",
                    textShadow: "0 0 20px rgba(192,132,252,0.3), 0 0 40px rgba(96,165,250,0.1)",
                  }}
                >
                  CHUHAI BANG
                </h1>
                <p
                  className="text-sm mt-1 tracking-widest"
                  style={{ color: "rgba(90,138,158,0.8)" }}
                >
                  Internal Access
                </p>
              </motion.div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Username */}
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "rgba(255,255,255,0.3)" }}>
                  <User size={16} />
                </div>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t('login.usernamePlaceholder')}
                  required
                  autoComplete="username"
                  className="w-full pl-10 pr-4 py-3 rounded-lg text-sm outline-none transition-all duration-300"
                  style={inputStyle}
                  onFocus={handleFocus}
                  onBlur={handleBlur}
                />
              </div>

              {/* Password */}
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "rgba(255,255,255,0.3)" }}>
                  <Lock size={16} />
                </div>
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('login.passwordPlaceholder')}
                  required
                  autoComplete="current-password"
                  className="w-full pl-10 pr-10 py-3 rounded-lg text-sm outline-none transition-all duration-300"
                  style={inputStyle}
                  onFocus={handleFocus}
                  onBlur={handleBlur}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
                  style={{ color: "rgba(255,255,255,0.3)" }}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>

              {/* Remember Password */}
              <label className="flex items-center gap-2 cursor-pointer select-none group">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div
                    className="w-4 h-4 rounded border transition-all duration-200 peer-checked:border-purple-400/60 peer-checked:bg-purple-500/20"
                    style={{ borderColor: 'rgba(255,255,255,0.15)', background: rememberMe ? 'rgba(192,132,252,0.15)' : 'rgba(0,0,0,0.3)' }}
                  >
                    {rememberMe && (
                      <svg className="w-4 h-4 text-purple-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 8l3 3 5-6" />
                      </svg>
                    )}
                  </div>
                </div>
                <span className="text-xs transition-colors" style={{ color: 'rgba(180,200,220,0.5)' }}>
                  {t('login.rememberMe')}
                </span>
              </label>

              {/* Error message */}
              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    className="text-xs px-3 py-2 rounded-md"
                    style={{
                      background: "rgba(255,0,80,0.1)",
                      border: "1px solid rgba(255,0,80,0.2)",
                      color: "#ff4d6a",
                    }}
                  >
                    {sanitizeError(error)}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Submit */}
              <motion.button
                type="submit"
                disabled={loading}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="w-full py-3.5 rounded-lg text-sm font-bold tracking-widest uppercase transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                style={{
                  background: loading
                    ? "rgba(255,255,255,0.05)"
                    : "linear-gradient(135deg, rgba(255,100,150,0.15), rgba(100,150,255,0.15), rgba(100,255,200,0.12))",
                  border: "1px solid rgba(255,255,255,0.2)",
                  color: "#e0f0ff",
                  boxShadow: loading ? "none" : "0 0 20px rgba(192,132,252,0.15), inset 0 1px 0 rgba(255,255,255,0.1)",
                  textShadow: "0 0 10px rgba(255,255,255,0.3)",
                }}
              >
                {loading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <>
                    <ShieldCheck size={16} />
                    {t('login.submit')}
                  </>
                )}
              </motion.button>
            </form>

            {/* Footer */}
            <div className="mt-6 flex items-center justify-between text-[10px] tracking-wider" style={{ color: "rgba(90,138,158,0.4)" }}>
              <span>◇ NODE: CN-EAST</span>
              <span>◇ LATENCY: 12ms</span>
              <span>◇ v2.0.0</span>
            </div>
          </HoverBorderGradient>
        </motion.div>
      </AuroraBackground>
    </div>
  );
};
