import React, { useState, useEffect } from 'react';
import { X, ChevronDown, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NodeData } from '../../types';
import { useTheme } from '../../hooks/useTheme';
import { authFetch, apiEndpoint } from '../../config/api';

interface CreateAssetModalProps {
    isOpen: boolean;
    onClose: () => void;
    nodeToSnapshot: NodeData | null;
    onSave: (name: string, category: string) => Promise<void>;
}

const CATEGORY_KEYS = [
    { value: 'Character', i18nKey: 'assetLibrary.character' },
    { value: 'Scene', i18nKey: 'assetLibrary.scene' },
    { value: 'Item', i18nKey: 'assetLibrary.item' },
    { value: 'Style', i18nKey: 'assetLibrary.style' },
    { value: 'Sound Effect', i18nKey: 'assetLibrary.soundEffect' },
    { value: 'Others', i18nKey: 'assetLibrary.others' },
];

export const CreateAssetModal: React.FC<CreateAssetModalProps> = ({
    isOpen,
    onClose,
    nodeToSnapshot,
    onSave,
}) => {
    const { isDark } = useTheme();
    const { t } = useTranslation();
    const [name, setName] = useState('');
    const [category, setCategory] = useState(CATEGORY_KEYS[0].value);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');

    // Reset state and generate unique name when opening
    useEffect(() => {
        if (isOpen) {
            setStatus('idle');
            setCategory(CATEGORY_KEYS[0].value);

            const baseName = t('assetLibrary.myAssets');
            authFetch(apiEndpoint('/api/library'))
                .then(res => res.ok ? res.json() : [])
                .then((assets: { name: string }[]) => {
                    const existingNames = new Set(assets.map(a => a.name));
                    if (!existingNames.has(baseName)) {
                        setName(baseName);
                        return;
                    }
                    let i = 1;
                    while (existingNames.has(`${baseName} ${i}`)) i++;
                    setName(`${baseName} ${i}`);
                })
                .catch(() => setName(baseName));
        }
    }, [isOpen, t]);

    if (!isOpen || !nodeToSnapshot) return null;

    const handleSubmit = async () => {
        if (!name.trim()) return;

        setStatus('saving');
        try {
            await onSave(name, category);
            setStatus('success');
            setTimeout(() => {
                onClose();
            }, 1000);
        } catch (e) {
            setStatus('error');
            setTimeout(() => setStatus('idle'), 2000);
        }
    };

    return (
        <div className={`fixed inset-0 ${isDark ? 'bg-black/80' : 'bg-black/40'} backdrop-blur-sm z-50 flex items-center justify-center p-4`}>
            <div className={`${isDark ? 'bg-[var(--sf-bg-panel)] border-[var(--sf-border)]' : 'bg-white border-gray-200'} border rounded-2xl w-[600px] shadow-2xl overflow-hidden flex flex-col`}>

                {/* Header */}
                <div className="px-6 pt-6 pb-2">
                    <div className={`flex items-center gap-6 border-b ${isDark ? 'border-neutral-700' : 'border-gray-200'} pb-2`}>
                        <span className={`font-medium border-b-2 ${isDark ? 'text-white border-white' : 'text-gray-900 border-gray-900'} pb-2 -mb-2.5`}>{t('assetLibrary.createAsset')}</span>
                    </div>
                </div>

                <div className="p-6 flex gap-6">
                    {/* Left: Cover Image */}
                    <div className="w-1/2 flex flex-col gap-2">
                        <label className={`text-sm font-medium ${isDark ? 'text-neutral-200' : 'text-gray-700'}`}>{t('assetLibrary.cover')} <span className="text-red-400">*</span></label>
                        <div className={`aspect-[3/4] rounded-lg overflow-hidden border ${isDark ? 'border-neutral-800 bg-neutral-900' : 'border-gray-200 bg-gray-100'} relative group`}>
                            <img
                                src={nodeToSnapshot.resultUrl || ''}
                                alt="Cover"
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                    (e.target as HTMLImageElement).src = 'https://placehold.co/400x600/1a1a1a/FFF?text=Error';
                                }}
                            />
                        </div>
                    </div>

                    {/* Right: Form */}
                    <div className="w-1/2 flex flex-col gap-6">

                        {/* Name Input */}
                        <div className="flex flex-col gap-2">
                            <label className={`text-sm font-medium ${isDark ? 'text-neutral-200' : 'text-gray-700'}`}>{t('assetLibrary.name')} <span className="text-red-400">*</span></label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className={`w-full ${isDark ? 'bg-[#1a1a1a] border-neutral-700 text-white focus:border-white/30' : 'bg-gray-50 border-gray-300 text-gray-900 focus:border-gray-500'} border rounded-lg px-3 py-2 focus:outline-none transition-colors`}
                                placeholder={t('assetLibrary.assetName')}
                            />
                        </div>

                        {/* Category Dropdown */}
                        <div className="flex flex-col gap-2 relative">
                            <label className={`text-sm font-medium ${isDark ? 'text-neutral-200' : 'text-gray-700'}`}>{t('assetLibrary.category')} <span className="text-red-400">*</span></label>
                            <button
                                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                                className={`w-full ${isDark ? 'bg-[#1a1a1a] border-neutral-700 text-white hover:bg-[#252525]' : 'bg-gray-50 border-gray-300 text-gray-900 hover:bg-gray-100'} border rounded-lg px-3 py-2 focus:outline-none flex items-center justify-between transition-colors`}
                            >
                                <span>{t(CATEGORY_KEYS.find(c => c.value === category)?.i18nKey || 'assetLibrary.others')}</span>
                                <ChevronDown size={16} className={isDark ? 'text-neutral-400' : 'text-gray-400'} />
                            </button>

                            {isDropdownOpen && (
                                <div className={`absolute top-[70px] left-0 right-0 ${isDark ? 'bg-[#1a1a1a] border-neutral-700' : 'bg-white border-gray-200'} border rounded-lg shadow-xl z-10 py-1`}>
                                    {CATEGORY_KEYS.map(cat => (
                                        <button
                                            key={cat.value}
                                            onClick={() => {
                                                setCategory(cat.value);
                                                setIsDropdownOpen(false);
                                            }}
                                            className={`w-full px-3 py-2 text-left ${isDark ? 'hover:bg-[#252525]' : 'hover:bg-gray-100'} flex items-center justify-between group`}
                                        >
                                            <span className={isDark ? 'text-neutral-300 group-hover:text-white' : 'text-gray-600 group-hover:text-gray-900'}>{t(cat.i18nKey)}</span>
                                            {category === cat.value && <Check size={14} className={isDark ? 'text-white' : 'text-gray-900'} />}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                    </div>
                </div>

                {/* Footer */}
                <div className={`p-4 border-t ${isDark ? 'border-neutral-800' : 'border-gray-200'} flex justify-end gap-2`}>
                    <button
                        onClick={onClose}
                        className={`px-4 py-2 ${isDark ? 'text-neutral-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'} transition-colors`}
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={status === 'saving' || status === 'success'}
                        className={`flex items-center gap-2 px-6 py-2 rounded-full text-sm font-medium transition-all duration-200 ${status === 'success' ? 'bg-green-600 text-white' :
                                status === 'error' ? 'bg-red-600 text-white' :
                                    status === 'saving' ? (isDark ? 'bg-neutral-700 text-neutral-300' : 'bg-gray-300 text-gray-500') :
                                        isDark ? 'sf-rainbow-btn text-white' : 'lt-btn-primary text-white'
                            }`}
                    >
                        {status === 'saving' && <div className={`w-4 h-4 border-2 ${isDark ? 'border-white/30 border-t-white' : 'border-gray-400 border-t-gray-700'} rounded-full animate-spin`} />}
                        {status === 'success' && <Check size={16} />}
                        {status === 'idle' && t('assetLibrary.create')}
                        {status === 'saving' && t('assetLibrary.savingAsset')}
                        {status === 'success' && t('assetLibrary.saved')}
                        {status === 'error' && t('assetLibrary.failed')}
                    </button>
                </div>

            </div>
        </div>
    );
};
