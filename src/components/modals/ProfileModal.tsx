import React, { useState, useEffect, useCallback } from 'react';
import { X, User, Wallet, ScrollText, Image as ImageIcon, Film, Loader2, LogOut, ChevronDown, Check, CheckCircle2, XCircle, Camera, MessageSquare, TrendingUp, CalendarDays, KeyRound, Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../hooks/useTheme';
import { API_URL, authFetch, ossThumb } from '../../config/api';
import { HoverBorderGradient } from '../ui/hover-border-gradient';
import { sanitizeError } from '../../utils/errorSanitizer';

interface UsageStats {
  totalGenerations: number;
  totalImages: number;
  totalVideos: number;
  totalText: number;
  totalSpent: number;
  totalTokens: number;
  totalFailed: number;
  todayCount: number;
  weekCount: number;
  monthCount: number;
  byModel: { model: string; type: string; count: number; totalCost: number }[];
}

interface UsageLog {
  id: number;
  type: 'image' | 'video' | 'text';
  model: string;
  prompt: string | null;
  cost: number;
  tokens: number;
  status: 'success' | 'failed';
  resultUrl: string | null;
  createdAt: string;
}

interface ModelPricing {
  modelId: string;
  modelName: string;
  type: 'image' | 'video' | 'text';
  provider: string;
  baseCost: number;
  costPerSecond: number;
  costPer1kTokens: number;
  sortOrder: number;
}

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabId = 'info' | 'wallet' | 'records';

const TAB_ICONS: Record<TabId, React.ReactNode> = {
  info: <User size={16} />,
  wallet: <Wallet size={16} />,
  records: <ScrollText size={16} />,
};

export const ProfileModal: React.FC<ProfileModalProps> = ({ isOpen, onClose }) => {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const { user, token, logout, refreshUser, updateTokens } = useAuth();

  const [activeTab, setActiveTab] = useState<TabId>('info');
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [logs, setLogs] = useState<UsageLog[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsPage, setLogsPage] = useState(1);
  const [logsTotalPages, setLogsTotalPages] = useState(1);
  const [logsFilter, setLogsFilter] = useState<'all' | 'image' | 'video' | 'text'>('all');
  const [loading, setLoading] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [pricing, setPricing] = useState<ModelPricing[]>([]);

  useEffect(() => {
    if (!isOpen || !token) return;
    setLoading(true);
    Promise.all([
      authFetch(`${API_URL}/usage/stats`).then(r => r.json()),
      authFetch(`${API_URL}/pricing`).then(r => r.json()),
    ]).then(([statsData, pricingData]) => {
      if (statsData && !statsData.error && typeof statsData.totalGenerations !== 'undefined') {
        setStats({
          totalGenerations: Number(statsData.totalGenerations) || 0,
          totalImages: Number(statsData.totalImages) || 0,
          totalVideos: Number(statsData.totalVideos) || 0,
          totalText: Number(statsData.totalText) || 0,
          totalSpent: Number(statsData.totalSpent) || 0,
          totalTokens: Number(statsData.totalTokens) || 0,
          totalFailed: Number(statsData.totalFailed) || 0,
          todayCount: Number(statsData.todayCount) || 0,
          weekCount: Number(statsData.weekCount) || 0,
          monthCount: Number(statsData.monthCount) || 0,
          byModel: Array.isArray(statsData.byModel) ? statsData.byModel : [],
        });
      }
      setPricing(Array.isArray(pricingData?.pricing) ? pricingData.pricing : []);
    }).catch(console.error).finally(() => setLoading(false));
  }, [isOpen, token]);

  const fetchLogs = useCallback(async (page: number, filter: 'all' | 'image' | 'video' | 'text') => {
    if (!token) return;
    setLogsLoading(true);
    try {
      const typeParam = filter !== 'all' ? `&type=${filter}` : '';
      const res = await authFetch(`${API_URL}/usage/logs?page=${page}&limit=15${typeParam}`);
      const data = await res.json();
      if (!res.ok || !data.logs) return;
      if (page === 1) {
        setLogs(data.logs);
      } else {
        setLogs(prev => [...prev, ...data.logs]);
      }
      setLogsTotal(data.total || 0);
      setLogsTotalPages(data.totalPages || 1);
      setLogsPage(data.page || 1);
    } catch (err) {
      console.error(err);
    } finally {
      setLogsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!isOpen || activeTab !== 'records') return;
    fetchLogs(1, logsFilter);
  }, [isOpen, activeTab, logsFilter, fetchLogs]);

  const handleLogout = () => {
    logout();
    onClose();
  };

  if (!isOpen) return null;

  const tabs: { id: TabId; label: string }[] = [
    { id: 'info', label: t('profile.personalInfo') },
    { id: 'wallet', label: t('profile.wallet') },
    { id: 'records', label: t('profile.usageRecords') },
  ];

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch { return dateStr; }
  };

  const formatDateTime = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return dateStr; }
  };

  return (
    <div
      className={`fixed inset-0 z-[9999] backdrop-blur-sm flex items-center justify-center p-4 ${isDark ? 'bg-black/80' : 'bg-black/40'}`}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <HoverBorderGradient
        containerClassName="rounded-xl w-[600px]"
        className={`rounded-[10px] ${isDark ? 'bg-[var(--sf-bg-panel)]' : 'bg-white'}`}
        fillClassName={isDark ? undefined : 'bg-white'}
        duration={4}
      >
        <div className="max-h-[80vh] flex flex-col overflow-hidden">
          {/* Header */}
          <div className={`flex items-center justify-between px-6 py-4 border-b ${isDark ? 'border-neutral-800' : 'border-gray-200'}`}>
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${isDark ? 'bg-white/10 border border-white/20' : 'bg-gradient-to-br from-pink-500 via-purple-500 to-blue-600'}`}>
                <User size={18} className="text-white" />
              </div>
              <h2 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>{t('profile.title')}</h2>
            </div>
            <button
              onClick={onClose}
              className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-neutral-800 text-neutral-400 hover:text-white' : 'hover:bg-gray-100 text-gray-400 hover:text-gray-700'}`}
            >
              <X size={18} />
            </button>
          </div>

          {/* Tabs */}
          <div className={`flex gap-1 px-6 pt-3 border-b ${isDark ? 'border-neutral-800' : 'border-gray-200'}`}>
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors relative
                  ${activeTab === tab.id
                    ? (isDark ? 'text-white' : 'text-gray-900')
                    : (isDark ? 'text-neutral-500 hover:text-neutral-300' : 'text-gray-400 hover:text-gray-600')
                  }`}
              >
                {TAB_ICONS[tab.id]}
                {tab.label}
                {activeTab === tab.id && (
                  <div className="absolute bottom-0 left-2 right-2 h-[2px] bg-gradient-to-r from-pink-400 via-purple-400 to-blue-400 rounded-full" />
                )}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {loading && activeTab !== 'records' ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={24} className="animate-spin text-neutral-500" />
              </div>
            ) : (
              <>
                {activeTab === 'info' && <InfoTab user={user} isDark={isDark} t={t} formatDate={formatDate} onLogout={handleLogout} token={token} onAvatarUpdated={refreshUser} onUpdateTokens={updateTokens} />}
                {activeTab === 'wallet' && <WalletTab user={user} stats={stats} pricing={pricing} isDark={isDark} t={t} />}
                {activeTab === 'records' && (
                  <RecordsTab
                    logs={logs}
                    logsTotal={logsTotal}
                    logsPage={logsPage}
                    logsTotalPages={logsTotalPages}
                    logsFilter={logsFilter}
                    logsLoading={logsLoading}
                    onFilterChange={(f) => { setLogsFilter(f); setLogsPage(1); }}
                    onLoadMore={() => fetchLogs(logsPage + 1, logsFilter)}
                    pricing={pricing}
                    isDark={isDark}
                    t={t}
                    formatDateTime={formatDateTime}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </HoverBorderGradient>
    </div>
  );
};

// ============================================================================
// Tab: Personal Info
// ============================================================================

const InfoTab: React.FC<{
  user: any;
  isDark: boolean;
  t: (key: string) => string;
  formatDate: (d: string) => string;
  onLogout: () => void;
  token: string | null;
  onAvatarUpdated: () => Promise<void>;
  onUpdateTokens: (accessToken: string, refreshToken: string) => void;
}> = ({ user, isDark, t, formatDate, onLogout, token, onAvatarUpdated, onUpdateTokens }) => {
  const [uploading, setUploading] = React.useState(false);
  const [showPwdModal, setShowPwdModal] = React.useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !token) return;

    setUploading(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const res = await authFetch(`${API_URL}/auth/avatar`, {
        method: 'POST',
        body: JSON.stringify({ avatar: base64 }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Upload failed');
      }

      await onAvatarUpdated();
    } catch (err) {
      console.error('Avatar upload failed:', err);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const avatarSrc = ossThumb(user?.avatar_url, 64) || 'https://api.dicebear.com/7.x/initials/svg?seed=' + (user?.nickname || user?.username || 'U');

  return (
    <div className="space-y-6">
      {/* Avatar + Name */}
      <div className="flex items-center gap-4">
        <label
          className={`relative w-16 h-16 rounded-2xl overflow-hidden border-2 group cursor-pointer transition-all block ${isDark ? 'border-white/20 hover:border-purple-400/50' : 'border-gray-200 hover:border-purple-400/50'} ${uploading ? 'pointer-events-none' : ''}`}
        >
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="absolute w-px h-px overflow-hidden"
            style={{ clip: 'rect(0,0,0,0)' }}
            tabIndex={-1}
            onChange={handleFileChange}
          />
          <img src={avatarSrc} alt="Avatar" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            {uploading ? <Loader2 size={18} className="text-white animate-spin" /> : <Camera size={18} className="text-white" />}
          </div>
        </label>
        <div>
          <h3 className={`text-xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
            {user?.nickname || user?.username || '-'}
          </h3>
          <p className={`text-sm ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>@{user?.username}</p>
        </div>
      </div>

      {/* Info Fields */}
      <div className="space-y-3">
        <InfoRow label={t('profile.username')} value={user?.username} isDark={isDark} />
        <InfoRow label={t('profile.nickname')} value={user?.nickname || '-'} isDark={isDark} />
        <InfoRow label={t('profile.memberSince')} value={user?.created_at ? formatDate(user.created_at) : '-'} isDark={isDark} />
        <InfoRow label={t('profile.tokenBalance')} value={`¥${Number(user?.token_balance || 0).toFixed(2)}`} isDark={isDark} highlight />
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        {isDark ? (
          <HoverBorderGradient as="button" containerClassName="rounded-xl" className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-[var(--sf-bg-deep)] text-white" duration={2} onClick={() => setShowPwdModal(true)}>
            <KeyRound size={15} />
            {t('profile.changePwd.title')}
          </HoverBorderGradient>
        ) : (
          <button onClick={() => setShowPwdModal(true)} className="lt-btn-primary text-white flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium">
            <KeyRound size={15} />
            {t('profile.changePwd.title')}
          </button>
        )}
        {isDark ? (
          <HoverBorderGradient as="button" containerClassName="rounded-xl" className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-[var(--sf-bg-deep)] text-white" duration={2} onClick={onLogout}>
            <LogOut size={15} />
            {t('profile.logout')}
          </HoverBorderGradient>
        ) : (
          <button onClick={onLogout} className="lt-btn-primary text-white flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium">
            <LogOut size={15} />
            {t('profile.logout')}
          </button>
        )}
      </div>

      {showPwdModal && <ChangePasswordModal isDark={isDark} t={t} token={token} onClose={() => setShowPwdModal(false)} onUpdateTokens={onUpdateTokens} />}
    </div>
  );
};

const ChangePasswordModal: React.FC<{ isDark: boolean; t: (key: string) => string; token: string | null; onClose: () => void; onUpdateTokens: (accessToken: string, refreshToken: string) => void }> = ({ isDark, t, token, onClose, onUpdateTokens }) => {
  const [oldPwd, setOldPwd] = React.useState('');
  const [newPwd, setNewPwd] = React.useState('');
  const [confirmPwd, setConfirmPwd] = React.useState('');
  const [showOld, setShowOld] = React.useState(false);
  const [showNew, setShowNew] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [success, setSuccess] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout>>();

  React.useEffect(() => () => { clearTimeout(timerRef.current); }, []);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError('');
    if (!oldPwd) { setError(t('profile.changePwd.oldRequired')); return; }
    if (!newPwd) { setError(t('profile.changePwd.newRequired')); return; }
    if (newPwd.length < 6) { setError(t('profile.changePwd.tooShort')); return; }
    if (newPwd !== confirmPwd) { setError(t('profile.changePwd.mismatch')); return; }
    if (oldPwd === newPwd) { setError(t('profile.changePwd.sameAsOld')); return; }

    setLoading(true);
    try {
      const res = await authFetch(`${API_URL}/auth/change-password`, {
        method: 'POST',
        body: JSON.stringify({ oldPassword: oldPwd, newPassword: newPwd }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('profile.changePwd.failed'));

      if (data.access_token && data.refresh_token) {
        onUpdateTokens(data.access_token, data.refresh_token);
      }
      localStorage.removeItem('login_remember');

      setSuccess(true);
      timerRef.current = setTimeout(onClose, 1500);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const inputCls = `w-full rounded-lg px-3 py-2.5 text-sm focus:outline-none ${isDark
    ? 'bg-neutral-900 border border-neutral-700 text-white placeholder-neutral-500 focus:border-white/30'
    : 'bg-gray-50 border border-gray-200 text-gray-900 placeholder-gray-400 focus:border-gray-400'
  }`;

  return (
    <div
      className={`fixed inset-0 z-[10000] backdrop-blur-sm flex items-center justify-center p-4 ${isDark ? 'bg-black/80' : 'bg-black/40'}`}
      onClick={(e) => e.target === e.currentTarget && !loading && !success && onClose()}
    >
      <HoverBorderGradient
        containerClassName="rounded-xl w-[400px]"
        className={`rounded-[10px] ${isDark ? 'bg-[var(--sf-bg-panel)]' : 'bg-white'}`}
        fillClassName={isDark ? undefined : 'bg-white'}
        duration={4}
      >
        {/* Header */}
        <div className={`flex items-center justify-between px-6 py-4 border-b ${isDark ? 'border-neutral-800' : 'border-gray-200'}`}>
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${isDark ? 'bg-white/10 border border-white/20' : 'bg-gradient-to-br from-pink-500 via-purple-500 to-blue-600'}`}>
              <KeyRound size={18} className="text-white" />
            </div>
            <h2 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>{t('profile.changePwd.title')}</h2>
          </div>
          <button
            onClick={onClose}
            className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-neutral-800 text-neutral-400 hover:text-white' : 'hover:bg-gray-100 text-gray-400 hover:text-gray-700'}`}
          >
            <X size={18} />
          </button>
        </div>

        {/* Content + Footer as form for Enter key support */}
        <form onSubmit={handleSubmit}>
          <div className="px-6 py-5 space-y-4">
            <div>
              <label className={`text-xs font-medium mb-1.5 block ${isDark ? 'text-neutral-400' : 'text-gray-500'}`}>{t('profile.changePwd.oldPlaceholder')}</label>
              <div className="relative">
                <input type={showOld ? 'text' : 'password'} value={oldPwd} onChange={e => setOldPwd(e.target.value)} placeholder="••••••" className={inputCls} autoComplete="current-password" />
                <button type="button" onClick={() => setShowOld(!showOld)} className={`absolute right-3 top-1/2 -translate-y-1/2 ${isDark ? 'text-neutral-500 hover:text-neutral-300' : 'text-gray-400 hover:text-gray-600'}`}>
                  {showOld ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <div>
              <label className={`text-xs font-medium mb-1.5 block ${isDark ? 'text-neutral-400' : 'text-gray-500'}`}>{t('profile.changePwd.newPlaceholder')}</label>
              <div className="relative">
                <input type={showNew ? 'text' : 'password'} value={newPwd} onChange={e => setNewPwd(e.target.value)} placeholder="••••••" className={inputCls} autoComplete="new-password" />
                <button type="button" onClick={() => setShowNew(!showNew)} className={`absolute right-3 top-1/2 -translate-y-1/2 ${isDark ? 'text-neutral-500 hover:text-neutral-300' : 'text-gray-400 hover:text-gray-600'}`}>
                  {showNew ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <div>
              <label className={`text-xs font-medium mb-1.5 block ${isDark ? 'text-neutral-400' : 'text-gray-500'}`}>{t('profile.changePwd.confirmPlaceholder')}</label>
              <div className="relative">
                <input type={showNew ? 'text' : 'password'} value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)} placeholder="••••••" className={inputCls} autoComplete="new-password" />
              </div>
            </div>

            {error && (
              <div className="text-xs px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400">
                {sanitizeError(error)}
              </div>
            )}

            {success && (
              <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400">
                <CheckCircle2 size={14} />
                {t('profile.changePwd.success')}
              </div>
            )}
          </div>

          <div className={`flex items-center justify-end gap-3 px-6 py-4 border-t ${isDark ? 'border-neutral-800' : 'border-gray-200'}`}>
            {isDark ? (
              <HoverBorderGradient as="button" type="button" containerClassName="rounded-lg" className="px-4 py-2 text-sm font-medium rounded-lg bg-[var(--sf-bg-deep)] text-white" duration={2} onClick={onClose}>
                {t('common.cancel')}
              </HoverBorderGradient>
            ) : (
              <button type="button" onClick={onClose} className="lt-btn-primary text-white px-4 py-2 text-sm font-medium rounded-lg">
                {t('common.cancel')}
              </button>
            )}
            {isDark ? (
              <HoverBorderGradient as="button" type="submit" containerClassName="rounded-lg" className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-[var(--sf-bg-deep)] text-white disabled:opacity-50 disabled:cursor-not-allowed" duration={2} disabled={loading || success}>
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {t('profile.changePwd.submit')}
              </HoverBorderGradient>
            ) : (
              <button type="submit" disabled={loading || success} className="lt-btn-primary text-white flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed">
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {t('profile.changePwd.submit')}
              </button>
            )}
          </div>
        </form>
      </HoverBorderGradient>
    </div>
  );
};

const InfoRow: React.FC<{ label: string; value: string | undefined; isDark: boolean; highlight?: boolean }> = ({ label, value, isDark, highlight }) => (
  <div className={`flex items-center justify-between px-4 py-3 rounded-xl ${isDark ? 'bg-neutral-900 border border-neutral-800' : 'bg-gray-50 border border-gray-200'}`}>
    <span className={`text-sm ${isDark ? 'text-neutral-400' : 'text-gray-500'}`}>{label}</span>
    <span className={`text-sm font-medium ${highlight ? 'sf-rainbow-text' : (isDark ? 'text-white' : 'text-gray-900')}`}>{value || '-'}</span>
  </div>
);

// ============================================================================
// Tab: Wallet
// ============================================================================

const TYPE_BADGE_CLASSES: Record<string, { dark: string; light: string; icon: React.ReactNode }> = {
  image: { dark: 'bg-blue-500/10 text-blue-400', light: 'bg-blue-50 text-blue-600', icon: <ImageIcon size={10} /> },
  video: { dark: 'bg-purple-500/10 text-purple-400', light: 'bg-purple-50 text-purple-600', icon: <Film size={10} /> },
  text:  { dark: 'bg-green-500/10 text-green-400', light: 'bg-green-50 text-green-600', icon: <MessageSquare size={10} /> },
};

const TypeBadge: React.FC<{ type: string; isDark: boolean; t: (k: string) => string }> = ({ type, isDark, t }) => {
  const cfg = TYPE_BADGE_CLASSES[type] || TYPE_BADGE_CLASSES.text;
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${isDark ? cfg.dark : cfg.light}`}>
      {cfg.icon} {t(`profile.${type}`)}
    </span>
  );
};

const WalletTab: React.FC<{
  user: any;
  stats: UsageStats | null;
  pricing: ModelPricing[];
  isDark: boolean;
  t: (key: string) => string;
}> = ({ user, stats, pricing, isDark, t }) => {
  const [pricingTab, setPricingTab] = React.useState<'image' | 'video' | 'text'>('image');

  return (
    <div className="space-y-5">
      {/* Balance + Stats Hero */}
      <div className={`rounded-2xl border overflow-hidden ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
        <div className={`relative p-6 ${isDark ? 'bg-gradient-to-br from-purple-500/10 via-blue-500/10 to-pink-500/10' : 'bg-gradient-to-br from-purple-50 via-blue-50 to-pink-50'}`}>
          <div className="flex items-end justify-between">
            <div>
              <p className={`text-xs mb-1 ${isDark ? 'text-neutral-400' : 'text-gray-500'}`}>{t('profile.tokenBalance')}</p>
              <p className="text-4xl font-bold sf-rainbow-text tracking-tight">
                ¥{Number(user?.token_balance || 0).toFixed(2)}
              </p>
            </div>
            {stats && (
              <div className={`text-right ${isDark ? 'text-neutral-400' : 'text-gray-500'}`}>
                <div className="flex items-center gap-1.5 justify-end">
                  <TrendingUp size={12} />
                  <span className="text-xs">{t('profile.totalSpent')}</span>
                </div>
                <p className={`text-lg font-semibold mt-0.5 ${isDark ? 'text-white' : 'text-gray-900'}`}>¥{stats.totalSpent.toFixed(2)}</p>
              </div>
            )}
          </div>
        </div>
        {/* Inline Generation Stats */}
        <div className={`grid grid-cols-3 divide-x ${isDark ? 'divide-neutral-800 bg-neutral-900/60' : 'divide-gray-200 bg-gray-50/80'}`}>
          <div className="flex items-center gap-2.5 px-4 py-3">
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${isDark ? 'bg-blue-500/10' : 'bg-blue-50'}`}>
              <ImageIcon size={14} className={isDark ? 'text-blue-400' : 'text-blue-600'} />
            </div>
            <div>
              <p className={`text-[10px] leading-tight ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{t('profile.totalImages')}</p>
              <p className={`text-base font-bold leading-tight ${isDark ? 'text-white' : 'text-gray-900'}`}>{stats?.totalImages ?? '-'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 px-4 py-3">
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${isDark ? 'bg-purple-500/10' : 'bg-purple-50'}`}>
              <Film size={14} className={isDark ? 'text-purple-400' : 'text-purple-600'} />
            </div>
            <div>
              <p className={`text-[10px] leading-tight ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{t('profile.totalVideos')}</p>
              <p className={`text-base font-bold leading-tight ${isDark ? 'text-white' : 'text-gray-900'}`}>{stats?.totalVideos ?? '-'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 px-4 py-3">
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${isDark ? 'bg-green-500/10' : 'bg-green-50'}`}>
              <MessageSquare size={14} className={isDark ? 'text-green-400' : 'text-green-600'} />
            </div>
            <div>
              <p className={`text-[10px] leading-tight ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{t('profile.totalText')}</p>
              <p className={`text-base font-bold leading-tight ${isDark ? 'text-white' : 'text-gray-900'}`}>{stats?.totalText ?? '-'}</p>
            </div>
          </div>
        </div>
        {/* Token consumption bar */}
        {stats && stats.totalTokens > 0 && (
          <div className={`flex items-center justify-between px-5 py-2 ${isDark ? 'bg-neutral-900/40 border-t border-neutral-800' : 'bg-gray-50/60 border-t border-gray-200'}`}>
            <span className={`text-[10px] ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>Token {t('profile.totalUsage')}</span>
            <span className={`text-xs font-mono font-semibold ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>{stats.totalTokens.toLocaleString()} tokens</span>
          </div>
        )}
      </div>

      {/* Period Activity Bar */}
      <div className={`flex items-center gap-2 p-3 rounded-xl border ${isDark ? 'bg-neutral-900/50 border-neutral-800' : 'bg-gray-50 border-gray-200'}`}>
        <CalendarDays size={14} className={isDark ? 'text-neutral-500' : 'text-gray-400'} />
        {[
          { label: t('profile.todayUsage'), value: stats?.todayCount ?? 0 },
          { label: t('profile.weekUsage'), value: stats?.weekCount ?? 0 },
          { label: t('profile.monthUsage'), value: stats?.monthCount ?? 0 },
        ].map((p, i) => (
          <React.Fragment key={i}>
            {i > 0 && <div className={`w-px h-4 ${isDark ? 'bg-neutral-700' : 'bg-gray-300'}`} />}
            <div className="flex-1 text-center">
              <span className={`text-[10px] ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{p.label}</span>
              <p className={`text-sm font-bold leading-tight ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {p.value} <span className={`text-[10px] font-normal ${isDark ? 'text-neutral-600' : 'text-gray-400'}`}>{t('profile.generations')}</span>
              </p>
            </div>
          </React.Fragment>
        ))}
      </div>

      {/* Model Pricing */}
      {pricing.length > 0 && (
        <div>
          <h4 className={`text-sm font-medium mb-3 ${isDark ? 'text-white' : 'text-gray-900'}`}>{t('profile.modelPricing')}</h4>
          <div className={`flex gap-1 mb-3`}>
            {(['image', 'video', 'text'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setPricingTab(tab)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors ${pricingTab === tab
                  ? (isDark ? 'bg-white/10 text-white' : 'bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 text-white')
                  : (isDark ? 'text-neutral-500 hover:text-neutral-300' : 'text-gray-400 hover:text-gray-600')
                }`}
              >
                {tab === 'image' ? <ImageIcon size={12} /> : tab === 'video' ? <Film size={12} /> : <MessageSquare size={12} />}
                {t(`profile.${tab}`)}
              </button>
            ))}
          </div>
          <div className={`rounded-xl border overflow-hidden ${isDark ? 'border-neutral-800' : 'border-gray-200'}`}>
            <table className="w-full text-sm">
              <thead>
                <tr className={isDark ? 'bg-neutral-900' : 'bg-gray-50'}>
                  <th className={`text-left px-4 py-2 font-medium ${isDark ? 'text-neutral-400' : 'text-gray-500'}`}>{t('profile.model')}</th>
                  <th className={`text-right px-4 py-2 font-medium ${isDark ? 'text-neutral-400' : 'text-gray-500'}`}>{t('profile.baseCost')}</th>
                  {pricingTab === 'video' && <th className={`text-right px-4 py-2 font-medium ${isDark ? 'text-neutral-400' : 'text-gray-500'}`}>{t('profile.perSecond')}</th>}
                </tr>
              </thead>
              <tbody>
                {pricing.filter(p => p.type === pricingTab).map((p, i) => (
                  <tr key={i} className={`border-t ${isDark ? 'border-neutral-800' : 'border-gray-100'}`}>
                    <td className={`px-4 py-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      <span className="text-xs">{p.modelName}</span>
                      <span className={`ml-2 text-xs ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{p.modelId}</span>
                    </td>
                    <td className={`px-4 py-2 text-right font-mono text-xs ${isDark ? 'text-white' : 'text-gray-900'}`}>¥{p.baseCost.toFixed(2)}</td>
                    {pricingTab === 'video' && <td className={`px-4 py-2 text-right font-mono text-xs ${isDark ? 'text-neutral-400' : 'text-gray-500'}`}>+¥{p.costPerSecond.toFixed(2)}/s</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Model Breakdown */}
      {stats && stats.byModel && stats.byModel.length > 0 && (
        <div>
          <h4 className={`text-sm font-medium mb-3 ${isDark ? 'text-white' : 'text-gray-900'}`}>{t('profile.modelBreakdown')}</h4>
          <div className={`rounded-xl border overflow-hidden ${isDark ? 'border-neutral-800' : 'border-gray-200'}`}>
            <table className="w-full text-sm">
              <thead>
                <tr className={isDark ? 'bg-neutral-900' : 'bg-gray-50'}>
                  <th className={`text-left px-4 py-2.5 font-medium ${isDark ? 'text-neutral-400' : 'text-gray-500'}`}>{t('profile.model')}</th>
                  <th className={`text-left px-4 py-2.5 font-medium ${isDark ? 'text-neutral-400' : 'text-gray-500'}`}>{t('profile.type')}</th>
                  <th className={`text-right px-4 py-2.5 font-medium ${isDark ? 'text-neutral-400' : 'text-gray-500'}`}>{t('profile.count')}</th>
                  <th className={`text-right px-4 py-2.5 font-medium ${isDark ? 'text-neutral-400' : 'text-gray-500'}`}>{t('profile.cost')}</th>
                </tr>
              </thead>
              <tbody>
                {stats.byModel.map((row, i) => (
                  <tr key={i} className={`border-t ${isDark ? 'border-neutral-800' : 'border-gray-100'}`}>
                    <td className={`px-4 py-2.5 text-xs ${isDark ? 'text-white' : 'text-gray-900'}`}>{pricing.find(p => p.modelId === row.model)?.modelName || row.model}</td>
                    <td className="px-4 py-2.5"><TypeBadge type={row.type} isDark={isDark} t={t} /></td>
                    <td className={`px-4 py-2.5 text-right ${isDark ? 'text-neutral-300' : 'text-gray-700'}`}>{row.count}</td>
                    <td className={`px-4 py-2.5 text-right font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>¥{row.totalCost.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};


// ============================================================================
// Tab: Usage Records
// ============================================================================

const RecordsTab: React.FC<{
  logs: UsageLog[];
  logsTotal: number;
  logsPage: number;
  logsTotalPages: number;
  logsFilter: 'all' | 'image' | 'video' | 'text';
  logsLoading: boolean;
  onFilterChange: (f: 'all' | 'image' | 'video' | 'text') => void;
  onLoadMore: () => void;
  pricing: ModelPricing[];
  isDark: boolean;
  t: (key: string) => string;
  formatDateTime: (d: string) => string;
}> = ({ logs, logsTotal, logsPage, logsTotalPages, logsFilter, logsLoading, onFilterChange, onLoadMore, pricing, isDark, t, formatDateTime }) => {
  const modelNameMap = React.useMemo(() => {
    const map: Record<string, string> = {};
    pricing.forEach(p => { map[p.modelId] = p.modelName; });
    return map;
  }, [pricing]);
  const resolveModelName = (id: string) => modelNameMap[id] || id;

  return (
  <div className="space-y-4">
    {/* Filter */}
    <div className="flex items-center justify-between">
      <div className="flex gap-1">
        {(['all', 'image', 'video', 'text'] as const).map(f => (
          <button
            key={f}
            onClick={() => onFilterChange(f)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${logsFilter === f
              ? (isDark ? 'bg-white/10 text-white' : 'bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 text-white')
              : (isDark ? 'text-neutral-500 hover:text-neutral-300' : 'text-gray-400 hover:text-gray-600')
            }`}
          >
            {t(`profile.${f}`)}
          </button>
        ))}
      </div>
      <span className={`text-xs ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>
        {logsTotal} {t('profile.generations')}
      </span>
    </div>

    {/* Log List */}
    {logs.length === 0 && !logsLoading ? (
      <div className={`text-center py-12 ${isDark ? 'text-neutral-600' : 'text-gray-400'}`}>
        <ScrollText size={32} className="mx-auto mb-3 opacity-50" />
        <p className="text-sm">{t('profile.noRecords')}</p>
      </div>
    ) : (
      <div className="space-y-2">
        {logs.map(log => (
          <div key={log.id} className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${isDark ? 'bg-neutral-900/50 border-neutral-800 hover:bg-neutral-900' : 'bg-gray-50 border-gray-200 hover:bg-gray-100'}`}>
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${log.type === 'image' ? (isDark ? 'bg-blue-500/10' : 'bg-blue-50') : log.type === 'video' ? (isDark ? 'bg-purple-500/10' : 'bg-purple-50') : (isDark ? 'bg-green-500/10' : 'bg-green-50')}`}>
              {log.type === 'image' ? <ImageIcon size={14} className={isDark ? 'text-blue-400' : 'text-blue-600'} /> : log.type === 'video' ? <Film size={14} className={isDark ? 'text-purple-400' : 'text-purple-600'} /> : <MessageSquare size={14} className={isDark ? 'text-green-400' : 'text-green-600'} />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={`text-xs ${isDark ? 'text-neutral-300' : 'text-gray-700'}`}>{resolveModelName(log.model)}</span>
                {log.status === 'success'
                  ? <CheckCircle2 size={12} className="text-green-500 shrink-0" />
                  : <XCircle size={12} className="text-red-500 shrink-0" />
                }
              </div>
              {log.prompt && (
                <p className={`text-xs truncate mt-0.5 ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{log.prompt}</p>
              )}
            </div>
            <div className="text-right shrink-0">
              {log.status === 'failed' ? (
                <p className={`text-xs font-medium ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>¥0.00</p>
              ) : (
                <p className={`text-xs font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>-¥{log.cost.toFixed(2)}</p>
              )}
              <div className={`flex items-center gap-1.5 justify-end text-[10px] ${isDark ? 'text-neutral-600' : 'text-gray-400'}`}>
                {log.status === 'failed' && <span className="text-red-400/70">{t('profile.failed')}</span>}
                {log.status === 'failed' && log.tokens > 0 && <span>·</span>}
                {log.status !== 'failed' && log.tokens > 0 && <span className={isDark ? 'text-amber-500/70' : 'text-amber-600/70'}>{log.tokens.toLocaleString()}t</span>}
                {log.status !== 'failed' && log.tokens > 0 && <span>·</span>}
                <span>{formatDateTime(log.createdAt)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    )}

    {/* Load More */}
    {logsPage < logsTotalPages && (
      <button
        onClick={onLoadMore}
        disabled={logsLoading}
        className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-colors ${isDark ? 'bg-neutral-900 text-neutral-400 hover:text-white border border-neutral-800' : 'bg-gray-50 text-gray-500 hover:text-gray-700 border border-gray-200'}`}
      >
        {logsLoading ? <Loader2 size={14} className="animate-spin" /> : <ChevronDown size={14} />}
        {t('profile.loadMore')}
      </button>
    )}

    {logsLoading && logs.length === 0 && (
      <div className="flex items-center justify-center py-8">
        <Loader2 size={20} className="animate-spin text-neutral-500" />
      </div>
    )}
  </div>
  );
};
