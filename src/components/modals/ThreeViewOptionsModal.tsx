import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks/useTheme';

export interface ThreeViewOptions {
    style: 'original' | 'realistic' | 'anime' | 'illustration' | 'pixel';
    framing: 'fullBody' | 'upperBody' | 'headshot';
}

interface ThreeViewOptionsModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (options: ThreeViewOptions) => void;
    previewUrl?: string;
}

const STYLE_OPTIONS: { value: ThreeViewOptions['style']; i18nKey: string }[] = [
    { value: 'original', i18nKey: 'threeView.styleOriginal' },
    { value: 'realistic', i18nKey: 'threeView.styleRealistic' },
    { value: 'anime', i18nKey: 'threeView.styleAnime' },
    { value: 'illustration', i18nKey: 'threeView.styleIllustration' },
    { value: 'pixel', i18nKey: 'threeView.stylePixel' },
];

const FRAMING_OPTIONS: { value: ThreeViewOptions['framing']; i18nKey: string }[] = [
    { value: 'fullBody', i18nKey: 'threeView.framingFullBody' },
    { value: 'upperBody', i18nKey: 'threeView.framingUpperBody' },
    { value: 'headshot', i18nKey: 'threeView.framingHeadshot' },
];

export const ThreeViewOptionsModal: React.FC<ThreeViewOptionsModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    previewUrl,
}) => {
    const { isDark } = useTheme();
    const { t } = useTranslation();
    const [style, setStyle] = useState<ThreeViewOptions['style']>('original');
    const [framing, setFraming] = useState<ThreeViewOptions['framing']>('fullBody');

    useEffect(() => {
        if (isOpen) {
            setStyle('original');
            setFraming('fullBody');
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleConfirm = () => {
        onConfirm({ style, framing });
        onClose();
    };

    const chipBase = `px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer border`;
    const chipActive = isDark
        ? 'bg-white/10 border-white/30 text-white'
        : 'bg-gray-900 border-gray-900 text-white';
    const chipInactive = isDark
        ? 'bg-transparent border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200'
        : 'bg-transparent border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-700';

    return (
        <div
            className={`fixed inset-0 ${isDark ? 'bg-black/80' : 'bg-black/40'} backdrop-blur-sm z-50 flex items-center justify-center p-4`}
            onClick={onClose}
        >
            <div
                className={`${isDark ? 'bg-[var(--sf-bg-panel)] border-[var(--sf-border)]' : 'bg-white border-gray-200'} border rounded-2xl w-[420px] shadow-2xl overflow-hidden`}
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className={`flex items-center justify-between px-5 py-4 border-b ${isDark ? 'border-neutral-800' : 'border-gray-200'}`}>
                    <h3 className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                        {t('threeView.title')}
                    </h3>
                    <button onClick={onClose} className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-neutral-800 text-neutral-400 hover:text-white' : 'hover:bg-gray-100 text-gray-400 hover:text-gray-700'}`}>
                        <X size={16} />
                    </button>
                </div>

                <div className="px-5 py-4 flex flex-col gap-5">
                    {/* Preview thumbnail */}
                    {previewUrl && (
                        <div className={`rounded-lg overflow-hidden border ${isDark ? 'border-neutral-800' : 'border-gray-200'} h-28 flex items-center justify-center bg-black`}>
                            <img src={previewUrl} alt="" className="h-full object-contain" />
                        </div>
                    )}

                    {/* Style selection */}
                    <div>
                        <label className={`text-xs font-medium mb-2 block ${isDark ? 'text-neutral-400' : 'text-gray-500'}`}>
                            {t('threeView.styleLabel')}
                        </label>
                        <div className="flex flex-wrap gap-2">
                            {STYLE_OPTIONS.map(opt => (
                                <button
                                    key={opt.value}
                                    className={`${chipBase} ${style === opt.value ? chipActive : chipInactive}`}
                                    onClick={() => setStyle(opt.value)}
                                >
                                    {t(opt.i18nKey)}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Framing selection */}
                    <div>
                        <label className={`text-xs font-medium mb-2 block ${isDark ? 'text-neutral-400' : 'text-gray-500'}`}>
                            {t('threeView.framingLabel')}
                        </label>
                        <div className="flex flex-wrap gap-2">
                            {FRAMING_OPTIONS.map(opt => (
                                <button
                                    key={opt.value}
                                    className={`${chipBase} ${framing === opt.value ? chipActive : chipInactive}`}
                                    onClick={() => setFraming(opt.value)}
                                >
                                    {t(opt.i18nKey)}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className={`px-5 py-4 border-t ${isDark ? 'border-neutral-800' : 'border-gray-200'} flex justify-end gap-2`}>
                    <button
                        onClick={onClose}
                        className={`px-4 py-2 rounded-lg text-xs font-medium transition-colors ${isDark ? 'text-neutral-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'}`}
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        onClick={handleConfirm}
                        className={`px-5 py-2 rounded-lg text-xs font-medium text-white active:scale-95 transition-transform ${isDark ? 'sf-rainbow-btn' : 'lt-btn-primary'}`}
                    >
                        {t('threeView.generate')}
                    </button>
                </div>
            </div>
        </div>
    );
};
