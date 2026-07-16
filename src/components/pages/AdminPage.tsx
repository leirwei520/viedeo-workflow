import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, Users, CreditCard, Search, Plus, Pencil, Trash2, Save, X,
  Wallet, Image as ImageIcon, Film, MessageSquare, Loader2, Check, ChevronLeft, ChevronRight, ChevronDown, ArrowUpDown, ArrowUp, ArrowDown,
  Ban, UserCheck, KeyRound, ShieldAlert, MinusCircle,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../hooks/useTheme';
import { authFetch, apiEndpoint } from '../../config/api';
import { sanitizeError } from '../../utils/errorSanitizer';

type TabId = 'users' | 'pricing' | 'recharge-logs';

interface AdminUser {
  id: number;
  username: string;
  nickname: string | null;
  avatar_url: string | null;
  role: 'user' | 'admin';
  status: 'active' | 'disabled';
  token_balance: number;
  created_at: string;
}

interface PricingRow {
  id: number;
  model_id: string;
  model_name: string;
  type: 'image' | 'video' | 'text';
  provider: string;
  base_cost: number;
  cost_per_second: number;
  cost_per_1k_tokens: number;
  resolution_pricing: any;
  is_active: number;
  sort_order: number;
}

interface RechargeLog {
  id: number;
  user_id: number;
  username: string;
  nickname: string | null;
  admin_username: string;
  amount: number;
  balance_before: number;
  balance_after: number;
  remark: string | null;
  created_at: string;
}

// ══════════════════════════════════════════════════════════
//  Main Admin Page
// ══════════════════════════════════════════════════════════

export const AdminPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isDark } = useTheme();
  const [tab, setTab] = useState<TabId>('users');

  if (user?.role !== 'admin') {
    return (
      <div className={`h-screen flex items-center justify-center ${isDark ? 'bg-[#020a12] text-white' : 'bg-[#f0f4f8] text-gray-900'}`}>
        <div className="text-center">
          <p className="text-xl mb-4">{t('admin.noPermission')}</p>
          <button onClick={() => navigate('/')} className="text-blue-400 hover:underline">{t('admin.backToApp')}</button>
        </div>
      </div>
    );
  }

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'users', label: t('admin.users'), icon: <Users size={16} /> },
    { id: 'pricing', label: t('admin.pricing'), icon: <CreditCard size={16} /> },
    { id: 'recharge-logs', label: t('admin.rechargeLogs'), icon: <Wallet size={16} /> },
  ];

  return (
    <div className={`h-screen overflow-y-auto ${isDark ? 'bg-[#020a12] text-white' : 'bg-[#f0f4f8] text-gray-900'}`}>
      {/* Top Bar */}
      <div className={`sticky top-0 z-50 backdrop-blur-xl border-b ${isDark ? 'bg-[#020a12]/80 border-white/5' : 'bg-white/80 border-gray-200'}`}>
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate('/')} className={`flex items-center gap-2 transition-colors ${isDark ? 'text-neutral-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'}`}>
              <ArrowLeft size={18} />
              <span className="text-sm">{t('admin.backToApp')}</span>
            </button>
            <div className={`w-px h-5 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
            <h1 className="text-sm font-medium tracking-wide sf-rainbow-text">{t('admin.title')}</h1>
          </div>
          <span className={`text-xs ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{user.username}</span>
        </div>
      </div>

      {/* Tab bar */}
      <div className="max-w-7xl mx-auto px-6 pt-4">
        <div className={`flex gap-1 border-b pb-px ${isDark ? 'border-white/5' : 'border-gray-200'}`}>
          {tabs.map(tb => (
            <button
              key={tb.id}
              onClick={() => setTab(tb.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm rounded-t-lg transition-colors ${
                tab === tb.id
                  ? (isDark ? 'bg-white/5 text-white border-b-2 border-blue-500' : 'bg-blue-50 text-blue-700 border-b-2 border-blue-500')
                  : (isDark ? 'text-neutral-500 hover:text-neutral-300' : 'text-gray-500 hover:text-gray-700')
              }`}
            >
              {tb.icon} {tb.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        {tab === 'users' && <UsersTab isDark={isDark} />}
        {tab === 'pricing' && <PricingTab isDark={isDark} />}
        {tab === 'recharge-logs' && <RechargeLogsTab isDark={isDark} />}
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════
//  Users Tab
// ══════════════════════════════════════════════════════════

const UsersTab: React.FC<{ isDark: boolean }> = ({ isDark }) => {
  const { t } = useTranslation();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [rechargeTarget, setRechargeTarget] = useState<AdminUser | null>(null);
  const [deductTarget, setDeductTarget] = useState<AdminUser | null>(null);
  const [editTarget, setEditTarget] = useState<AdminUser | null>(null);
  const [resetPwdTarget, setResetPwdTarget] = useState<AdminUser | null>(null);
  const [addUserOpen, setAddUserOpen] = useState(false);

  const fetchUsers = useCallback(async (p: number, q: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), limit: '15', search: q });
      const res = await authFetch(apiEndpoint(`/admin/users?${params}`));
      const data = await res.json();
      setUsers(data.users || []);
      setTotalPages(data.totalPages || 1);
      setPage(data.page || 1);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchUsers(1, search); }, [fetchUsers, search]);

  const refresh = () => fetchUsers(page, search);

  const toggleStatus = async (u: AdminUser) => {
    const newStatus = u.status === 'active' ? 'disabled' : 'active';
    const msg = newStatus === 'disabled' ? t('admin.confirmDisable') : t('admin.confirmEnable');
    if (!confirm(msg)) return;
    try {
      const res = await authFetch(apiEndpoint(`/admin/users/${u.id}/status`), {
        method: 'PUT', body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      refresh();
    } catch (err: any) { alert(sanitizeError(err)); }
  };

  const deleteUser = async (u: AdminUser) => {
    if (!confirm(`${t('admin.confirmDeleteUser')} "${u.nickname || u.username}"${t('admin.confirmDeleteUserSuffix')}`)) return;
    try {
      const res = await authFetch(apiEndpoint(`/admin/users/${u.id}`), { method: 'DELETE' });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      refresh();
    } catch (err: any) { alert(sanitizeError(err)); }
  };

  return (
    <div className="space-y-4">
      {/* Search + Add */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 ${isDark ? 'text-neutral-500' : 'text-gray-400'}`} />
          <input
            type="text"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder={t('admin.searchUsers')}
            className={`w-full pl-9 pr-4 py-2 rounded-lg text-sm focus:outline-none focus:border-blue-500/50 ${isDark ? 'bg-white/5 border border-white/10 text-white placeholder:text-neutral-600' : 'bg-gray-50 border border-gray-300 text-gray-900 placeholder:text-gray-500'}`}
          />
        </div>
        <div className="flex-1" />
        <button
          onClick={() => setAddUserOpen(true)}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg transition-colors ${isDark ? 'bg-blue-500/10 text-blue-400 hover:bg-blue-500/20' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'}`}
        >
          <Plus size={14} /> {t('admin.addUser')}
        </button>
      </div>

      {/* Table */}
      <div className={`rounded-xl border overflow-x-auto ${isDark ? 'border-white/5' : 'border-gray-100'}`}>
        <table className="w-full text-sm min-w-[900px]">
          <thead>
            <tr className={isDark ? 'bg-white/[0.02]' : 'bg-gray-50'}>
              <th className={`text-left px-4 py-3 font-medium ${isDark ? 'text-neutral-500' : 'text-gray-500'}`}>ID</th>
              <th className={`text-left px-4 py-3 font-medium ${isDark ? 'text-neutral-500' : 'text-gray-500'}`}>{t('admin.username')}</th>
              <th className={`text-left px-4 py-3 font-medium ${isDark ? 'text-neutral-500' : 'text-gray-500'}`}>{t('admin.nickname')}</th>
              <th className={`text-left px-4 py-3 font-medium ${isDark ? 'text-neutral-500' : 'text-gray-500'}`}>{t('admin.role')}</th>
              <th className={`text-center px-4 py-3 font-medium ${isDark ? 'text-neutral-500' : 'text-gray-500'}`}>{t('admin.status')}</th>
              <th className={`text-right px-4 py-3 font-medium ${isDark ? 'text-neutral-500' : 'text-gray-500'}`}>{t('admin.balance')}</th>
              <th className={`text-left px-4 py-3 font-medium ${isDark ? 'text-neutral-500' : 'text-gray-500'}`}>{t('admin.registered')}</th>
              <th className={`text-right px-4 py-3 font-medium ${isDark ? 'text-neutral-500' : 'text-gray-500'}`}>{t('admin.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className={`text-center py-10 ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}><Loader2 className="animate-spin inline mr-2" size={16} />{t('admin.loading')}</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={8} className={`text-center py-10 ${isDark ? 'text-neutral-600' : 'text-gray-600'}`}>{t('admin.noUsers')}</td></tr>
            ) : users.map(u => (
              <tr key={u.id} className={`border-t transition-colors ${isDark ? 'border-white/5 hover:bg-white/[0.02]' : 'border-gray-100 hover:bg-gray-50'} ${u.status === 'disabled' ? 'opacity-50' : ''}`}>
                <td className={`px-4 py-3 font-mono text-xs ${isDark ? 'text-neutral-400' : 'text-gray-500'}`}>{u.id}</td>
                <td className={`px-4 py-3 ${isDark ? 'text-white' : 'text-gray-900'}`}>{u.username}</td>
                <td className={`px-4 py-3 ${isDark ? 'text-neutral-300' : 'text-gray-600'}`}>{u.nickname || '-'}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${u.role === 'admin' ? (isDark ? 'bg-amber-500/10 text-amber-400' : 'bg-amber-500/20 text-amber-700') : (isDark ? 'bg-blue-500/10 text-blue-400' : 'bg-blue-500/20 text-blue-700')}`}>
                    {u.role === 'admin' ? 'Admin' : 'User'}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${u.status === 'active' ? (isDark ? 'bg-green-500/10 text-green-400' : 'bg-green-500/20 text-green-700') : (isDark ? 'bg-red-500/10 text-red-400' : 'bg-red-500/20 text-red-700')}`}>
                    {u.status === 'active' ? t('admin.userStatus_active') : t('admin.userStatus_disabled')}
                  </span>
                </td>
                <td className={`px-4 py-3 text-right font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>¥{Number(u.token_balance).toFixed(2)}</td>
                <td className={`px-4 py-3 text-xs ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{new Date(u.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => setRechargeTarget(u)} title={t('admin.recharge')}
                      className={`p-1.5 rounded transition-colors ${isDark ? 'bg-green-500/10 text-green-400 hover:bg-green-500/20' : 'bg-green-500/15 text-green-700 hover:bg-green-500/25'}`}>
                      <Wallet size={13} />
                    </button>
                    <button onClick={() => setDeductTarget(u)} title={t('admin.deduct')}
                      className={`p-1.5 rounded transition-colors ${isDark ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20' : 'bg-red-500/15 text-red-700 hover:bg-red-500/25'}`}>
                      <MinusCircle size={13} />
                    </button>
                    <button onClick={() => setEditTarget(u)} title={t('admin.editUser')}
                      className={`p-1.5 rounded transition-colors ${isDark ? 'bg-white/5 text-neutral-400 hover:text-white' : 'bg-gray-100 text-gray-500 hover:text-gray-900'}`}>
                      <Pencil size={13} />
                    </button>
                    <button onClick={() => setResetPwdTarget(u)} title={t('admin.resetPassword')}
                      className={`p-1.5 rounded transition-colors ${isDark ? 'bg-white/5 text-neutral-400 hover:text-white' : 'bg-gray-100 text-gray-500 hover:text-gray-900'}`}>
                      <KeyRound size={13} />
                    </button>
                    <button onClick={() => toggleStatus(u)}
                      title={u.status === 'active' ? t('admin.disableUser') : t('admin.enableUser')}
                      className={`p-1.5 rounded transition-colors ${u.status === 'active' ? (isDark ? 'bg-orange-500/10 text-orange-400 hover:bg-orange-500/20' : 'bg-orange-500/20 text-orange-700 hover:bg-orange-500/30') : (isDark ? 'bg-green-500/10 text-green-400 hover:bg-green-500/20' : 'bg-green-500/15 text-green-700 hover:bg-green-500/25')}`}>
                      {u.status === 'active' ? <Ban size={13} /> : <UserCheck size={13} />}
                    </button>
                    {u.role !== 'admin' && (
                      <button onClick={() => deleteUser(u)} title={t('admin.deleteUser')}
                        className={`p-1.5 rounded transition-colors ${isDark ? 'bg-white/5 text-neutral-400 hover:text-red-400' : 'bg-gray-100 text-gray-500 hover:text-red-600'}`}>
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button disabled={page <= 1} onClick={() => fetchUsers(page - 1, search)} className={`p-2 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed ${isDark ? 'bg-white/5 text-neutral-400 hover:text-white' : 'bg-gray-100 text-gray-500 hover:text-gray-900'}`}><ChevronLeft size={16} /></button>
          <span className={`text-xs ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{page} / {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => fetchUsers(page + 1, search)} className={`p-2 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed ${isDark ? 'bg-white/5 text-neutral-400 hover:text-white' : 'bg-gray-100 text-gray-500 hover:text-gray-900'}`}><ChevronRight size={16} /></button>
        </div>
      )}

      {/* Modals */}
      {addUserOpen && (
        <AddUserModal isDark={isDark} onClose={() => setAddUserOpen(false)} onSuccess={() => { setAddUserOpen(false); fetchUsers(1, search); }} />
      )}
      {rechargeTarget && (
        <RechargeModal isDark={isDark} user={rechargeTarget} onClose={() => setRechargeTarget(null)} onSuccess={() => { setRechargeTarget(null); refresh(); }} />
      )}
      {deductTarget && (
        <RechargeModal isDark={isDark} user={deductTarget} mode="deduct" onClose={() => setDeductTarget(null)} onSuccess={() => { setDeductTarget(null); refresh(); }} />
      )}
      {editTarget && (
        <EditUserModal isDark={isDark} user={editTarget} onClose={() => setEditTarget(null)} onSuccess={() => { setEditTarget(null); refresh(); }} />
      )}
      {resetPwdTarget && (
        <ResetPasswordModal isDark={isDark} user={resetPwdTarget} onClose={() => setResetPwdTarget(null)} onSuccess={() => { setResetPwdTarget(null); refresh(); }} />
      )}
    </div>
  );
};

// ══════════════════════════════════════════════════════════
//  Add User Modal
// ══════════════════════════════════════════════════════════

const AddUserModal: React.FC<{
  isDark: boolean;
  onClose: () => void;
  onSuccess: () => void;
}> = ({ isDark, onClose, onSuccess }) => {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async () => {
    if (!username.trim()) { setError(t('admin.usernameRequired')); return; }
    if (password.length < 6) { setError(t('admin.passwordRequired')); return; }
    setLoading(true);
    setError('');
    try {
      const res = await authFetch(apiEndpoint('/api/admin/users'), {
        method: 'POST',
        body: JSON.stringify({ username: username.trim(), password, nickname: nickname.trim() || undefined, role }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      setSuccess(true);
      setTimeout(onSuccess, 600);
    } catch (err: any) { setError(err.message || t('admin.operationFailed')); }
    finally { setLoading(false); }
  };

  return (
    <div className={`fixed inset-0 z-[200] flex items-center justify-center backdrop-blur-sm ${isDark ? 'bg-black/60' : 'bg-black/30'}`} onClick={onClose}>
      <div className={`rounded-2xl w-full max-w-md p-6 space-y-5 ${isDark ? 'bg-[#0a1628] border border-white/10' : 'bg-white border border-gray-200 shadow-lg'}`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className={`text-base font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>{t('admin.addUserTitle')}</h3>
          <button onClick={onClose} className={isDark ? 'text-neutral-500 hover:text-white' : 'text-gray-400 hover:text-gray-900'}><X size={18} /></button>
        </div>

        <div>
          <label className={`text-xs mb-1 block ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{t('admin.username')} *</label>
          <input type="text" value={username} onChange={e => setUsername(e.target.value)}
            placeholder={t('admin.usernamePlaceholder')}
            className={`w-full px-4 py-2.5 rounded-lg text-sm focus:outline-none focus:border-blue-500/50 ${isDark ? 'bg-white/5 border border-white/10 text-white' : 'bg-gray-50 border border-gray-300 text-gray-900'}`} />
        </div>

        <div>
          <label className={`text-xs mb-1 block ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{t('admin.newPassword')} *</label>
          <input type="text" value={password} onChange={e => setPassword(e.target.value)}
            placeholder={t('admin.passwordPlaceholder')}
            className={`w-full px-4 py-2.5 rounded-lg text-sm font-mono focus:outline-none focus:border-blue-500/50 ${isDark ? 'bg-white/5 border border-white/10 text-white' : 'bg-gray-50 border border-gray-300 text-gray-900'}`} />
        </div>

        <div>
          <label className={`text-xs mb-1 block ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{t('admin.nickname')}</label>
          <input type="text" value={nickname} onChange={e => setNickname(e.target.value)}
            placeholder={t('admin.nicknamePlaceholder')}
            className={`w-full px-4 py-2.5 rounded-lg text-sm focus:outline-none focus:border-blue-500/50 ${isDark ? 'bg-white/5 border border-white/10 text-white' : 'bg-gray-50 border border-gray-300 text-gray-900'}`} />
        </div>

        <div>
          <label className={`text-xs mb-1 block ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{t('admin.role')}</label>
          <div className="flex gap-2">
            {(['user', 'admin'] as const).map(r => (
              <button key={r} onClick={() => setRole(r)}
                className={`flex-1 py-2 text-sm rounded-lg border transition-colors ${
                  role === r
                    ? (isDark ? 'bg-blue-500/20 border-blue-500/50 text-blue-400' : 'bg-blue-50 border-blue-500/50 text-blue-700')
                    : (isDark ? 'bg-white/5 border-white/10 text-neutral-400 hover:text-white' : 'bg-gray-100 border-gray-200 text-gray-500 hover:text-gray-900')
                }`}>
                {r === 'admin' ? <><ShieldAlert size={14} className="inline mr-1.5" />Admin</> : <>User</>}
              </button>
            ))}
          </div>
        </div>

        {error && <p className={`text-xs ${isDark ? 'text-red-400' : 'text-red-600'}`}>{sanitizeError(error)}</p>}

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className={`px-4 py-2 text-xs transition-colors ${isDark ? 'text-neutral-500 hover:text-white' : 'text-gray-500 hover:text-gray-900'}`}>{t('admin.cancel')}</button>
          <button onClick={handleSubmit} disabled={loading || success}
            className={`px-4 py-2 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed ${
              success
                ? (isDark ? 'bg-green-500/20 text-green-400' : 'bg-green-500/20 text-green-700')
                : (isDark ? 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30' : 'bg-blue-50 text-blue-700 hover:bg-blue-100')
            }`}>
            {loading ? <Loader2 size={12} className="animate-spin" /> : success ? <Check size={12} /> : <Plus size={12} />}
            {success ? t('admin.createSuccess') : t('admin.addUser')}
          </button>
        </div>
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════
//  Recharge Modal
// ══════════════════════════════════════════════════════════

const RechargeModal: React.FC<{
  isDark: boolean;
  user: AdminUser;
  mode?: 'recharge' | 'deduct';
  onClose: () => void;
  onSuccess: () => void;
}> = ({ isDark, user, mode = 'recharge', onClose, onSuccess }) => {
  const { t } = useTranslation();
  const isDeduct = mode === 'deduct';
  const [amount, setAmount] = useState('');
  const [remark, setRemark] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const presets = isDeduct ? [10, 50, 100, 500, 1000, 5000] : [10, 50, 100, 500, 1000, 5000];
  const maxBalance = Number(user.token_balance);

  const handleSubmit = async () => {
    const num = parseFloat(amount);
    if (!num || num <= 0) { setError(t('admin.invalidAmount')); return; }
    if (isDeduct && num > maxBalance) {
      setError(t('admin.insufficientBalance', { balance: `¥${maxBalance.toFixed(2)}` }));
      return;
    }
    setLoading(true);
    setError('');
    try {
      const apiAmount = isDeduct ? -num : num;
      const res = await authFetch(apiEndpoint(`/admin/users/${user.id}/recharge`), {
        method: 'POST',
        body: JSON.stringify({ amount: apiAmount, remark }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSuccess(true);
      setTimeout(onSuccess, 800);
    } catch (err: any) {
      setError(err.message || (isDeduct ? t('admin.deductFailed') : t('admin.rechargeFailed')));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`fixed inset-0 z-[200] flex items-center justify-center backdrop-blur-sm ${isDark ? 'bg-black/60' : 'bg-black/30'}`} onClick={onClose}>
      <div className={`rounded-2xl w-full max-w-md p-6 space-y-5 ${isDark ? 'bg-[#0a1628] border border-white/10' : 'bg-white border border-gray-200 shadow-lg'}`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className={`text-base font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
            {isDeduct ? t('admin.deductTitle') : t('admin.rechargeTitle')}
          </h3>
          <button onClick={onClose} className={isDark ? 'text-neutral-500 hover:text-white' : 'text-gray-400 hover:text-gray-900'}><X size={18} /></button>
        </div>

        <div className={`flex items-center gap-3 p-3 rounded-xl ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
          <div className={`w-10 h-10 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
            {(user.nickname || user.username).charAt(0).toUpperCase()}
          </div>
          <div className="flex-1">
            <p className={`text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>{user.nickname || user.username}</p>
            <p className={`text-xs ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>@{user.username}</p>
          </div>
          <div className="text-right">
            <p className={`text-xs ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{t('admin.currentBalance')}</p>
            <p className={`text-sm font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>¥{maxBalance.toFixed(2)}</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {presets.map(p => (
            <button
              key={p}
              onClick={() => setAmount(String(p))}
              className={`py-2 text-sm rounded-lg border transition-colors ${
                amount === String(p)
                  ? isDeduct
                    ? (isDark ? 'bg-red-500/20 border-red-500/50 text-red-400' : 'bg-red-500/15 border-red-500/40 text-red-700')
                    : (isDark ? 'bg-blue-500/20 border-blue-500/50 text-blue-400' : 'bg-blue-50 border-blue-500/40 text-blue-700')
                  : (isDark ? 'bg-white/5 border-white/10 text-neutral-400 hover:text-white' : 'bg-gray-100 border-gray-200 text-gray-500 hover:text-gray-900')
              }`}
            >
              {isDeduct ? '-' : '+'}¥{p}
            </button>
          ))}
        </div>

        <div>
          <label className={`text-xs mb-1 block ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{t('admin.customAmount')}</label>
          <input
            type="number"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="0.00"
            min="0"
            max={isDeduct ? maxBalance : undefined}
            step="0.01"
            className={`w-full px-4 py-2.5 rounded-lg text-sm focus:outline-none ${isDark ? 'bg-white/5 border border-white/10 text-white' : 'bg-gray-50 border border-gray-300 text-gray-900'} ${
              isDeduct ? 'focus:border-red-500/50' : 'focus:border-blue-500/50'
            }`}
          />
          {isDeduct && (
            <p className={`text-xs mt-1 ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>
              {t('admin.maxDeduct')}: ¥{maxBalance.toFixed(2)}
            </p>
          )}
        </div>

        <div>
          <label className={`text-xs mb-1 block ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{t('admin.remark')}</label>
          <input
            type="text"
            value={remark}
            onChange={e => setRemark(e.target.value)}
            placeholder={isDeduct ? t('admin.deductRemarkPlaceholder') : t('admin.remarkPlaceholder')}
            className={`w-full px-4 py-2.5 rounded-lg text-sm focus:outline-none focus:border-blue-500/50 ${isDark ? 'bg-white/5 border border-white/10 text-white' : 'bg-gray-50 border border-gray-300 text-gray-900'}`}
          />
        </div>

        {error && <p className={`text-xs ${isDark ? 'text-red-400' : 'text-red-600'}`}>{sanitizeError(error)}</p>}

        <button
          onClick={handleSubmit}
          disabled={loading || success || !amount}
          className={`w-full py-2.5 rounded-xl text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${
            success
              ? (isDark ? 'bg-green-500/20 text-green-400' : 'bg-green-500/20 text-green-700')
              : isDeduct
                ? (isDark ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30' : 'bg-red-50 text-red-700 hover:bg-red-100')
                : (isDark ? 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30' : 'bg-blue-50 text-blue-700 hover:bg-blue-100')
          }`}
        >
          {loading ? <Loader2 size={14} className="animate-spin" />
            : success ? <Check size={14} />
            : isDeduct ? <MinusCircle size={14} />
            : <Wallet size={14} />}
          {success
            ? (isDeduct ? t('admin.deductSuccess') : t('admin.rechargeSuccess'))
            : loading
              ? t('admin.processing')
              : (isDeduct ? t('admin.confirmDeduct') : t('admin.confirmRecharge'))}
        </button>
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════
//  Edit User Modal
// ══════════════════════════════════════════════════════════

const EditUserModal: React.FC<{
  isDark: boolean;
  user: AdminUser;
  onClose: () => void;
  onSuccess: () => void;
}> = ({ isDark, user, onClose, onSuccess }) => {
  const { t } = useTranslation();
  const [nickname, setNickname] = useState(user.nickname || '');
  const [role, setRole] = useState(user.role);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await authFetch(apiEndpoint(`/admin/users/${user.id}`), {
        method: 'PUT', body: JSON.stringify({ nickname, role }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      setSuccess(true);
      setTimeout(onSuccess, 600);
    } catch (err: any) { setError(err.message || t('admin.operationFailed')); }
    finally { setLoading(false); }
  };

  return (
    <div className={`fixed inset-0 z-[200] flex items-center justify-center backdrop-blur-sm ${isDark ? 'bg-black/60' : 'bg-black/30'}`} onClick={onClose}>
      <div className={`rounded-2xl w-full max-w-md p-6 space-y-5 ${isDark ? 'bg-[#0a1628] border border-white/10' : 'bg-white border border-gray-200 shadow-lg'}`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className={`text-base font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>{t('admin.editUser')}</h3>
          <button onClick={onClose} className={isDark ? 'text-neutral-500 hover:text-white' : 'text-gray-400 hover:text-gray-900'}><X size={18} /></button>
        </div>

        <div className={`flex items-center gap-3 p-3 rounded-xl ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
          <div className={`w-10 h-10 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
            {(user.nickname || user.username).charAt(0).toUpperCase()}
          </div>
          <div>
            <p className={`text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>{user.username}</p>
            <p className={`text-xs ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>ID: {user.id}</p>
          </div>
        </div>

        <div>
          <label className={`text-xs mb-1 block ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{t('admin.nickname')}</label>
          <input type="text" value={nickname} onChange={e => setNickname(e.target.value)}
            className={`w-full px-4 py-2.5 rounded-lg text-sm focus:outline-none focus:border-blue-500/50 ${isDark ? 'bg-white/5 border border-white/10 text-white' : 'bg-gray-50 border border-gray-300 text-gray-900'}`} />
        </div>

        <div>
          <label className={`text-xs mb-1 block ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{t('admin.role')}</label>
          <div className="flex gap-2">
            {(['user', 'admin'] as const).map(r => (
              <button key={r} onClick={() => setRole(r)}
                className={`flex-1 py-2 text-sm rounded-lg border transition-colors ${
                  role === r
                    ? (isDark ? 'bg-blue-500/20 border-blue-500/50 text-blue-400' : 'bg-blue-50 border-blue-500/50 text-blue-700')
                    : (isDark ? 'bg-white/5 border-white/10 text-neutral-400 hover:text-white' : 'bg-gray-100 border-gray-200 text-gray-500 hover:text-gray-900')
                }`}>
                {r === 'admin' ? <><ShieldAlert size={14} className="inline mr-1.5" />Admin</> : <>User</>}
              </button>
            ))}
          </div>
        </div>

        {error && <p className={`text-xs ${isDark ? 'text-red-400' : 'text-red-600'}`}>{sanitizeError(error)}</p>}

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className={`px-4 py-2 text-xs transition-colors ${isDark ? 'text-neutral-500 hover:text-white' : 'text-gray-500 hover:text-gray-900'}`}>{t('admin.cancel')}</button>
          <button onClick={handleSubmit} disabled={loading || success}
            className={`px-4 py-2 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed ${
              success
                ? (isDark ? 'bg-green-500/20 text-green-400' : 'bg-green-500/20 text-green-700')
                : (isDark ? 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30' : 'bg-blue-50 text-blue-700 hover:bg-blue-100')
            }`}>
            {loading ? <Loader2 size={12} className="animate-spin" /> : success ? <Check size={12} /> : <Save size={12} />}
            {success ? t('admin.operationSuccess') : t('admin.save')}
          </button>
        </div>
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════
//  Reset Password Modal
// ══════════════════════════════════════════════════════════

const ResetPasswordModal: React.FC<{
  isDark: boolean;
  user: AdminUser;
  onClose: () => void;
  onSuccess: () => void;
}> = ({ isDark, user, onClose, onSuccess }) => {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async () => {
    if (password.length < 6) { setError(t('admin.newPasswordPlaceholder')); return; }
    setLoading(true);
    setError('');
    try {
      const res = await authFetch(apiEndpoint(`/admin/users/${user.id}/reset-password`), {
        method: 'PUT', body: JSON.stringify({ newPassword: password }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      setSuccess(true);
      setTimeout(onSuccess, 600);
    } catch (err: any) { setError(err.message || t('admin.operationFailed')); }
    finally { setLoading(false); }
  };

  return (
    <div className={`fixed inset-0 z-[200] flex items-center justify-center backdrop-blur-sm ${isDark ? 'bg-black/60' : 'bg-black/30'}`} onClick={onClose}>
      <div className={`rounded-2xl w-full max-w-md p-6 space-y-5 ${isDark ? 'bg-[#0a1628] border border-white/10' : 'bg-white border border-gray-200 shadow-lg'}`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className={`text-base font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>{t('admin.resetPasswordTitle')}</h3>
          <button onClick={onClose} className={isDark ? 'text-neutral-500 hover:text-white' : 'text-gray-400 hover:text-gray-900'}><X size={18} /></button>
        </div>

        <div className={`flex items-center gap-3 p-3 rounded-xl ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
          <div className={`w-10 h-10 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
            {(user.nickname || user.username).charAt(0).toUpperCase()}
          </div>
          <div>
            <p className={`text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>{user.nickname || user.username}</p>
            <p className={`text-xs ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>@{user.username}</p>
          </div>
        </div>

        <p className={`text-xs px-3 py-2 rounded-lg ${isDark ? 'text-amber-400/80 bg-amber-500/10' : 'text-amber-800 bg-amber-500/20'}`}>{t('admin.resetPasswordHint')}</p>

        <div>
          <label className={`text-xs mb-1 block ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{t('admin.newPassword')}</label>
          <input type="text" value={password} onChange={e => setPassword(e.target.value)}
            placeholder={t('admin.newPasswordPlaceholder')}
            className={`w-full px-4 py-2.5 rounded-lg text-sm font-mono focus:outline-none focus:border-blue-500/50 ${isDark ? 'bg-white/5 border border-white/10 text-white' : 'bg-gray-50 border border-gray-300 text-gray-900'}`} />
        </div>

        {error && <p className={`text-xs ${isDark ? 'text-red-400' : 'text-red-600'}`}>{sanitizeError(error)}</p>}

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className={`px-4 py-2 text-xs transition-colors ${isDark ? 'text-neutral-500 hover:text-white' : 'text-gray-500 hover:text-gray-900'}`}>{t('admin.cancel')}</button>
          <button onClick={handleSubmit} disabled={loading || success || password.length < 6}
            className={`px-4 py-2 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed ${
              success
                ? (isDark ? 'bg-green-500/20 text-green-400' : 'bg-green-500/20 text-green-700')
                : (isDark ? 'bg-orange-500/20 text-orange-400 hover:bg-orange-500/30' : 'bg-orange-50 text-orange-700 hover:bg-orange-100')
            }`}>
            {loading ? <Loader2 size={12} className="animate-spin" /> : success ? <Check size={12} /> : <KeyRound size={12} />}
            {success ? t('admin.operationSuccess') : t('admin.resetPasswordConfirm')}
          </button>
        </div>
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════
//  Pricing Tab
// ══════════════════════════════════════════════════════════

const EMPTY_ROW: Omit<PricingRow, 'id'> = {
  model_id: '', model_name: '', type: 'image', provider: 'tencent-vod',
  base_cost: 1, cost_per_second: 0, cost_per_1k_tokens: 0, resolution_pricing: null, is_active: 1, sort_order: 0,
};

const MODE_LABELS: Record<string, string> = {
  text: '文生', img: '图生', ref: '参考生',
  text_audio: '文生+音频', img_audio: '图生+音频', ref_audio: '参考生+音频',
  default: '默认',
};
const VIDEO_RESOLUTIONS = ['480p', '720p', '1080p', '2k', '4k'];
const IMAGE_RESOLUTIONS = ['1k', '2k', '4k'];
const VIDEO_MODES = ['text', 'img', 'ref', 'text_audio', 'img_audio', 'ref_audio'];
const IMAGE_MODES = ['default', 'ref'];

type RpData = Record<string, Record<string, number>>;

function parseRp(rp: any): RpData {
  if (!rp || typeof rp !== 'object') return {};
  if (typeof rp === 'string') { try { return JSON.parse(rp); } catch { return {}; } }
  return rp;
}

function cleanRpData(data: RpData): any | null {
  const cleaned: RpData = {};
  for (const [mode, resolutions] of Object.entries(data)) {
    const md: Record<string, number> = {};
    for (const [res, price] of Object.entries(resolutions)) {
      if (typeof price === 'number' && price > 0) md[res] = price;
    }
    if (Object.keys(md).length > 0) cleaned[mode] = md;
  }
  return Object.keys(cleaned).length > 0 ? cleaned : null;
}

const PricingTab: React.FC<{ isDark: boolean }> = ({ isDark }) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<PricingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editData, setEditData] = useState<Partial<PricingRow>>({});
  const [addMode, setAddMode] = useState(false);
  const [newRow, setNewRow] = useState(EMPTY_ROW);
  const [saving, setSaving] = useState(false);

  // Filters & pagination
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<string>('');
  const [filterProvider, setFilterProvider] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [providers, setProviders] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<string>('sort_order');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const toggleSort = (col: string) => {
    if (sortBy === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(col);
      setSortDir('asc');
    }
  };

  const fetchPricing = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), limit: '15', sort_by: sortBy, sort_dir: sortDir });
      if (search) params.set('search', search);
      if (filterType) params.set('type', filterType);
      if (filterProvider) params.set('provider', filterProvider);
      if (filterStatus) params.set('status', filterStatus);

      const res = await authFetch(apiEndpoint(`/admin/pricing?${params}`));
      const data = await res.json();
      setRows(data.pricing || []);
      setTotalPages(data.totalPages || 1);
      setPage(data.page || 1);
      setTotal(data.total || 0);
      if (data.providers) setProviders(data.providers);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [search, filterType, filterProvider, filterStatus, sortBy, sortDir]);

  useEffect(() => { fetchPricing(1); }, [fetchPricing]);

  const [rpData, setRpData] = useState<RpData>({});
  const [newRpData, setNewRpData] = useState<RpData>({});

  const updateRpPrice = (setter: React.Dispatch<React.SetStateAction<RpData>>, mode: string, resolution: string, value: string) => {
    setter(prev => {
      const next = { ...prev, [mode]: { ...prev[mode] } };
      if (value === '' || isNaN(parseFloat(value))) {
        delete next[mode][resolution];
      } else {
        next[mode][resolution] = parseFloat(value);
      }
      return next;
    });
  };

  const startEdit = (row: PricingRow) => {
    setEditId(row.id);
    setEditData({ ...row });
    setRpData(parseRp(row.resolution_pricing));
    setAddMode(false);
  };
  const cancelEdit = () => { setEditId(null); setEditData({}); setRpData({}); };

  const saveEdit = async () => {
    if (!editId) return;
    setSaving(true);
    try {
      const res = await authFetch(apiEndpoint(`/admin/pricing/${editId}`), {
        method: 'PUT', body: JSON.stringify({ ...editData, resolution_pricing: cleanRpData(rpData) }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      cancelEdit();
      fetchPricing(page);
    } catch (err: any) { alert(sanitizeError(err)); }
    finally { setSaving(false); }
  };

  const addRow = async () => {
    if (!newRow.model_id || !newRow.model_name) return;
    setSaving(true);
    try {
      const body = { ...newRow, resolution_pricing: cleanRpData(newRpData) };
      const res = await authFetch(apiEndpoint('/api/admin/pricing'), {
        method: 'POST', body: JSON.stringify(body),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      setAddMode(false);
      setNewRow({ ...EMPTY_ROW });
      setNewRpData({});
      fetchPricing(1);
    } catch (err: any) { alert(sanitizeError(err)); }
    finally { setSaving(false); }
  };

  const deleteRow = async (id: number, name: string) => {
    if (!confirm(`${t('admin.confirmDelete')} "${name}"?`)) return;
    try {
      await authFetch(apiEndpoint(`/admin/pricing/${id}`), { method: 'DELETE' });
      fetchPricing(page);
    } catch (err) { console.error(err); }
  };

  const typeIcon = (tp: string) => tp === 'image' ? <ImageIcon size={12} /> : tp === 'video' ? <Film size={12} /> : <MessageSquare size={12} />;
  const typeCls = (tp: string) => {
    if (tp === 'image') return isDark ? 'bg-blue-500/10 text-blue-400' : 'bg-blue-500/20 text-blue-700';
    if (tp === 'video') return isDark ? 'bg-purple-500/10 text-purple-400' : 'bg-purple-500/20 text-purple-700';
    return isDark ? 'bg-green-500/10 text-green-400' : 'bg-green-500/20 text-green-700';
  };

  return (
    <div className="space-y-4">
      {/* Search + Filters + Add */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 ${isDark ? 'text-neutral-500' : 'text-gray-400'}`} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('admin.searchModel')}
            className={`w-full pl-9 pr-4 py-2 rounded-lg text-sm focus:outline-none focus:border-blue-500/50 ${isDark ? 'bg-white/5 border border-white/10 text-white placeholder:text-neutral-600' : 'bg-gray-50 border border-gray-300 text-gray-900 placeholder:text-gray-500'}`}
          />
        </div>

        <FilterDropdown
          isDark={isDark}
          label={t('admin.typeLabel')}
          value={filterType}
          onChange={setFilterType}
          options={[
            { value: '', label: t('admin.allTypes') },
            { value: 'image', label: t('admin.type_image') },
            { value: 'video', label: t('admin.type_video') },
            { value: 'text', label: t('admin.type_text') },
          ]}
        />

        <FilterDropdown
          isDark={isDark}
          label={t('admin.provider')}
          value={filterProvider}
          onChange={setFilterProvider}
          options={[
            { value: '', label: t('admin.allProviders') },
            ...providers.map(p => ({ value: p, label: p })),
          ]}
        />

        <FilterDropdown
          isDark={isDark}
          label={t('admin.status')}
          value={filterStatus}
          onChange={setFilterStatus}
          options={[
            { value: '', label: t('admin.allStatus') },
            { value: 'active', label: t('admin.active') },
            { value: 'inactive', label: t('admin.inactive') },
          ]}
        />

        <div className="flex-1" />
        <button
          onClick={() => { setAddMode(true); setEditId(null); }}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg transition-colors ${isDark ? 'bg-blue-500/10 text-blue-400 hover:bg-blue-500/20' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'}`}
        >
          <Plus size={14} /> {t('admin.addModel')}
        </button>
      </div>

      {/* Add Row */}
      {addMode && (
        <div className={`p-4 rounded-xl border space-y-3 ${isDark ? 'border-blue-500/20 bg-blue-500/5' : 'border-blue-200 bg-blue-50/50'}`}>
          <p className={`text-sm font-medium ${isDark ? 'text-blue-400' : 'text-blue-700'}`}>{t('admin.addModel')}</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <InputField isDark={isDark} label="Model ID" value={newRow.model_id} onChange={v => setNewRow(p => ({ ...p, model_id: v }))} />
            <InputField isDark={isDark} label={t('admin.modelName')} value={newRow.model_name} onChange={v => setNewRow(p => ({ ...p, model_name: v }))} />
            <SelectField isDark={isDark} label={t('admin.typeLabel')} value={newRow.type} options={['image', 'video', 'text']} onChange={v => setNewRow(p => ({ ...p, type: v as any }))} />
            <InputField isDark={isDark} label={t('admin.provider')} value={newRow.provider} onChange={v => setNewRow(p => ({ ...p, provider: v }))} />
            <NumberField isDark={isDark} label={t('admin.baseCost')} value={newRow.base_cost} onChange={v => setNewRow(p => ({ ...p, base_cost: v }))} />
            <NumberField isDark={isDark} label={t('admin.costPerSec')} value={newRow.cost_per_second} onChange={v => setNewRow(p => ({ ...p, cost_per_second: v }))} />
            <NumberField isDark={isDark} label={t('admin.costPer1kTokens')} value={newRow.cost_per_1k_tokens} onChange={v => setNewRow(p => ({ ...p, cost_per_1k_tokens: v }))} />
            <NumberField isDark={isDark} label={t('admin.sortOrder')} value={newRow.sort_order} onChange={v => setNewRow(p => ({ ...p, sort_order: v }))} step={1} />
          </div>
          <RpEditor isDark={isDark} type={newRow.type} data={newRpData} onChange={setNewRpData} onUpdatePrice={(m, r, v) => updateRpPrice(setNewRpData, m, r, v)} />
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setAddMode(false); setNewRpData({}); }} className={`px-3 py-1.5 text-xs ${isDark ? 'text-neutral-500 hover:text-white' : 'text-gray-500 hover:text-gray-900'}`}><X size={14} /></button>
            <button onClick={addRow} disabled={saving} className={`flex items-center gap-1.5 px-4 py-1.5 text-xs rounded-lg disabled:opacity-50 ${isDark ? 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'}`}>
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} {t('admin.save')}
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className={`rounded-xl border overflow-x-auto ${isDark ? 'border-white/5' : 'border-gray-100'}`}>
        <table className="w-full text-sm min-w-[800px]">
          <thead>
            <tr className={isDark ? 'bg-white/[0.02]' : 'bg-gray-50'}>
              <SortTh isDark={isDark} col="id" label="#" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} className="w-8" />
              <SortTh isDark={isDark} col="model_id" label="Model ID" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
              <SortTh isDark={isDark} col="model_name" label={t('admin.modelName')} sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
              <SortTh isDark={isDark} col="type" label={t('admin.typeLabel')} sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
              <SortTh isDark={isDark} col="provider" label={t('admin.provider')} sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
              <SortTh isDark={isDark} col="base_cost" label={t('admin.baseCost')} sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} align="right" />
              <SortTh isDark={isDark} col="cost_per_second" label={t('admin.costPerSec')} sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} align="right" />
              <SortTh isDark={isDark} col="cost_per_1k_tokens" label={t('admin.costPer1kTokens')} sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} align="right" />
              <th className={`text-center px-3 py-2.5 font-medium ${isDark ? 'text-neutral-500' : 'text-gray-500'}`}>分辨率定价</th>
              <SortTh isDark={isDark} col="sort_order" label={t('admin.sortOrder')} sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} align="right" />
              <SortTh isDark={isDark} col="is_active" label={t('admin.status')} sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} align="center" />
              <th className={`text-right px-3 py-2.5 font-medium ${isDark ? 'text-neutral-500' : 'text-gray-500'}`}>{t('admin.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={12} className={`text-center py-10 ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}><Loader2 className="animate-spin inline mr-2" size={16} />{t('admin.loading')}</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={12} className={`text-center py-10 ${isDark ? 'text-neutral-600' : 'text-gray-600'}`}>{t('admin.noModels')}</td></tr>
            ) : rows.map(row => (
              editId === row.id ? (
                <React.Fragment key={row.id}>
                <tr className={`border-t ${isDark ? 'border-white/5 bg-blue-500/[0.03]' : 'border-gray-100 bg-blue-50/40'}`}>
                  <td className={`px-3 py-2 text-xs ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{row.id}</td>
                  <td className="px-3 py-2"><MiniInput isDark={isDark} value={editData.model_id || ''} onChange={v => setEditData(p => ({ ...p, model_id: v }))} /></td>
                  <td className="px-3 py-2"><MiniInput isDark={isDark} value={editData.model_name || ''} onChange={v => setEditData(p => ({ ...p, model_name: v }))} /></td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      {['image', 'video', 'text'].map(tp => (
                        <button key={tp} onClick={() => setEditData(p => ({ ...p, type: tp as any }))}
                          className={`px-2 py-0.5 text-xs rounded ${editData.type === tp ? (isDark ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-100 text-blue-700') : (isDark ? 'bg-white/5 text-neutral-500' : 'bg-gray-100 text-gray-500')}`}>
                          {tp}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2"><MiniInput isDark={isDark} value={editData.provider || ''} onChange={v => setEditData(p => ({ ...p, provider: v }))} /></td>
                  <td className="px-3 py-2"><MiniInput isDark={isDark} type="number" value={String(editData.base_cost ?? '')} onChange={v => setEditData(p => ({ ...p, base_cost: parseFloat(v) || 0 }))} /></td>
                  <td className="px-3 py-2"><MiniInput isDark={isDark} type="number" value={String(editData.cost_per_second ?? '')} onChange={v => setEditData(p => ({ ...p, cost_per_second: parseFloat(v) || 0 }))} /></td>
                  <td className="px-3 py-2"><MiniInput isDark={isDark} type="number" value={String(editData.cost_per_1k_tokens ?? '')} onChange={v => setEditData(p => ({ ...p, cost_per_1k_tokens: parseFloat(v) || 0 }))} /></td>
                  <td className={`px-3 py-2 text-center text-xs ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>↓ 下方编辑</td>
                  <td className="px-3 py-2"><MiniInput isDark={isDark} type="number" value={String(editData.sort_order ?? 0)} onChange={v => setEditData(p => ({ ...p, sort_order: parseInt(v) || 0 }))} /></td>
                  <td className="px-3 py-2 text-center">
                    <button onClick={() => setEditData(p => ({ ...p, is_active: p.is_active ? 0 : 1 }))} className={`text-xs px-2 py-0.5 rounded-full ${editData.is_active ? (isDark ? 'bg-green-500/10 text-green-400' : 'bg-green-500/20 text-green-700') : (isDark ? 'bg-red-500/10 text-red-400' : 'bg-red-500/20 text-red-700')}`}>
                      {editData.is_active ? t('admin.active') : t('admin.inactive')}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={saveEdit} disabled={saving} className={`p-1.5 rounded ${isDark ? 'bg-green-500/10 text-green-400 hover:bg-green-500/20' : 'bg-green-500/15 text-green-700 hover:bg-green-500/25'}`}><Save size={13} /></button>
                      <button onClick={cancelEdit} className={`p-1.5 rounded ${isDark ? 'bg-white/5 text-neutral-400 hover:text-white' : 'bg-gray-100 text-gray-500 hover:text-gray-900'}`}><X size={13} /></button>
                    </div>
                  </td>
                </tr>
                <tr className={isDark ? 'bg-blue-500/[0.03]' : 'bg-blue-50/40'}>
                  <td colSpan={12} className="px-3 py-3">
                    <RpEditor isDark={isDark} type={editData.type || 'video'} data={rpData} onChange={setRpData} onUpdatePrice={(m, r, v) => updateRpPrice(setRpData, m, r, v)} />
                  </td>
                </tr>
                </React.Fragment>
              ) : (
                <tr key={row.id} className={`border-t transition-colors ${isDark ? 'border-white/5 hover:bg-white/[0.02]' : 'border-gray-100 hover:bg-gray-50'}`}>
                  <td className={`px-3 py-2.5 text-xs ${isDark ? 'text-neutral-600' : 'text-gray-600'}`}>{row.id}</td>
                  <td className={`px-3 py-2.5 font-mono text-xs ${isDark ? 'text-white' : 'text-gray-900'}`}>{row.model_id}</td>
                  <td className={`px-3 py-2.5 ${isDark ? 'text-neutral-300' : 'text-gray-600'}`}>{row.model_name}</td>
                  <td className="px-3 py-2.5"><span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${typeCls(row.type)}`}>{typeIcon(row.type)} {row.type}</span></td>
                  <td className={`px-3 py-2.5 text-xs ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{row.provider}</td>
                  <td className={`px-3 py-2.5 text-right font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>¥{Number(row.base_cost).toFixed(2)}</td>
                  <td className={`px-3 py-2.5 text-right font-mono ${isDark ? 'text-neutral-400' : 'text-gray-500'}`}>¥{Number(row.cost_per_second).toFixed(2)}</td>
                  <td className={`px-3 py-2.5 text-right font-mono ${isDark ? 'text-neutral-400' : 'text-gray-500'}`}>¥{Number(row.cost_per_1k_tokens).toFixed(2)}</td>
                  <td className="px-3 py-2.5">
                    {(() => {
                      const rp = parseRp(row.resolution_pricing);
                      const modes = Object.keys(rp);
                      if (!modes.length) return <span className={`text-xs ${isDark ? 'text-neutral-700' : 'text-gray-300'}`}>—</span>;
                      return (
                        <div className="flex flex-wrap gap-1">
                          {modes.map(m => (
                            <span key={m} className={`text-[10px] px-1.5 py-0.5 rounded ${isDark ? 'bg-cyan-500/10 text-cyan-400' : 'bg-cyan-500/15 text-cyan-700'}`}>
                              {MODE_LABELS[m] || m}
                            </span>
                          ))}
                        </div>
                      );
                    })()}
                  </td>
                  <td className={`px-3 py-2.5 text-right font-mono text-xs ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{row.sort_order}</td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${row.is_active ? (isDark ? 'bg-green-500/10 text-green-400' : 'bg-green-500/20 text-green-700') : (isDark ? 'bg-red-500/10 text-red-400' : 'bg-red-500/20 text-red-700')}`}>
                      {row.is_active ? t('admin.active') : t('admin.inactive')}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => startEdit(row)} className={`p-1.5 rounded ${isDark ? 'bg-white/5 text-neutral-400 hover:text-white' : 'bg-gray-100 text-gray-500 hover:text-gray-900'}`}><Pencil size={13} /></button>
                      <button onClick={() => deleteRow(row.id, row.model_name)} className={`p-1.5 rounded ${isDark ? 'bg-white/5 text-neutral-400 hover:text-red-400' : 'bg-gray-100 text-gray-500 hover:text-red-600'}`}><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              )
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer: total + pagination */}
      <div className="flex items-center justify-between">
        <p className={`text-xs ${isDark ? 'text-neutral-600' : 'text-gray-600'}`}>{t('admin.totalModels')}: {total}</p>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button disabled={page <= 1} onClick={() => fetchPricing(page - 1)} className={`p-2 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed ${isDark ? 'bg-white/5 text-neutral-400 hover:text-white' : 'bg-gray-100 text-gray-500 hover:text-gray-900'}`}><ChevronLeft size={16} /></button>
            <span className={`text-xs ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{page} / {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => fetchPricing(page + 1)} className={`p-2 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed ${isDark ? 'bg-white/5 text-neutral-400 hover:text-white' : 'bg-gray-100 text-gray-500 hover:text-gray-900'}`}><ChevronRight size={16} /></button>
          </div>
        )}
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════
//  Recharge Logs Tab
// ══════════════════════════════════════════════════════════

const RechargeLogsTab: React.FC<{ isDark: boolean }> = ({ isDark }) => {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<RechargeLog[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);

  const fetchLogs = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await authFetch(apiEndpoint(`/admin/recharge-logs?page=${p}&limit=20`));
      const data = await res.json();
      setLogs(data.logs || []);
      setTotalPages(data.totalPages || 1);
      setPage(data.page || 1);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchLogs(1); }, [fetchLogs]);

  return (
    <div className="space-y-4">
      <div className={`rounded-xl border overflow-hidden ${isDark ? 'border-white/5' : 'border-gray-100'}`}>
        <table className="w-full text-sm">
          <thead>
            <tr className={isDark ? 'bg-white/[0.02]' : 'bg-gray-50'}>
              <th className={`text-left px-4 py-3 font-medium ${isDark ? 'text-neutral-500' : 'text-gray-500'}`}>{t('admin.user')}</th>
              <th className={`text-right px-4 py-3 font-medium ${isDark ? 'text-neutral-500' : 'text-gray-500'}`}>{t('admin.amount')}</th>
              <th className={`text-right px-4 py-3 font-medium ${isDark ? 'text-neutral-500' : 'text-gray-500'}`}>{t('admin.beforeBalance')}</th>
              <th className={`text-right px-4 py-3 font-medium ${isDark ? 'text-neutral-500' : 'text-gray-500'}`}>{t('admin.afterBalance')}</th>
              <th className={`text-left px-4 py-3 font-medium ${isDark ? 'text-neutral-500' : 'text-gray-500'}`}>{t('admin.operator')}</th>
              <th className={`text-left px-4 py-3 font-medium ${isDark ? 'text-neutral-500' : 'text-gray-500'}`}>{t('admin.remark')}</th>
              <th className={`text-left px-4 py-3 font-medium ${isDark ? 'text-neutral-500' : 'text-gray-500'}`}>{t('admin.time')}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className={`text-center py-10 ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}><Loader2 className="animate-spin inline mr-2" size={16} />{t('admin.loading')}</td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan={7} className={`text-center py-10 ${isDark ? 'text-neutral-600' : 'text-gray-600'}`}>{t('admin.noLogs')}</td></tr>
            ) : logs.map(log => (
              <tr key={log.id} className={`border-t transition-colors ${isDark ? 'border-white/5 hover:bg-white/[0.02]' : 'border-gray-100 hover:bg-gray-50'}`}>
                <td className="px-4 py-3">
                  <span className={isDark ? 'text-white' : 'text-gray-900'}>{log.nickname || log.username}</span>
                  <span className={`text-xs ml-1 ${isDark ? 'text-neutral-600' : 'text-gray-500'}`}>@{log.username}</span>
                </td>
                <td className={`px-4 py-3 text-right font-mono ${Number(log.amount) < 0 ? (isDark ? 'text-red-400' : 'text-red-600') : (isDark ? 'text-green-400' : 'text-green-700')}`}>
                  {Number(log.amount) < 0 ? '-' : '+'}¥{Math.abs(Number(log.amount)).toFixed(2)}
                </td>
                <td className={`px-4 py-3 text-right font-mono ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>¥{Number(log.balance_before).toFixed(2)}</td>
                <td className={`px-4 py-3 text-right font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>¥{Number(log.balance_after).toFixed(2)}</td>
                <td className={`px-4 py-3 text-xs ${isDark ? 'text-neutral-400' : 'text-gray-500'}`}>{log.admin_username}</td>
                <td className={`px-4 py-3 text-xs ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{log.remark || '-'}</td>
                <td className={`px-4 py-3 text-xs ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{new Date(log.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button disabled={page <= 1} onClick={() => fetchLogs(page - 1)} className={`p-2 rounded-lg disabled:opacity-30 ${isDark ? 'bg-white/5 text-neutral-400 hover:text-white' : 'bg-gray-100 text-gray-500 hover:text-gray-900'}`}><ChevronLeft size={16} /></button>
          <span className={`text-xs ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{page} / {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => fetchLogs(page + 1)} className={`p-2 rounded-lg disabled:opacity-30 ${isDark ? 'bg-white/5 text-neutral-400 hover:text-white' : 'bg-gray-100 text-gray-500 hover:text-gray-900'}`}><ChevronRight size={16} /></button>
        </div>
      )}
    </div>
  );
};

// ══════════════════════════════════════════════════════════
//  Sortable Table Header
// ══════════════════════════════════════════════════════════

const SortTh: React.FC<{
  isDark: boolean;
  col: string;
  label: string;
  sortBy: string;
  sortDir: 'asc' | 'desc';
  onSort: (col: string) => void;
  align?: 'left' | 'right' | 'center';
  className?: string;
}> = ({ isDark, col, label, sortBy, sortDir, onSort, align = 'left', className = '' }) => {
  const active = sortBy === col;
  const Icon = active ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th
      onClick={() => onSort(col)}
      className={`px-3 py-2.5 font-medium cursor-pointer select-none transition-colors ${
        isDark ? 'text-neutral-500 hover:text-neutral-300' : 'text-gray-500 hover:text-gray-700'
      } ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'} ${className}`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <Icon size={12} className={active ? (isDark ? 'text-blue-400' : 'text-blue-600') : (isDark ? 'text-neutral-700' : 'text-gray-400')} />
      </span>
    </th>
  );
};

// ══════════════════════════════════════════════════════════
//  Filter Dropdown (dark-theme friendly, replaces native <select>)
// ══════════════════════════════════════════════════════════

const FilterDropdown: React.FC<{
  isDark: boolean;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}> = ({ isDark, label, value, options, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selected = options.find(o => o.value === value);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg border transition-colors ${
          value
            ? (isDark ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' : 'bg-blue-50 border-blue-200 text-blue-700')
            : (isDark ? 'bg-white/5 border-white/10 text-neutral-400 hover:text-white' : 'bg-gray-100 border-gray-200 text-gray-500 hover:text-gray-900')
        }`}
      >
        <span className={isDark ? 'text-neutral-500' : 'text-gray-400'}>{label}:</span>
        <span>{selected?.label ?? ''}</span>
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className={`absolute z-50 mt-1 min-w-[160px] py-1 rounded-lg ${isDark ? 'bg-neutral-900 border border-white/10 shadow-xl' : 'bg-white border border-gray-200 shadow-lg'}`}>
          {options.map(o => (
            <button
              key={o.value}
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                value === o.value
                  ? (isDark ? 'bg-blue-500/15 text-blue-400' : 'bg-blue-50 text-blue-700')
                  : (isDark ? 'text-neutral-300 hover:bg-white/5 hover:text-white' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900')
              }`}
            >
              {o.label}
              {value === o.value && <Check size={11} className="inline ml-2" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ══════════════════════════════════════════════════════════
//  Shared form components
// ══════════════════════════════════════════════════════════

const MiniInput: React.FC<{ isDark: boolean; value: string; onChange: (v: string) => void; type?: string }> = ({ isDark, value, onChange, type }) => (
  <input type={type || 'text'} value={value} onChange={e => onChange(e.target.value)}
    className={`w-full rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500/50 ${isDark ? 'bg-white/5 border border-white/10 text-white' : 'bg-gray-50 border border-gray-300 text-gray-900'}`} />
);

const InputField: React.FC<{ isDark: boolean; label: string; value: string; onChange: (v: string) => void }> = ({ isDark, label, value, onChange }) => (
  <div>
    <label className={`text-xs mb-1 block ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{label}</label>
    <input type="text" value={value} onChange={e => onChange(e.target.value)}
      className={`w-full px-3 py-2 rounded-lg text-xs focus:outline-none focus:border-blue-500/50 ${isDark ? 'bg-white/5 border border-white/10 text-white' : 'bg-gray-50 border border-gray-300 text-gray-900'}`} />
  </div>
);

const NumberField: React.FC<{ isDark: boolean; label: string; value: number; onChange: (v: number) => void; step?: number }> = ({ isDark, label, value, onChange, step }) => (
  <div>
    <label className={`text-xs mb-1 block ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{label}</label>
    <input type="number" value={value} step={step ?? 0.01} onChange={e => onChange(parseFloat(e.target.value) || 0)}
      className={`w-full px-3 py-2 rounded-lg text-xs focus:outline-none focus:border-blue-500/50 ${isDark ? 'bg-white/5 border border-white/10 text-white' : 'bg-gray-50 border border-gray-300 text-gray-900'}`} />
  </div>
);

const SelectField: React.FC<{ isDark: boolean; label: string; value: string; options: string[]; onChange: (v: string) => void }> = ({ isDark, label, value, options, onChange }) => (
  <div>
    <label className={`text-xs mb-1 block ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{label}</label>
    <div className="flex gap-1 flex-wrap">
      {options.map(o => (
        <button key={o} onClick={() => onChange(o)}
          className={`px-3 py-2 text-xs rounded-lg border transition-colors ${
            value === o
              ? (isDark ? 'bg-blue-500/20 border-blue-500/50 text-blue-400' : 'bg-blue-50 border-blue-500/50 text-blue-700')
              : (isDark ? 'bg-white/5 border-white/10 text-neutral-400 hover:text-white' : 'bg-gray-100 border-gray-200 text-gray-500 hover:text-gray-900')
          }`}>
          {o}
        </button>
      ))}
    </div>
  </div>
);

// ══════════════════════════════════════════════════════════
//  Resolution Pricing Visual Editor
// ══════════════════════════════════════════════════════════

const RpEditor: React.FC<{
  isDark: boolean;
  type: string;
  data: RpData;
  onChange: React.Dispatch<React.SetStateAction<RpData>>;
  onUpdatePrice: (mode: string, resolution: string, value: string) => void;
}> = ({ isDark, type, data, onChange, onUpdatePrice }) => {
  const isVideo = type === 'video';
  const baseResolutions = isVideo ? VIDEO_RESOLUTIONS : IMAGE_RESOLUTIONS;
  const allModes = isVideo ? VIDEO_MODES : IMAGE_MODES;

  const extraRes = new Set<string>();
  Object.values(data).forEach(md => {
    if (md && typeof md === 'object') Object.keys(md).forEach(r => { if (!baseResolutions.includes(r)) extraRes.add(r); });
  });
  const resolutions = [...baseResolutions, ...extraRes];

  const activeModes = Object.keys(data);
  const availableModes = allModes.filter(m => !activeModes.includes(m));
  const unit = isVideo ? '元/秒' : '元/张';

  return (
    <div>
      <label className={`text-xs mb-2 block ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>
        分辨率定价 ({unit})
      </label>

      {activeModes.length > 0 && (
        <div className={`rounded-lg border overflow-hidden mb-2 ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
          <table className="w-full text-xs">
            <thead>
              <tr className={isDark ? 'bg-white/[0.03]' : 'bg-gray-50'}>
                <th className={`text-left px-3 py-2 font-medium ${isDark ? 'text-neutral-500' : 'text-gray-500'}`}>生成模式</th>
                {resolutions.map(r => (
                  <th key={r} className={`text-center px-2 py-2 font-medium ${isDark ? 'text-neutral-500' : 'text-gray-500'}`}>{r}</th>
                ))}
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {activeModes.map(mode => (
                <tr key={mode} className={`border-t ${isDark ? 'border-white/5' : 'border-gray-100'}`}>
                  <td className={`px-3 py-1.5 whitespace-nowrap ${isDark ? 'text-neutral-300' : 'text-gray-700'}`}>
                    {MODE_LABELS[mode] || mode}
                    <span className={`ml-1 text-[10px] ${isDark ? 'text-neutral-600' : 'text-gray-400'}`}>({mode})</span>
                  </td>
                  {resolutions.map(res => (
                    <td key={res} className="px-1 py-1.5 text-center">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={data[mode]?.[res] ?? ''}
                        onChange={e => onUpdatePrice(mode, res, e.target.value)}
                        placeholder="—"
                        className={`w-[72px] rounded px-1.5 py-1 text-xs text-center font-mono focus:outline-none focus:ring-1 focus:ring-blue-500/50 ${isDark ? 'bg-white/5 border border-white/10 text-white placeholder:text-neutral-700' : 'bg-white border border-gray-200 text-gray-900 placeholder:text-gray-300'}`}
                      />
                    </td>
                  ))}
                  <td className="px-1 py-1.5 text-center">
                    <button
                      onClick={() => onChange(prev => { const { [mode]: _, ...rest } = prev; return rest; })}
                      title="删除此模式"
                      className={`p-1 rounded transition-colors ${isDark ? 'text-neutral-600 hover:text-red-400 hover:bg-red-500/10' : 'text-gray-400 hover:text-red-600 hover:bg-red-50'}`}
                    >
                      <X size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {availableModes.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-xs ${isDark ? 'text-neutral-600' : 'text-gray-400'}`}>添加模式:</span>
          {availableModes.map(m => (
            <button
              key={m}
              onClick={() => onChange(prev => ({ ...prev, [m]: {} }))}
              className={`text-[11px] px-2 py-1 rounded-md border transition-colors ${isDark ? 'border-white/10 text-neutral-400 hover:text-blue-400 hover:border-blue-500/30 hover:bg-blue-500/5' : 'border-gray-200 text-gray-500 hover:text-blue-700 hover:border-blue-300 hover:bg-blue-50'}`}
            >
              + {MODE_LABELS[m] || m}
            </button>
          ))}
        </div>
      )}

      {activeModes.length === 0 && availableModes.length === 0 && (
        <p className={`text-xs ${isDark ? 'text-neutral-600' : 'text-gray-400'}`}>无可用模式</p>
      )}
    </div>
  );
};
