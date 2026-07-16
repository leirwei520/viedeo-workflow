import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Cloud, CloudOff, Loader2, Check } from 'lucide-react';
import { API_URL, authFetch, AUTH_EXPIRED_EVENT } from '../config/api';
import { useTheme } from '../hooks/useTheme';
import { HoverBorderGradient } from './ui/hover-border-gradient';

interface SyncStatus {
    connected: boolean;
    workflows: number;
    images: number;
    videos: number;
}

export const CloudSyncIndicator: React.FC = () => {
    const [status, setStatus] = useState<SyncStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [showTooltip, setShowTooltip] = useState(false);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const stopPolling = useCallback(() => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
    }, []);

    const fetchStatus = useCallback(async () => {
        if (!localStorage.getItem('access_token')) {
            setStatus({ connected: false, workflows: 0, images: 0, videos: 0 });
            setLoading(false);
            stopPolling();
            return;
        }
        try {
            const res = await authFetch(`${API_URL}/cloud/status`);
            if (res.ok) {
                setStatus(await res.json());
            } else if (res.status === 401) {
                setStatus({ connected: false, workflows: 0, images: 0, videos: 0 });
                stopPolling();
            }
        } catch {
            setStatus({ connected: false, workflows: 0, images: 0, videos: 0 });
        } finally {
            setLoading(false);
        }
    }, [stopPolling]);

    useEffect(() => {
        fetchStatus();
        intervalRef.current = setInterval(fetchStatus, 30000);

        const onExpired = () => {
            stopPolling();
            setStatus({ connected: false, workflows: 0, images: 0, videos: 0 });
        };
        window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);

        return () => {
            stopPolling();
            window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
        };
    }, [fetchStatus, stopPolling]);

    const { isDark } = useTheme();

    if (loading) {
        return (
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${isDark ? 'text-neutral-600' : 'text-neutral-300'}`}>
                <Loader2 size={14} className="animate-spin" />
            </div>
        );
    }

    const connected = status?.connected ?? false;

    return (
        <div
            className="relative"
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
        >
            <HoverBorderGradient
                containerClassName="rounded-full"
                className={`w-10 h-10 flex items-center justify-center rounded-full cursor-default ${
                    isDark
                        ? `bg-[var(--sf-bg-deep)] ${
                              connected ? 'sf-rainbow-text opacity-70' : 'text-neutral-600'
                          }`
                        : `bg-white ${
                              connected ? 'text-green-600/70' : 'text-neutral-400'
                          }`
                }`}
                fillClassName={isDark ? undefined : 'bg-white'}
                duration={4}
            >
                {connected ? <Cloud size={16} /> : <CloudOff size={14} />}
            </HoverBorderGradient>

            {showTooltip && (
                <div className={`absolute top-full right-0 mt-2 px-3 py-2 rounded-lg text-xs whitespace-nowrap z-50 border shadow-lg ${
                    isDark
                        ? 'bg-neutral-900 border-neutral-700 text-neutral-300'
                        : 'bg-white border-gray-200 text-gray-600 shadow-md'
                }`}>
                    {connected ? (
                        <div className="space-y-1">
                            <div className="flex items-center gap-1.5 text-green-500 font-medium">
                                <Check size={12} />
                                <span>Cloud Sync Active</span>
                            </div>
                            <div className={isDark ? 'text-neutral-500' : 'text-neutral-400'}>
                                {status!.workflows} workflows, {status!.images} images, {status!.videos} videos
                            </div>
                        </div>
                    ) : (
                        <div className={isDark ? 'text-neutral-500' : 'text-neutral-400'}>
                            Cloud sync unavailable
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
