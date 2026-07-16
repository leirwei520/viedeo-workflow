/**
 * NodeControls.tsx
 * 
 * Control panel for canvas nodes.
 * Handles prompt input, model selection, size/ratio settings, and generation button.
 * For Video nodes: includes Advanced Settings for frame-to-frame mode.
 */

import React, { useState, useRef, useEffect, useMemo, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, Banana, Check, ChevronDown, GripVertical, Image as ImageIcon, Film, Clock, Expand, Shrink, Monitor, Crop, HardDrive, AlertTriangle, Timer } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NodeData, NodeStatus, NodeType } from '../../types';
import { OpenAIIcon, GoogleIcon, KlingIcon, HailuoIcon, ViduIcon, JimengIcon, DoubaoIcon, HunyuanIcon, QwenIcon, SoraIcon, TencentIcon } from '../icons/BrandIcons';
import { useFaceDetection } from '../../hooks/useFaceDetection';
import { useTheme } from '../../hooks/useTheme';
import { sanitizeError } from '../../utils/errorSanitizer';
import { ChangeAnglePanel } from './ChangeAnglePanel';
import { LocalModel, getLocalModels } from '../../services/localModelService';
import { HoverBorderGradient } from '../ui/hover-border-gradient';
import { NodeMentionDropdown, getNodeDisplayTitle, getNodeMentionThumbUrl, getMentionCandidates, getLibraryAssetCandidates, LibraryAssetItem } from './NodeMentionDropdown';
import { isValidConnectionByType } from '../../utils/connectionRules';
import { ossResize } from '../../config/api';
import { dataCache, CACHE_KEYS } from '../../services/dataCache';

interface NodeControlsProps {
    data: NodeData;
    inputUrl?: string;
    isLoading: boolean;
    isSuccess: boolean;
    connectedImageNodes?: { id: string; url: string; type?: NodeType }[]; // Connected parent nodes
    allNodes?: NodeData[];
    onUpdate: (id: string, updates: Partial<NodeData>) => void;
    onGenerate: (id: string) => void;
    onChangeAngleGenerate?: (nodeId: string) => void;
    onSelect: (id: string) => void;
    zoom: number;
}

const IMAGE_RATIOS = [
    "Auto", "1:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3", "5:4", "4:5", "21:9"
];

const VIDEO_RESOLUTIONS = [
    "Auto", "1080p", "768p", "720p", "512p"
];

// Video durations in seconds
const VIDEO_DURATIONS = [5, 6, 8, 10];

// Video model versions with metadata
// supportsTextToVideo: Can generate video from text prompt only
// supportsImageToVideo: Can use a single input image (start frame)
// supportsMultiImage: Can use multiple input images (frame-to-frame)
// durations: Supported video durations in seconds
// resolutions: Supported resolutions (model-specific)
// aspectRatios: Supported aspect ratios (most video models support 16:9 and 9:16)
const VIDEO_ASPECT_RATIOS = ["16:9", "9:16"];

// Video models from database (ai_video_model + ai_video_model_version)
// Format: id = "ModelName/ModelVersion" for Tencent VOD API
// Reference: 模型列表.xlsx
export const VIDEO_MODELS = [
    // 海螺 Hailuo (sort=10) - 720P支持6s/10s，1080P仅支持6s
    { id: 'Hailuo/02', name: '海螺 02', provider: 'hailuo', desc: '基础版，运动自然流畅', scene: '日常短视频', speed: '~2min', costHint: '¥3.5/5s', supportsTextToVideo: true, supportsImageToVideo: true, supportsMultiImage: false, supportsFirstLast: true, supportsAudio: false, durations: [6, 10], resolutions: ['720p', '1080p'], aspectRatios: ['16:9'] },
    { id: 'Hailuo/2.3', name: '海螺 2.3', provider: 'hailuo', desc: '画质增强，细节更丰富', scene: '高质量短视频', speed: '~2min', costHint: '¥4.0/5s', supportsTextToVideo: true, supportsImageToVideo: true, supportsMultiImage: false, supportsFirstLast: true, supportsAudio: false, durations: [6, 10], resolutions: ['720p', '1080p'], aspectRatios: ['16:9'] },
    { id: 'Hailuo/2.3-fast', name: '海螺 2.3 Fast', provider: 'hailuo', desc: '快速出图，适合批量', scene: '批量生产', speed: '~1min', costHint: '¥3.3/5s', supportsTextToVideo: true, supportsImageToVideo: true, supportsMultiImage: false, supportsFirstLast: true, supportsAudio: false, durations: [6, 10], resolutions: ['720p', '1080p'], aspectRatios: ['16:9'] },
    // 可灵 Kling (sort=20)
    { id: 'Kling/1.6', name: '可灵 1.6', provider: 'kling', desc: '经典版，多图合成', scene: '多图动画', speed: '~2min', costHint: '¥3.5/5s', supportsTextToVideo: false, supportsImageToVideo: true, supportsMultiImage: true, supportsFirstLast: false, supportsAudio: false, durations: [5, 10], resolutions: ['720p', '1080p'], aspectRatios: ['16:9', '9:16', '1:1'], maxImages: 4 },
    { id: 'Kling/2.1', name: '可灵 2.1', provider: 'kling', desc: '增强版，首尾帧+多图', scene: '精确控制', speed: '~2min', costHint: '¥4.0/5s', supportsTextToVideo: true, supportsImageToVideo: true, supportsMultiImage: true, supportsFirstLast: true, supportsAudio: false, durations: [5, 10], resolutions: ['720p', '1080p'], aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9'], note: '仅1080P支持首尾帧' },
    { id: 'Kling/2.5', name: '可灵 2.5 Turbo', provider: 'kling', desc: '极速生成，性价比最高', scene: '快速迭代', speed: '~1min', costHint: '¥4.8/5s', supportsTextToVideo: true, supportsImageToVideo: true, supportsMultiImage: false, supportsFirstLast: false, supportsAudio: false, durations: [5, 10], resolutions: ['720p', '1080p'], aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9'] },
    { id: 'Kling/O1', name: '可灵 O1', provider: 'kling', desc: '思考型，复杂场景理解力强', scene: '复杂叙事', speed: '~2min', costHint: '¥5.5/5s', supportsTextToVideo: true, supportsImageToVideo: true, supportsMultiImage: true, supportsFirstLast: true, supportsAudio: false, durations: [3, 4, 5, 6, 7, 8, 9, 10], resolutions: ['720p', '1080p'], aspectRatios: ['16:9', '9:16', '1:1'], maxImages: 7 },
    { id: 'Kling/2.6', name: '可灵 2.6', provider: 'kling', desc: '高质量画面，宽屏比支持', scene: '电影感短片', speed: '~2min', costHint: '¥5.5/5s', supportsTextToVideo: true, supportsImageToVideo: true, supportsMultiImage: true, supportsFirstLast: true, supportsAudio: false, durations: [5, 10], resolutions: ['720p', '1080p'], aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9'], note: '仅1080P无声视频支持首尾帧' },
    { id: 'Kling/2.6-audio', name: '可灵 2.6 音画同出', provider: 'kling', desc: '视频+音效同步生成', scene: '带声音的短视频', speed: '~2min', costHint: '¥6.3/5s', supportsTextToVideo: true, supportsImageToVideo: true, supportsMultiImage: true, supportsFirstLast: false, supportsAudio: true, durations: [5, 10], resolutions: ['720p', '1080p'], aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9'] },
    { id: 'Kling/3.0', name: '可灵 3.0', provider: 'kling', desc: '旗舰版，画质最优，全能力支持', scene: '高品质创作', speed: '~1min', costHint: '¥6.0/5s', recommended: true, supportsTextToVideo: true, supportsImageToVideo: true, supportsMultiImage: true, supportsFirstLast: true, supportsAudio: true, durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolutions: ['720p', '1080p'], aspectRatios: ['16:9', '9:16', '1:1'], maxImages: 2 },
    { id: 'Kling/3.0-Omni', name: '可灵 3.0 Omni', provider: 'kling', desc: '全能版，支持参考视频+7张图', scene: '专业级创作', speed: '~2min', costHint: '¥7.5/5s', supportsTextToVideo: true, supportsImageToVideo: true, supportsMultiImage: true, supportsFirstLast: true, supportsAudio: true, supportsReferenceVideo: true, durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolutions: ['720p', '1080p'], aspectRatios: ['16:9', '9:16', '1:1'], maxImages: 7, maxImagesWithVideo: 4, note: '有参考视频时图片不超过4张，参考图超过2时不支持尾帧' },
    // 生数 Vidu (sort=30)
    { id: 'Vidu/q2', name: '生数 Q2', provider: 'vidu', desc: '均衡型，支持多图+视频参考', scene: '综合创作', speed: '~2min', costHint: '¥3.5/5s', supportsTextToVideo: true, supportsImageToVideo: true, supportsMultiImage: true, supportsFirstLast: true, supportsAudio: false, supportsReferenceVideo: true, durations: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], resolutions: ['540p', '720p', '1080p'], aspectRatios: ['16:9', '9:16', '3:4', '4:3', '1:1'], maxImages: 4, maxVideos: 2 },
    { id: 'Vidu/q2-pro', name: '生数 Q2 Pro', provider: 'vidu', desc: '专业版，更高画质', scene: '高质量需求', speed: '~3min', costHint: '¥4.8/5s', supportsTextToVideo: true, supportsImageToVideo: true, supportsMultiImage: true, supportsFirstLast: true, supportsAudio: false, supportsReferenceVideo: true, durations: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], resolutions: ['720p', '1080p'], aspectRatios: ['16:9', '9:16', '3:4', '4:3', '1:1'], maxImages: 4, maxVideos: 2 },
    { id: 'Vidu/q2-turbo', name: '生数 Q2 Turbo', provider: 'vidu', desc: '极速版，7图合成', scene: '快速多图', speed: '~1min', costHint: '¥3.3/5s', supportsTextToVideo: true, supportsImageToVideo: true, supportsMultiImage: true, supportsFirstLast: true, supportsAudio: false, durations: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], resolutions: ['720p', '1080p'], aspectRatios: ['16:9', '9:16', '3:4', '4:3', '1:1'], maxImages: 7 },
    { id: 'Vidu/q3', name: '生数 Q3', provider: 'vidu', desc: '新一代，支持音频+视频参考', scene: '带声音创作', speed: '~2.5min', costHint: '¥4.8/5s', supportsTextToVideo: true, supportsImageToVideo: true, supportsMultiImage: true, supportsFirstLast: false, supportsAudio: true, supportsReferenceVideo: true, durations: [3, 4, 5, 6, 7, 8, 9, 10], resolutions: ['540p', '720p', '1080p'], aspectRatios: ['16:9', '9:16', '3:4', '4:3', '1:1'], maxImages: 5, maxVideos: 2 },
    { id: 'Vidu/q3-pro', name: '生数 Q3 Pro', provider: 'vidu', desc: '顶级画质，支持16秒长视频', scene: '长视频创作', speed: '~3min', costHint: '¥6.0/5s', supportsTextToVideo: true, supportsImageToVideo: true, supportsMultiImage: false, supportsFirstLast: true, supportsAudio: true, durations: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], resolutions: ['540p', '720p', '1080p'], aspectRatios: ['16:9', '9:16', '3:4', '4:3', '1:1'], maxImages: 1 },
    { id: 'Vidu/q3-turbo', name: '生数 Q3 Turbo', provider: 'vidu', desc: '快速版，音频+长视频', scene: '高效长视频', speed: '~2.5min', costHint: '¥4.0/5s', supportsTextToVideo: true, supportsImageToVideo: true, supportsMultiImage: false, supportsFirstLast: true, supportsAudio: true, durations: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], resolutions: ['540p', '720p', '1080p'], aspectRatios: ['16:9', '9:16', '3:4', '4:3', '1:1'], maxImages: 1 },
    // 即梦 Jimeng (sort=40)
    { id: 'Jimeng/3.0pro', name: '即梦 3.0 Pro', provider: 'jimeng', desc: '音画同出，宽屏比丰富', scene: '营销短视频', speed: '~1.5min', costHint: '¥4.8/5s', supportsTextToVideo: true, supportsImageToVideo: true, supportsMultiImage: false, supportsFirstLast: false, supportsAudio: true, durations: [5, 10], resolutions: ['1080p'], aspectRatios: ['16:9', '9:16', '3:4', '4:3', '1:1', '21:9'], note: '仅支持首帧' },
    // 豆包 Seedance (sort=50)
    { id: 'Seedance/2.0', name: '豆包 2.0', provider: 'seedance', desc: '最新版，9图合成+音频', scene: '动漫/插画动效', speed: '~3.5min', costHint: '¥5.0/5s', warning: '不支持真人人脸图片，会被安全审核拦截', supportsTextToVideo: true, supportsImageToVideo: true, supportsMultiImage: true, supportsFirstLast: true, supportsAudio: true, durations: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolutions: ['720p', '1080p'], aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '9:21'], maxImages: 9 },
    { id: 'Seedance/1.5-pro', name: '豆包 1.5 Pro', provider: 'seedance', desc: '文生视频专用，稳定输出', scene: '文字创意', speed: '~2min', costHint: '¥5.5/5s', warning: '不支持真人人脸图片', supportsTextToVideo: true, supportsImageToVideo: false, supportsMultiImage: false, supportsFirstLast: true, supportsAudio: true, durations: [4, 5, 6, 7, 8, 9, 10, 11, 12], resolutions: ['480p', '720p', '1080p'], aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '9:21'], maxImages: 2 },
    { id: 'Seedance/1.0-pro', name: '豆包 1.0 Pro', provider: 'seedance', desc: '基础文生视频', scene: '简单动效', speed: '~2min', costHint: '¥4.8/5s', warning: '不支持真人人脸图片', supportsTextToVideo: true, supportsImageToVideo: false, supportsMultiImage: false, supportsFirstLast: true, supportsAudio: false, durations: [5, 10], resolutions: ['480p', '720p', '1080p'], aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '9:21'], maxImages: 2 },
    { id: 'Seedance/1.0-pro-fast', name: '豆包 1.0 Pro Fast', provider: 'seedance', desc: '快速文生视频', scene: '快速预览', speed: '~1min', costHint: '¥4.0/5s', warning: '不支持真人人脸图片', supportsTextToVideo: true, supportsImageToVideo: false, supportsMultiImage: false, supportsFirstLast: false, supportsAudio: false, durations: [5, 10], resolutions: ['480p', '720p', '1080p'], aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '9:21'], maxImages: 1 },
    { id: 'Seedance/1.0-lite-i2v', name: '豆包 1.0 Lite', provider: 'seedance', desc: '轻量版，低成本入门', scene: '低成本测试', speed: '~1.5min', costHint: '¥3.3/5s', warning: '不支持真人人脸图片', supportsTextToVideo: true, supportsImageToVideo: false, supportsMultiImage: false, supportsFirstLast: true, supportsAudio: false, durations: [5, 10], resolutions: ['480p', '720p'], aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '9:21'], maxImages: 2 },
    // Google Veo (sort=60)
    { id: 'GV/3.1', name: 'Google Veo 3.1', provider: 'google', desc: '顶级画质，音画同出', scene: '专业影视级', speed: '~2min', costHint: '¥6.0/4s', supportsTextToVideo: true, supportsImageToVideo: true, supportsMultiImage: true, supportsFirstLast: true, supportsAudio: true, durations: [4, 8, 12], resolutions: ['720p', '1080p'], aspectRatios: ['16:9', '9:16'], maxImages: 3 },
    { id: 'GV/3.1-fast', name: 'Google Veo 3.1 Fast', provider: 'google', desc: '快速版，画质接近标准版', scene: '快速迭代', speed: '~1min', costHint: '¥4.6/4s', supportsTextToVideo: true, supportsImageToVideo: true, supportsMultiImage: true, supportsFirstLast: false, supportsAudio: false, durations: [4, 8, 12], resolutions: ['720p', '1080p'], aspectRatios: ['16:9', '9:16'] },
    // OpenAI Sora (sort=70) - 720P标准版
    { id: 'OS/2.0', name: 'Sora 2.0', provider: 'openai', desc: 'OpenAI出品，支持视频参考', scene: '创意视频', speed: '~3min', costHint: '¥7.5/5s', supportsTextToVideo: true, supportsImageToVideo: true, supportsMultiImage: true, supportsFirstLast: false, supportsAudio: false, supportsReferenceVideo: true, durations: [4, 8, 12], resolutions: ['720p'], aspectRatios: ['16:9', '9:16'], maxImages: 7, maxImagesWithVideo: 4, note: '有参考视频时最多4张图' },
    // 混元 Hunyuan (sort=80)
    { id: 'Hunyuan/1.5', name: '混元 1.5', provider: 'hunyuan', desc: '腾讯出品，性价比高', scene: '日常创作', speed: '~2min', costHint: '¥4.0/5s', supportsTextToVideo: true, supportsImageToVideo: true, supportsMultiImage: true, supportsFirstLast: false, supportsAudio: false, durations: [5], resolutions: ['480p', '720p', '1080p'], aspectRatios: ['16:9'], maxImages: 7 },
];

// Image model versions with metadata
// supportsImageToImage: Can use a single reference image (for image-to-image transformation)
// supportsMultiImage: Can use multiple reference images (2-4) via Multi-Image API
// Note: Kling V1 and V2-new don't support reference images in standard API
// Note: Kling V1.5 is the only Kling model supporting single-image reference via image_reference
// Note: Kling V2/V2.1 only support references via Multi-Image API
// aspectRatios: Supported aspect ratios for the model
const IMAGE_MODELS = [
    // ── Google (GEM/Nano) ──
    { id: 'gem-3.0', name: 'Nano Banana Pro', group: 'Google', provider: 'tencent', desc: '全能旗舰，14图参考，4K高清', speed: '~20s', costHint: '¥1.0', recommended: true, supportsImageToImage: true, supportsMultiImage: true, maxRefImages: 14, resolutions: ["1K", "2K", "4K"], aspectRatios: ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"] },
    { id: 'gem-3.1', name: 'Nano2', group: 'Google', provider: 'tencent', desc: '最新版，超多比例+512小图', speed: '~25s', costHint: '¥1.2', supportsImageToImage: true, supportsMultiImage: true, maxRefImages: 14, resolutions: ["512", "1K", "2K", "4K"], aspectRatios: ["1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9"] },
    { id: 'gem-2.5', name: 'Nano Banana', group: 'Google', provider: 'tencent', desc: '经济实惠，3图参考', speed: '~15s', costHint: '¥0.5', supportsImageToImage: true, supportsMultiImage: true, maxRefImages: 3, resolutions: ["1K", "2K", "4K"], aspectRatios: ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"] },
    // ── 可灵 Kling ──
    { id: 'kling-img-3.0', name: '可灵 3.0', group: '可灵 Kling', provider: 'tencent', desc: '高质量写实，细节精细', speed: '~20s', costHint: '¥1.5', recommended: true, supportsImageToImage: true, supportsMultiImage: false, maxRefImages: 1, resolutions: ["1K", "2K"], aspectRatios: ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"] },
    { id: 'kling-img-3.0-omni', name: '可灵 3.0-Omni', group: '可灵 Kling', provider: 'tencent', desc: '全能版，10图参考，4K输出', speed: '~25s', costHint: '¥2.0', supportsImageToImage: true, supportsMultiImage: true, maxRefImages: 10, resolutions: ["1K", "2K", "4K"], aspectRatios: ["Auto", "1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"] },
    { id: 'kling-img-2.1', name: '可灵 2.1', group: '可灵 Kling', provider: 'tencent', desc: '均衡版，4图参考', speed: '~15s', costHint: '¥1.0', supportsImageToImage: true, supportsMultiImage: true, maxRefImages: 4, resolutions: ["1K", "2K"], aspectRatios: ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"] },
    // ── Vidu (生数) ──
    { id: 'vidu-q2', name: '生数 Vidu q2', group: 'Vidu', provider: 'tencent', desc: '7图参考，4K输出', speed: '~20s', costHint: '¥1.0', supportsImageToImage: true, supportsMultiImage: true, maxRefImages: 7, resolutions: ["1080P", "2K", "4K"], aspectRatios: ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"] },
    // ── 豆包 Seedream ──
    { id: 'si-4.0', name: '豆包 Seedream 4.0', group: '豆包 Seedream', provider: 'tencent', desc: '稳定输出，14图参考', speed: '~15s', costHint: '¥1.0', supportsImageToImage: true, supportsMultiImage: true, maxRefImages: 14, resolutions: ["1K", "2K", "4K"], aspectRatios: [] },
    { id: 'si-4.5', name: '豆包 Seedream 4.5', group: '豆包 Seedream', provider: 'tencent', desc: '画质升级，2K起步', speed: '~20s', costHint: '¥1.2', supportsImageToImage: true, supportsMultiImage: true, maxRefImages: 14, resolutions: ["2K", "4K"], aspectRatios: [] },
    { id: 'si-5.0-lite', name: '豆包 Seedream 5.0-lite', group: '豆包 Seedream', provider: 'tencent', desc: '轻量版，性价比高', speed: '~12s', costHint: '¥0.8', supportsImageToImage: true, supportsMultiImage: true, maxRefImages: 14, resolutions: ["2K", "3K"], aspectRatios: [] },
    // ── 即梦 Jimeng ──
    { id: 'jimeng-4.0', name: '即梦 4.0', group: '即梦 Jimeng', provider: 'tencent', desc: '10图参考，风格多变', speed: '~15s', costHint: '¥1.0', supportsImageToImage: true, supportsMultiImage: true, maxRefImages: 10, resolutions: [], aspectRatios: [] },
    // ── 混元 Hunyuan ──
    { id: 'hunyuan-3.0', name: '混元 3.0', group: '混元 Hunyuan', provider: 'tencent', desc: '腾讯出品，中文理解强', speed: '~15s', costHint: '¥1.0', supportsImageToImage: true, supportsMultiImage: true, maxRefImages: 3, resolutions: [], aspectRatios: [] },
    // ── 千问 Qwen ──
    { id: 'qwen-0925', name: '千问 0925', group: '千问 Qwen', provider: 'tencent', desc: '阿里出品，仅文生图', speed: '~20s', costHint: '¥0.8', supportsImageToImage: false, supportsMultiImage: false, maxRefImages: 1, resolutions: [], aspectRatios: [] },
    // ── ChuHaiBang ──
    { id: 'chuhaibang', name: 'ChuHaiBang', group: 'ChuHaiBang', provider: 'chuhaibang', desc: '异步生图，支持图生图(最多3张)', speed: '~40s', costHint: '-', supportsImageToImage: true, supportsMultiImage: true, maxRefImages: 3, resolutions: [], aspectRatios: ["1:1", "3:4", "9:16", "4:3", "16:9"] },
    // ── 腾讯 Image 2 (OG) ──
    { id: 'og-image2-high', name: 'Image 2 高质量', group: '腾讯 Image 2', provider: 'tencent', desc: '链式推理生图，文字精准、细节逼真', speed: '~30s', costHint: '¥1.84', recommended: true, supportsImageToImage: true, supportsMultiImage: true, maxRefImages: 3, resolutions: ["1K", "2K", "4K"], aspectRatios: ["1:1", "3:2", "2:3", "3:4", "4:3", "16:9", "9:16", "21:9", "9:21"] },
    { id: 'og-image2-medium', name: 'Image 2 标准', group: '腾讯 Image 2', provider: 'tencent', desc: '均衡画质与速度，商业级可控性', speed: '~20s', costHint: '¥0.64', supportsImageToImage: true, supportsMultiImage: true, maxRefImages: 3, resolutions: ["1K", "2K", "4K"], aspectRatios: ["1:1", "3:2", "2:3", "3:4", "4:3", "16:9", "9:16", "21:9", "9:21"] },
    { id: 'og-image2-low', name: 'Image 2 快速', group: '腾讯 Image 2', provider: 'tencent', desc: '快速出图，适合创意迭代', speed: '~10s', costHint: '¥0.30', supportsImageToImage: true, supportsMultiImage: true, maxRefImages: 3, resolutions: ["1K", "2K", "4K"], aspectRatios: ["1:1", "3:2", "2:3", "3:4", "4:3", "16:9", "9:16", "21:9", "9:21"] },
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Build a prompt that includes angle transformation instructions
 * for generating the image from a different viewing angle
 */
function buildAnglePrompt(
    basePrompt: string,
    settings: { rotation: number; tilt: number; scale: number; wideAngle: boolean }
): string {
    const parts: string[] = [];

    // Base instruction
    parts.push('Generate this same image from a different camera angle.');

    // Rotation (horizontal)
    if (settings.rotation !== 0) {
        const direction = settings.rotation > 0 ? 'right' : 'left';
        parts.push(`The camera has rotated ${Math.abs(settings.rotation)}° to the ${direction}.`);
    }

    // Tilt (vertical)
    if (settings.tilt !== 0) {
        const direction = settings.tilt > 0 ? 'upward' : 'downward';
        parts.push(`The camera has tilted ${Math.abs(settings.tilt)}° ${direction}.`);
    }

    // Scale
    if (settings.scale !== 0) {
        if (settings.scale > 50) {
            parts.push('The camera is positioned closer to the subject.');
        } else if (settings.scale < 50 && settings.scale > 0) {
            parts.push('The camera is positioned slightly closer.');
        }
    }

    // Wide-angle lens
    if (settings.wideAngle) {
        parts.push('Use a wide-angle lens perspective with visible distortion at the edges.');
    }

    // Add original prompt context if provided
    if (basePrompt.trim()) {
        parts.push(`Original scene description: ${basePrompt}`);
    }

    return parts.join(' ');
}

/**
 * `innerText` inserts \\n between block-level siblings; Chrome may split a contenteditable into
 * multiple divs while typing, producing bogus newlines in state and then `<br>` after innerHTML sync.
 * This walk matches only real line breaks from `<br>` and mention chips as `data-mention` atoms.
 */
function getEditablePlainText(root: HTMLElement): string {
    const out: string[] = [];
    const walk = (node: Node): void => {
        if (node.nodeType === Node.TEXT_NODE) {
            out.push(node.nodeValue ?? '');
            return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const el = node as HTMLElement;
        if (el.tagName === 'BR') {
            out.push('\n');
            return;
        }
        if (el.getAttribute('contenteditable') === 'false' && el.hasAttribute('data-mention')) {
            out.push(el.getAttribute('data-mention') ?? '');
            return;
        }
        for (let i = 0; i < el.childNodes.length; i++) {
            walk(el.childNodes[i]);
        }
    };
    for (let i = 0; i < root.childNodes.length; i++) {
        walk(root.childNodes[i]);
    }
    return out.join('').replace(/\r\n/g, '\n');
}

function getEditablePlainTextFromRange(range: Range): string {
    const fragment = range.cloneContents();
    const wrap = document.createElement('div');
    wrap.appendChild(fragment);
    return getEditablePlainText(wrap);
}

function firstTextNodeInDocumentOrder(el: HTMLElement): Text | null {
    const st: Node[] = [];
    for (let i = el.childNodes.length - 1; i >= 0; i--) st.push(el.childNodes[i]);
    while (st.length) {
        const n = st.pop()!;
        if (n.nodeType === Node.TEXT_NODE) return n as Text;
        if (n.nodeType === Node.ELEMENT_NODE) {
            const e = n as HTMLElement;
            for (let i = e.childNodes.length - 1; i >= 0; i--) st.push(e.childNodes[i]);
        }
    }
    return null;
}

function restorePlainTextCaret(root: HTMLElement, pos: number): void {
    let consumed = 0;
    let found = false;
    const range = document.createRange();

    const walk = (node: Node): void => {
        if (found) return;
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.nodeValue ?? '';
            const len = text.length;
            if (pos < consumed + len) {
                range.setStart(node, pos - consumed);
                range.collapse(true);
                found = true;
                return;
            }
            if (pos === consumed + len) {
                range.setStart(node, len);
                range.collapse(true);
                found = true;
                return;
            }
            consumed += len;
            return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const el = node as HTMLElement;
        if (el.tagName === 'BR') {
            if (pos <= consumed) {
                range.setStartBefore(el);
                range.collapse(true);
                found = true;
                return;
            }
            consumed += 1;
            if (pos <= consumed) {
                range.setStartAfter(el);
                range.collapse(true);
                found = true;
                return;
            }
            return;
        }
        if (el.getAttribute('contenteditable') === 'false' && el.hasAttribute('data-mention')) {
            const mn = el.getAttribute('data-mention') ?? '';
            const len = mn.length;
            if (pos < consumed + len) {
                const rel = pos - consumed;
                const tn = firstTextNodeInDocumentOrder(el);
                if (tn && (tn.nodeValue?.length ?? 0) >= rel) {
                    range.setStart(tn, rel);
                } else {
                    range.setStartBefore(el);
                }
                range.collapse(true);
                found = true;
                return;
            }
            consumed += len;
            if (pos <= consumed) {
                range.setStartAfter(el);
                range.collapse(true);
                found = true;
                return;
            }
            return;
        }
        for (let i = 0; i < el.childNodes.length; i++) {
            walk(el.childNodes[i]);
        }
    };

    for (let i = 0; i < root.childNodes.length; i++) {
        walk(root.childNodes[i]);
    }

    if (!found) {
        range.selectNodeContents(root);
        range.collapse(false);
    }
    const sel = window.getSelection();
    if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
    }
}

const NodeControlsComponent: React.FC<NodeControlsProps> = ({
    data,
    inputUrl,
    isLoading,
    isSuccess,
    connectedImageNodes = [],
    allNodes = [],
    onUpdate,
    onGenerate,
    onChangeAngleGenerate,
    onSelect,
    zoom
}) => {
    const { t } = useTranslation();
    const { isDark } = useTheme();
    const [showSizeDropdown, setShowSizeDropdown] = useState(false);
    const [showAspectRatioDropdown, setShowAspectRatioDropdown] = useState(false);
    const [showDurationDropdown, setShowDurationDropdown] = useState(false);
    const [showResolutionDropdown, setShowResolutionDropdown] = useState(false);
    const [showCountDropdown, setShowCountDropdown] = useState(false);
    const [showModelDropdown, setShowModelDropdown] = useState(false);
    const [modelDropdownPosition, setModelDropdownPosition] = useState<{ top: number; left: number } | null>(null);
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
    const [localPrompt, setLocalPrompt] = useState(data.prompt || '');

    // @ mention state
    const [showMentionPicker, setShowMentionPicker] = useState(false);
    const [mentionFilter, setMentionFilter] = useState('');
    const [mentionStartPos, setMentionStartPos] = useState(0);
    const [mentionIndex, setMentionIndex] = useState(0);
    const [mentionAnchorRect, setMentionAnchorRect] = useState<DOMRect | null>(null);
    const promptRef = useRef<HTMLDivElement>(null);

    /** Match query for lists: raw text after `@` may start with `@` (`@@`), which would exclude every title; strip leading @. */
    const mentionSearchFilter = useMemo(() => mentionFilter.replace(/^@+/g, ''), [mentionFilter]);

    const mentionCandidates = useMemo(() =>
        showMentionPicker
            ? getMentionCandidates(allNodes, data.id, data.type, data.parentIds || [], mentionSearchFilter)
            : [],
    [showMentionPicker, allNodes, data.id, data.type, data.parentIds, mentionSearchFilter]);

    const libraryAssetCandidates = useMemo(() => {
        if (!showMentionPicker) return [];
        const cached = dataCache.get<LibraryAssetItem[]>(CACHE_KEYS.LIBRARY);
        if (!cached) return [];
        return getLibraryAssetCandidates(cached, data.assetMentions || [], mentionSearchFilter);
    }, [showMentionPicker, mentionSearchFilter, data.assetMentions]);

    const totalMentionCount = mentionCandidates.length + libraryAssetCandidates.length;

    const mentionPidRef = useRef(data.mentionParentIds);
    const parentPidRef = useRef(data.parentIds);
    const allNodesRef = useRef(allNodes);
    useEffect(() => { mentionPidRef.current = data.mentionParentIds; }, [data.mentionParentIds]);
    useEffect(() => { parentPidRef.current = data.parentIds; }, [data.parentIds]);
    useEffect(() => { allNodesRef.current = allNodes; }, [allNodes]);

    const dropdownRef = useRef<HTMLDivElement>(null);
    const aspectRatioDropdownRef = useRef<HTMLDivElement>(null);
    const durationDropdownRef = useRef<HTMLDivElement>(null);
    const resolutionDropdownRef = useRef<HTMLDivElement>(null);
    const countDropdownRef = useRef<HTMLDivElement>(null);
    const modelDropdownRef = useRef<HTMLDivElement>(null);
    const modelDropdownPortalRef = useRef<HTMLDivElement>(null);
    const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const lastSentPromptRef = useRef<string | undefined>(data.prompt); // Track what we sent

    // Local model state for LOCAL_IMAGE_MODEL and LOCAL_VIDEO_MODEL nodes
    const [localModels, setLocalModels] = useState<LocalModel[]>([]);
    const [isLoadingLocalModels, setIsLoadingLocalModels] = useState(false);
    const isLocalModelNode = data.type === NodeType.LOCAL_IMAGE_MODEL || data.type === NodeType.LOCAL_VIDEO_MODEL;

    // Fetch local models when node is a local model type
    useEffect(() => {
        if (!isLocalModelNode) return;

        const fetchModels = async () => {
            setIsLoadingLocalModels(true);
            try {
                const models = await getLocalModels();
                // Filter based on node type
                const filtered = data.type === NodeType.LOCAL_VIDEO_MODEL
                    ? models.filter(m => m.type === 'video')
                    : models.filter(m => m.type === 'image' || m.type === 'lora' || m.type === 'controlnet');
                setLocalModels(filtered);
            } catch (error) {
                console.error('Error fetching local models:', error);
            } finally {
                setIsLoadingLocalModels(false);
            }
        };
        fetchModels();
    }, [isLocalModelNode, data.type]);

    // Face detection hook for Kling V1.5 Face mode
    const { detectFaces, isModelLoaded: isFaceModelLoaded } = useFaceDetection();

    // Trigger face detection when Face mode is selected
    useEffect(() => {
        const runFaceDetection = async () => {
            if (
                data.klingReferenceMode === 'face' &&
                data.faceDetectionStatus === 'loading' &&
                connectedImageNodes?.[0]?.url &&
                isFaceModelLoaded
            ) {
                try {
                    const faces = await detectFaces(connectedImageNodes[0].url);
                    onUpdate(data.id, {
                        detectedFaces: faces,
                        faceDetectionStatus: faces.length > 0 ? 'success' : 'error'
                    });
                } catch (err) {
                    console.error('Face detection failed:', err);
                    onUpdate(data.id, { detectedFaces: [], faceDetectionStatus: 'error' });
                }
            }
        };
        runFaceDetection();
    }, [data.klingReferenceMode, data.faceDetectionStatus, connectedImageNodes, isFaceModelLoaded, detectFaces, onUpdate, data.id]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setShowSizeDropdown(false);
            }
            if (aspectRatioDropdownRef.current && !aspectRatioDropdownRef.current.contains(event.target as Node)) {
                setShowAspectRatioDropdown(false);
            }
            if (durationDropdownRef.current && !durationDropdownRef.current.contains(event.target as Node)) {
                setShowDurationDropdown(false);
            }
            if (modelDropdownRef.current && !modelDropdownRef.current.contains(event.target as Node) &&
                (!modelDropdownPortalRef.current || !modelDropdownPortalRef.current.contains(event.target as Node))) {
                setShowModelDropdown(false);
            }
            if (resolutionDropdownRef.current && !resolutionDropdownRef.current.contains(event.target as Node)) {
                setShowResolutionDropdown(false);
            }
            if (countDropdownRef.current && !countDropdownRef.current.contains(event.target as Node)) {
                setShowCountDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Sync local prompt with data.prompt ONLY when it changes externally (not from our own update)
    useEffect(() => {
        if (data.prompt !== lastSentPromptRef.current) {
            setLocalPrompt(data.prompt || '');
            lastSentPromptRef.current = data.prompt;
        }
    }, [data.prompt]);

    /** Old workflows had chip-only refs without `@标题` text — append tokens once into the prompt body. */
    const inlineMigrationDoneRef = useRef(false);
    useEffect(() => {
        if (inlineMigrationDoneRef.current || !data.mentionParentIds?.length || !allNodes?.length) return;
        const p = data.prompt ?? '';
        const toAppend: string[] = [];
        for (const pid of data.mentionParentIds) {
            const node = allNodes.find(n => n.id === pid);
            if (!node) continue;
            const tok = `@${getNodeDisplayTitle(node)}`;
            if (!p.includes(tok)) toAppend.push(tok);
        }
        if (toAppend.length === 0) {
            inlineMigrationDoneRef.current = true;
            return;
        }
        inlineMigrationDoneRef.current = true;
        const gap = p.length > 0 && !p.endsWith('\n') ? ' ' : '';
        const next = `${p}${gap}${toAppend.join(' ')}`;
        setLocalPrompt(next);
        lastSentPromptRef.current = next;
        onUpdate(data.id, { prompt: next });
    }, [data.id, data.prompt, data.mentionParentIds, allNodes, onUpdate]);

    // Cleanup timeout on unmount
    useEffect(() => {
        return () => {
            if (updateTimeoutRef.current) {
                clearTimeout(updateTimeoutRef.current);
            }
        };
    }, []);

    // ---- ContentEditable prompt rendering ----
    const escapeHtml = (text: string) =>
        text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

    /* `@` is a valid right-boundary so back-to-back chips render: `@场景 1@场景 2` ⇒ chip + chip. */
    const MENTION_BOUNDARY_RE = '(?=\\s|$|@|\\.|,|!|\\?|\u3002|\uFF0C|\uFF01|\uFF1F|\uFF1B|\uFF1A|\u3001|\uFF09|\\)|\\]|\u3011|\u300B|\u300D|\u300F|"|\'|\u201D|\u2019|\u2026|\u2014|[\\u4e00-\\u9fff\\u3400-\\u4dbf\\uf900-\\ufaff\\u3040-\\u309f\\u30a0-\\u30ff\\uac00-\\ud7af])';

    const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const promptToHtml = useCallback((text: string) => {
        if (!text) return '';
        let html = escapeHtml(text);
        const mentions = data.assetMentions || [];
        if (mentions.length > 0) {
            const sorted = [...mentions].sort((a, b) => b.name.length - a.name.length);
            const patterns: string[] = [];
            const lookup = new Map<string, (typeof mentions)[0]>();
            for (const m of sorted) {
                const key = `@${m.name}`;
                patterns.push(escapeRe(key));
                lookup.set(key, m);
            }
            const regex = new RegExp(`(${patterns.join('|')})${MENTION_BOUNDARY_RE}`, 'g');
            html = html.replace(regex, (match) => {
                const asset = lookup.get(match);
                if (!asset) return match;
                const safeName = escapeHtml(match);
                const safeUrl = escapeHtml(asset.url);
                const thumb = escapeHtml(ossResize(asset.url, 32));
                return `<span class="inline-flex items-center gap-1 align-middle ${isDark ? 'bg-violet-500/10 border-violet-500/30 text-violet-300' : 'bg-violet-100 border-violet-200 text-violet-600'} border rounded px-1 py-0.5 mx-0.5 cursor-pointer select-none text-[11px] font-medium" contenteditable="false" data-asset-url="${safeUrl}" data-mention="${safeName}"><img src="${thumb}" class="w-3.5 h-3.5 rounded-sm object-cover" />${safeName}</span>`;
            });
        }

        const mIds = [...new Set(data.mentionParentIds || [])];
        if (mIds.length > 0) {
            const entries = mIds.map(id => {
                const node = allNodes.find(n => n.id === id);
                if (!node) return null;
                const dn = getNodeDisplayTitle(node);
                const key = `@${dn}`;
                return { id, node, key };
            }).filter(Boolean) as { id: string; node: NodeData; key: string }[];

            entries.sort((a, b) => b.key.length - a.key.length);
            const patt: string[] = [];
            const nlookup = new Map<string, { id: string; node: NodeData }>();
            for (const e of entries) {
                patt.push(escapeRe(e.key));
                if (!nlookup.has(e.key)) nlookup.set(e.key, { id: e.id, node: e.node });
            }
            const nre = new RegExp(`(${patt.join('|')})${MENTION_BOUNDARY_RE}`, 'g');
            html = html.replace(nre, (match) => {
                const ent = nlookup.get(match);
                if (!ent) return match;
                const safeDisp = escapeHtml(match);
                const safeId = escapeHtml(ent.id);
                const thumbSrc = getNodeMentionThumbUrl(ent.node, 32);
                const thumb = thumbSrc
                    ? `<img src="${escapeHtml(thumbSrc)}" class="w-3.5 h-3.5 rounded-sm object-cover" alt="" />`
                    : '';
                return `<span class="inline-flex items-center gap-1 align-middle ${isDark ? 'bg-violet-500/10 border-violet-500/30 text-violet-300' : 'bg-violet-100 border-violet-200 text-violet-600'} border rounded px-1 py-0.5 mx-0.5 cursor-pointer select-none text-[11px] font-medium" contenteditable="false" data-node-mention="${safeId}" data-mention="${safeDisp}">${thumb}${safeDisp}</span>`;
            });
        }

        return html.replace(/\n/g, '<br>');
    }, [data.assetMentions, data.mentionParentIds, allNodes, isDark]);

    /** Stable key for when chip HTML / theme must refresh. `promptToHtml` useCallback changes every render if `allNodes` is a new array ref — do not use function identity for “typing vs chip” checks. */
    const promptHtmlStencilKey = useMemo(() => {
        const mids = [...new Set(data.mentionParentIds || [])].sort();
        const nodeBits = mids.map(id => {
            const n = allNodes.find(nn => nn.id === id);
            return n ? `${id}:${getNodeDisplayTitle(n)}` : `${id}:`;
        });
        const assets = (data.assetMentions || [])
            .map(m => `${m.name}\u0001${m.url}`)
            .sort()
            .join('\u0002');
        return `${isDark ? 'D' : 'L'}\u0000${nodeBits.join('\u0001')}\u0000${assets}`;
    }, [isDark, data.mentionParentIds, data.assetMentions, allNodes]);

    const getCursorOffset = (): number | null => {
        const el = promptRef.current;
        if (!el) return null;
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return null;
        try {
            const range = sel.getRangeAt(0);
            const pre = range.cloneRange();
            pre.selectNodeContents(el);
            pre.setEnd(range.startContainer, range.startOffset);
            return getEditablePlainTextFromRange(pre).length;
        } catch { return null; }
    };

    /** Last stencil we applied via innerHTML (avoids needless chip refresh when parent re-renders with new `allNodes` ref only). */
    const lastAppliedStencilRef = useRef<string | null>(null);

    useEffect(() => {
        if (!promptRef.current) return;
        const stencilChanged = lastAppliedStencilRef.current !== promptHtmlStencilKey;
        const currentText = getEditablePlainText(promptRef.current);
        const isFocused = document.activeElement === promptRef.current;
        /* Bail ONLY when DOM is already in sync (typing case). Picker insertion sets localPrompt to a value
         * the DOM doesn't have yet — must rewrite innerHTML to materialize the new chip even while focused. */
        if (isFocused && !stencilChanged && currentText === localPrompt) {
            return;
        }

        if (localPrompt !== currentText || stencilChanged) {
            const savedPos = isFocused ? getCursorOffset() : null;
            promptRef.current.innerHTML = promptToHtml(localPrompt);
            lastAppliedStencilRef.current = promptHtmlStencilKey;
            if (savedPos !== null) restorePlainTextCaret(promptRef.current, savedPos);
        }
    }, [localPrompt, promptToHtml, promptHtmlStencilKey]);

    /** Block @mention after ASCII letters/underscore only (typical `user@email`). Do not use \\w — digits would block `@场景 1@场景 2` (second @ after title-ending number). */
    const INLINE_AT_BLOCK = /^[A-Za-z_]$/;

    // Detect @ trigger from cursor position (contentEditable)
    const detectMentionTrigger = () => {
        const el = promptRef.current;
        if (!el) { setShowMentionPicker(false); return; }
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) { setShowMentionPicker(false); return; }
        try {
            const range = sel.getRangeAt(0);
            const pre = range.cloneRange();
            pre.selectNodeContents(el);
            pre.setEnd(range.startContainer, range.startOffset);
            const textBefore = getEditablePlainTextFromRange(pre);
            const atIdx = textBefore.lastIndexOf('@');
            if (atIdx !== -1) {
                const charBefore = atIdx >= 1 ? textBefore[atIdx - 1] : '';
                const blockMidWordAt = INLINE_AT_BLOCK.test(charBefore);
                if (!blockMidWordAt) {
                    const rawAfterAt = textBefore.substring(atIdx + 1);
                    /* Allow spaces — titles like "场景 2" contain a space; `includes(' ')` falsely closed picker. */
                    if (!rawAfterAt.includes('\n')) {
                        setShowMentionPicker(true);
                        setMentionFilter(rawAfterAt);
                        setMentionStartPos(atIdx);
                        setMentionIndex(0);
                        setMentionAnchorRect(el.getBoundingClientRect());
                        return;
                    }
                }
            }
        } catch { /* ignore range errors */ }
        setShowMentionPicker(false);
    };

    const insertMention = (node: NodeData) => {
        const cursorPos = getCursorOffset() ?? (mentionStartPos + mentionFilter.length + 1);
        const before = localPrompt.substring(0, mentionStartPos);
        const after = localPrompt.substring(cursorPos);
        const token = `@${getNodeDisplayTitle(node)}`;
        /* Always pad a trailing space when chip is at end-of-text — Chromium otherwise routes next keystroke INSIDE the contenteditable=false chip, breaking subsequent `@`. */
        const needsSpace = after.length === 0 || !/^[\s，。,!?.、@]/.test(after);
        const newValue = `${before}${token}${needsSpace ? ' ' : ''}${after}`;

        setLocalPrompt(newValue);
        lastSentPromptRef.current = newValue;
        setShowMentionPicker(false);
        setMentionFilter('');

        const existingParents = data.parentIds || [];
        const existingMentionParents = data.mentionParentIds || [];
        const updates: Partial<NodeData> = { prompt: newValue };
        const canWire = isValidConnectionByType(node.type, data.type);
        if (canWire && !existingParents.includes(node.id)) {
            updates.parentIds = [...existingParents, node.id];
        }
        if (!existingMentionParents.includes(node.id)) {
            updates.mentionParentIds = [...existingMentionParents, node.id];
        }
        onUpdate(data.id, updates);

        const cursorAfter = before.length + token.length + (needsSpace ? 1 : 0);
        setTimeout(() => {
            if (promptRef.current) {
                promptRef.current.focus();
                restorePlainTextCaret(promptRef.current, cursorAfter);
            }
        }, 50);
    };

    const insertAssetMention = (asset: LibraryAssetItem) => {
        const cursorPos = getCursorOffset() ?? (mentionStartPos + mentionFilter.length + 1);
        const before = localPrompt.substring(0, mentionStartPos);
        const after = localPrompt.substring(cursorPos);
        const token = `@${asset.name}`;
        const needsSpace = after.length === 0 || !/^[\s，。,!?.、@]/.test(after);
        const newValue = `${before}${token}${needsSpace ? ' ' : ''}${after}`;

        setLocalPrompt(newValue);
        lastSentPromptRef.current = newValue;
        setShowMentionPicker(false);
        setMentionFilter('');

        const existing = data.assetMentions || [];
        if (!existing.some(m => m.url === asset.url)) {
            onUpdate(data.id, {
                prompt: newValue,
                assetMentions: [...existing, { name: asset.name, url: asset.url }],
                characterReferenceUrls: [...(data.characterReferenceUrls || []), asset.url],
            });
        } else {
            onUpdate(data.id, { prompt: newValue });
        }

        const cursorAfter = before.length + token.length + (needsSpace ? 1 : 0);
        setTimeout(() => {
            if (promptRef.current) {
                promptRef.current.focus();
                restorePlainTextCaret(promptRef.current, cursorAfter);
            }
        }, 50);
    };

    const removeAssetMention = (url: string) => {
        const newMentions = (data.assetMentions || []).filter(m => m.url !== url);
        const newRefUrls = (data.characterReferenceUrls || []).filter(u => u !== url);
        onUpdate(data.id, { assetMentions: newMentions, characterReferenceUrls: newRefUrls });
    };

    // Handle contentEditable input with debounce + @ detection
    const handlePromptChange = () => {
        if (!promptRef.current) return;
        const value = getEditablePlainText(promptRef.current);
        /* Run picker detection on every input event — caret-only diffs (chip insertion via Chrome auto-fix, fast `@@@`) may leave value === localPrompt but still need re-evaluation. */
        detectMentionTrigger();
        if (value === localPrompt) return;
        setLocalPrompt(value);
        lastSentPromptRef.current = value;
        if (updateTimeoutRef.current) {
            clearTimeout(updateTimeoutRef.current);
        }
        updateTimeoutRef.current = setTimeout(() => {
            const txt = promptRef.current ? getEditablePlainText(promptRef.current) : '';
            const patch: Partial<NodeData> = { prompt: txt };
            const mids = [...new Set(mentionPidRef.current || [])];
            const nodesList = allNodesRef.current || [];
            const removed: string[] = [];
            for (const pid of mids) {
                const node = nodesList.find(n => n.id === pid);
                if (!node) {
                    removed.push(pid);
                    continue;
                }
                if (!txt.includes(`@${getNodeDisplayTitle(node)}`)) removed.push(pid);
            }
            if (removed.length > 0) {
                patch.mentionParentIds = mids.filter(id => !removed.includes(id));
                patch.parentIds = (parentPidRef.current || []).filter(id => !removed.includes(id));
            }
            onUpdate(data.id, patch);
        }, 320);
    };

    const handleMentionChipClick = (e: React.MouseEvent) => {
        const target = e.target as HTMLElement;
        const assetChip = target.closest('[data-asset-url]') as HTMLElement | null;
        if (assetChip) {
            e.stopPropagation();
            const url = assetChip.getAttribute('data-asset-url');
            if (url) window.open(url, '_blank');
            return;
        }
        const nodeChip = target.closest('[data-node-mention]') as HTMLElement | null;
        if (nodeChip) {
            e.stopPropagation();
            const nid = nodeChip.getAttribute('data-node-mention');
            if (nid) onSelect(nid);
        }
    };

    const handleSizeSelect = (value: string) => {
        if (data.type === NodeType.VIDEO) {
            onUpdate(data.id, { resolution: value });
        } else {
            onUpdate(data.id, { aspectRatio: value });
        }
        setShowSizeDropdown(false);
    };

    const handleAspectRatioSelect = (value: string) => {
        onUpdate(data.id, { aspectRatio: value });
        setShowAspectRatioDropdown(false);
    };

    const handleVideoModeChange = (mode: 'standard' | 'frame-to-frame') => {
        if (mode === 'frame-to-frame') {
            // Initialize frameInputs from ALL connected nodes
            const initialFrameInputs = connectedImageNodes.map((node, idx) => {
                let order: 'start' | 'end' | string;
                if (idx === 0) {
                    order = 'start';
                } else if (idx === connectedImageNodes.length - 1) {
                    order = 'end';
                } else {
                    order = `frame-${idx + 1}`;
                }
                return { nodeId: node.id, order };
            });
            onUpdate(data.id, { videoMode: mode, frameInputs: initialFrameInputs });
        } else {
            onUpdate(data.id, { videoMode: mode, frameInputs: undefined });
        }
    };

    const handleFrameReorder = (fromIndex: number, toIndex: number) => {
        if (fromIndex === toIndex || connectedImageNodes.length < 2) return;

        // Create a copy of current frameInputs or initialize from connectedImageNodes
        const currentInputs = data.frameInputs && data.frameInputs.length === connectedImageNodes.length
            ? [...data.frameInputs]
            : connectedImageNodes.map((node, idx) => ({
                nodeId: node.id,
                order: idx === 0 ? 'start' : idx === connectedImageNodes.length - 1 ? 'end' : `frame-${idx + 1}`
            }));

        // Move item from fromIndex to toIndex
        const [movedItem] = currentInputs.splice(fromIndex, 1);
        currentInputs.splice(toIndex, 0, movedItem);

        // Reassign orders based on new positions
        const updatedFrameInputs = currentInputs.map((input, idx) => ({
            nodeId: input.nodeId,
            order: idx === 0 ? 'start' : idx === currentInputs.length - 1 ? 'end' : `frame-${idx + 1}`
        }));

        onUpdate(data.id, { frameInputs: updatedFrameInputs });
    };

    const currentSizeLabel = (data.type === NodeType.VIDEO || data.type === NodeType.LOCAL_VIDEO_MODEL)
        ? (data.resolution || "Auto")
        : (data.aspectRatio || "Auto");

    // For image nodes, use model-specific aspect ratios (sizeOptions for video computed later with availableResolutions)
    const currentImageModelForRatios = IMAGE_MODELS.find(m => m.id === data.imageModel) || IMAGE_MODELS[0];
    const imageAspectRatioOptions = currentImageModelForRatios.aspectRatios || IMAGE_RATIOS;
    const isVideoNode = data.type === NodeType.VIDEO || data.type === NodeType.LOCAL_VIDEO_MODEL;
    const isImageNode = data.type === NodeType.IMAGE || data.type === NodeType.LOCAL_IMAGE_MODEL;
    const hasConnectedImages = connectedImageNodes.length > 0;

    // Video model selection logic
    const currentVideoModel = VIDEO_MODELS.find(m => m.id === data.videoModel) || VIDEO_MODELS[0];
    const isFrameToFrame = data.videoMode === 'frame-to-frame';

    // Determine video generation mode based on inputs and settings
    // 1. Motion Control: If any parent is a video node (as motion reference)
    // 2. Frame-to-Frame: If multiple image parents or explicitly set
    // 3. Image-to-Video: If single image parent or inputUrl (last frame)
    // 4. Text-to-Video: Otherwise
    const videoParents = connectedImageNodes.filter(n => n.type === NodeType.VIDEO);
    const imageParents = connectedImageNodes.filter(n => n.type === NodeType.IMAGE);
    const hasVideoParent = videoParents.length > 0;
    const imageInputCount = imageParents.length;
    const videoInputCount = videoParents.length;

    const videoGenerationMode = hasVideoParent ? 'motion-control'
        : (isFrameToFrame || imageInputCount >= 2) ? 'frame-to-frame'
            : (inputUrl || imageInputCount > 0) ? 'image-to-video'
                : 'text-to-video';

    // Filter video models based on mode and input constraints
    const availableVideoModels = VIDEO_MODELS.filter(model => {
        // 1. Check basic mode support
        if (videoGenerationMode === 'motion-control') {
            // Motion control requires reference video support
            return model.supportsReferenceVideo || model.id === 'kling-v2-6';
        }
        if (videoGenerationMode === 'text-to-video') {
            if (!model.supportsTextToVideo) return false;
        } else if (videoGenerationMode === 'image-to-video') {
            if (!model.supportsImageToVideo) return false;
        } else {
            // frame-to-frame mode requires multi-image support
            if (!model.supportsMultiImage) return false;
        }
        
        // 2. Check if model supports reference video (when video is connected)
        if (videoInputCount > 0 && !model.supportsReferenceVideo) {
            return false;
        }
        
        // 3. Check max video limit
        if (videoInputCount > 0 && model.maxVideos && videoInputCount > model.maxVideos) {
            return false;
        }
        
        // 4. Check max image limit - ALWAYS check when multiple images are connected
        // This ensures models with maxImages=1 are filtered out even if mode detection fails
        if (imageInputCount > 1) {
            // Multiple images: model must support multi-image
            if (!model.supportsMultiImage) {
                return false;
            }
            // Check maxImages limit
            const maxAllowedImages = videoInputCount > 0 
                ? (model.maxImagesWithVideo || model.maxImages || Infinity)
                : (model.maxImages || Infinity);
            if (imageInputCount > maxAllowedImages) {
                return false;
            }
        } else if (imageInputCount === 1) {
            // Single image: check maxImages >= 1
            const maxAllowedImages = videoInputCount > 0 
                ? (model.maxImagesWithVideo || model.maxImages || Infinity)
                : (model.maxImages || Infinity);
            if (maxAllowedImages < 1) {
                return false;
            }
        }
        
        return true;
    });

    // Auto-select first available video model when current is no longer valid
    useEffect(() => {
        if (data.type !== NodeType.VIDEO) return;

        const isCurrentModelAvailable = availableVideoModels.some(m => m.id === data.videoModel);
        if (!isCurrentModelAvailable && availableVideoModels.length > 0) {
            onUpdate(data.id, { videoModel: availableVideoModels[0].id });
        }
    }, [videoGenerationMode, data.videoModel, data.type, data.id, availableVideoModels, onUpdate]);

    const handleVideoModelChange = (modelId: string) => {
        const newModel = VIDEO_MODELS.find(m => m.id === modelId);
        const updates: Partial<typeof data> = { videoModel: modelId };

        // Reset duration if current duration is not supported by new model
        if (newModel?.durations && data.videoDuration && !newModel.durations.includes(data.videoDuration)) {
            updates.videoDuration = newModel.durations[0];
        }

        // Reset resolution if current resolution is not supported by new model
        // Normalize to lowercase for comparison
        if (newModel?.resolutions && data.resolution) {
            const currentRes = data.resolution.toLowerCase();
            const supportedRes = newModel.resolutions.map(r => r.toLowerCase());
            if (!supportedRes.includes(currentRes)) {
                updates.resolution = newModel.resolutions[0];
            }
        }

        onUpdate(data.id, updates);
        setShowModelDropdown(false);
    };

    // Handle model dropdown toggle
    const handleModelDropdownToggle = () => {
        setShowModelDropdown(!showModelDropdown);
    };

    // Compute dropdown position once when opened, close on scroll/resize
    useEffect(() => {
        if (!showModelDropdown || !modelDropdownRef.current) {
            setModelDropdownPosition(null);
            return;
        }

        const rect = modelDropdownRef.current.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const spaceBelow = viewportHeight - rect.bottom;
        const dropdownMaxH = Math.min(480, viewportHeight - 40);
        const openUpward = spaceBelow < 200 && rect.top > spaceBelow;

        setModelDropdownPosition({
            top: openUpward ? Math.max(8, rect.top - dropdownMaxH - 4) : rect.bottom + 4,
            left: rect.left
        });

        const closeOnScroll = (e: Event) => {
            if (modelDropdownPortalRef.current?.contains(e.target as Node)) return;
            setShowModelDropdown(false);
        };
        const closeOnResize = () => setShowModelDropdown(false);
        const closeOnPointerDown = (e: PointerEvent) => {
            if (modelDropdownRef.current?.contains(e.target as Node)) return;
            if (modelDropdownPortalRef.current?.contains(e.target as Node)) return;
            setShowModelDropdown(false);
        };
        window.addEventListener('scroll', closeOnScroll, true);
        window.addEventListener('resize', closeOnResize);
        window.addEventListener('pointerdown', closeOnPointerDown, true);
        window.addEventListener('wheel', closeOnScroll, true);
        return () => {
            window.removeEventListener('scroll', closeOnScroll, true);
            window.removeEventListener('resize', closeOnResize);
            window.removeEventListener('pointerdown', closeOnPointerDown, true);
            window.removeEventListener('wheel', closeOnScroll, true);
        };
    }, [showModelDropdown]);

    // Get available durations for current model
    const availableDurations = currentVideoModel.durations || [5];
    const currentDuration = data.videoDuration || availableDurations[0];

    // Get available resolutions for current model (considering duration for models with durationResolutionMap)
    const getAvailableResolutions = () => {
        const model = currentVideoModel as any;
        if (model.durationResolutionMap && currentDuration) {
            return model.durationResolutionMap[currentDuration] || model.resolutions || VIDEO_RESOLUTIONS;
        }
        return model.resolutions || VIDEO_RESOLUTIONS;
    };
    const availableResolutions = getAvailableResolutions();

    // sizeOptions: For video nodes use model-specific resolutions, for image nodes use aspect ratios
    const sizeOptions = (data.type === NodeType.VIDEO || data.type === NodeType.LOCAL_VIDEO_MODEL)
        ? availableResolutions
        : imageAspectRatioOptions;

    const handleDurationChange = (duration: number) => {
        const model = currentVideoModel as any;
        const updates: Partial<typeof data> = { videoDuration: duration };

        // If model has duration-specific resolutions, reset resolution if needed
        if (model.durationResolutionMap) {
            const allowedResolutions = model.durationResolutionMap[duration] || model.resolutions;
            if (data.resolution && !allowedResolutions.includes(data.resolution.toLowerCase())) {
                updates.resolution = allowedResolutions[0];
            }
        }

        onUpdate(data.id, updates);
        setShowDurationDropdown(false);
    };

    // Image model selection logic
    const currentImageModel = IMAGE_MODELS.find(m => m.id === data.imageModel) || IMAGE_MODELS[0];

    // Filter image models based on connected inputs
    // 0 inputs = all models, 1 input = needs supportsImageToImage, 2+ inputs = needs supportsMultiImage
    const inputCount = connectedImageNodes.length;
    const availableImageModels = IMAGE_MODELS.filter(model => {
        if (inputCount === 0) return true; // Text-to-image: all models work
        if (inputCount === 1) return model.supportsImageToImage; // Single ref: filter out V2.1
        return model.supportsMultiImage; // Multi-ref: filter out V1, V1.5, V2 New
    });

    // Auto-select first available model when current model is no longer valid for the mode
    useEffect(() => {
        if (data.type !== NodeType.IMAGE && data.type !== NodeType.IMAGE_EDITOR) return;

        const isCurrentModelAvailable = availableImageModels.some(m => m.id === data.imageModel);
        if (!isCurrentModelAvailable && availableImageModels.length > 0) {
            // Auto-select first available model
            onUpdate(data.id, { imageModel: availableImageModels[0].id });
        }
    }, [inputCount, data.imageModel, data.type, data.id, availableImageModels, onUpdate]);

    // Determine current generation mode for display
    const imageGenerationMode = inputCount === 0 ? 'text-to-image'
        : inputCount === 1 ? 'image-to-image'
            : 'multi-image';

    const handleImageModelChange = (modelId: string) => {
        const newModel = IMAGE_MODELS.find(m => m.id === modelId);
        const updates: Partial<typeof data> = { imageModel: modelId };

        // Reset aspect ratio if current ratio is not supported by new model
        if (newModel?.aspectRatios && data.aspectRatio && !newModel.aspectRatios.includes(data.aspectRatio)) {
            updates.aspectRatio = 'Auto';
        }

        // Reset resolution if current resolution is not supported by new model
        if (newModel?.resolutions && data.resolution && !newModel.resolutions.includes(data.resolution)) {
            updates.resolution = newModel.resolutions[0] || 'Auto';
        }

        onUpdate(data.id, updates);
        setShowModelDropdown(false);
    };

    // Handle local model selection
    const handleLocalModelChange = (model: LocalModel) => {
        onUpdate(data.id, {
            localModelId: model.id,
            localModelPath: model.path,
            localModelType: model.type as NodeData['localModelType'],
            localModelArchitecture: model.architecture
        });
        setShowModelDropdown(false);
    };

    // Get selected local model for display
    const selectedLocalModel = localModels.find(m => m.id === data.localModelId);

    const handleResolutionSelect = (value: string) => {
        onUpdate(data.id, { resolution: value });
        setShowResolutionDropdown(false);
    };

    // Get frame inputs with their image URLs.
    // The visible row order MUST match `data.frameInputs` (the user's reorder result) so that
    // dragging visually moves the IMAGE between rows, while the start / end / frame-N label
    // stays anchored to its row position.
    const orderedConnectedImageNodes = (() => {
        if (
            data.frameInputs &&
            data.frameInputs.length > 0 &&
            data.frameInputs.length === connectedImageNodes.length
        ) {
            const byId = new Map(connectedImageNodes.map((n) => [n.id, n] as const));
            const seen = new Set<string>();
            const result: typeof connectedImageNodes = [];
            for (const fi of data.frameInputs) {
                const node = byId.get(fi.nodeId);
                if (node && !seen.has(node.id)) {
                    result.push(node);
                    seen.add(node.id);
                }
            }
            // Defensive: append any newly-connected nodes that are not yet in frameInputs.
            for (const n of connectedImageNodes) {
                if (!seen.has(n.id)) result.push(n);
            }
            return result;
        }
        return connectedImageNodes;
    })();

    const frameInputsWithUrls = orderedConnectedImageNodes.map((node, idx) => {
        // Labels are purely positional: first = start, last = end, middle = frame-N.
        let order: 'start' | 'end' | string;
        if (idx === 0) {
            order = 'start';
        } else if (idx === orderedConnectedImageNodes.length - 1) {
            order = 'end';
        } else {
            order = `frame-${idx + 1}`;
        }
        return {
            nodeId: node.id,
            url: node.url,
            type: node.type,
            order,
            index: idx,
        };
    });

    // Handle angle mode generate - creates a new connected node
    const handleAngleGenerate = () => {
        if (onChangeAngleGenerate) {
            onChangeAngleGenerate(data.id);
        }
    };

    // Compact regenerate button for hideControls nodes (three-view)
    if (data.hideControls) {
        return (
            <HoverBorderGradient
                containerClassName={`rounded-xl ${isDark ? '' : 'p-0'}`}
                className={`rounded-[10px] ${isDark ? 'bg-[var(--sf-bg-panel)]' : 'bg-white'}`}
                fillClassName={isDark ? undefined : 'bg-white'}
                duration={4}
            >
            <div
                className={`px-2 py-1.5 rounded-[10px] cursor-default transition-colors duration-300 ${isDark ? '' : 'lt-panel-solid'}`}
                onPointerDown={(e) => e.stopPropagation()}
            >
                {isLoading ? (
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isDark ? 'bg-neutral-800' : 'bg-gray-100'}`}>
                        <div className={`w-4 h-4 border-2 rounded-full animate-spin ${isDark ? 'border-white/20 border-t-white' : 'border-gray-300 border-t-gray-600'}`} />
                    </div>
                ) : (
                    <button
                        onClick={(e) => { e.stopPropagation(); onGenerate(data.id); }}
                        className={`group w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-200 ${isDark ? 'sf-rainbow-btn active:scale-95' : 'lt-btn-primary active:scale-95'}`}
                        title={t('nodes.generate')}
                    >
                        <Sparkles size={15} />
                    </button>
                )}
            </div>
            </HoverBorderGradient>
        );
    }

    // If in angle mode for Image nodes with result, show ChangeAnglePanel
    if (data.angleMode && data.type === NodeType.IMAGE && isSuccess && data.resultUrl) {
        return (
            <div
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onSelect(data.id)}
            >
                <ChangeAnglePanel
                    imageUrl={data.resultUrl}
                    settings={data.angleSettings || { rotation: 0, tilt: 0, scale: 0, wideAngle: false }}
                    onSettingsChange={(settings) => onUpdate(data.id, { angleSettings: settings })}
                    onClose={() => onUpdate(data.id, { angleMode: false })}
                    onGenerate={handleAngleGenerate}
                    isLoading={isLoading}
                />
            </div>
        );
    }

    return (
        <HoverBorderGradient
            containerClassName={`rounded-xl w-full ${isDark ? '' : 'p-0'}`}
            className={`rounded-[10px] ${isDark ? 'bg-[var(--sf-bg-panel)]' : 'bg-white'}`}
            fillClassName={isDark ? undefined : 'bg-white'}
            duration={4}
        >
        <div
            className={`p-4 rounded-[10px] cursor-default w-full transition-colors duration-300 ${isDark ? '' : 'lt-panel-solid'}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onSelect(data.id)}
        >
            {/* Prompt Textarea with Expand Button - Hidden for hideControls nodes (three-view) */}
            {!data.hideControls && (
                <div className="mb-3">
                    <div className="relative">
                        {!localPrompt && (
                            <div className={`absolute inset-0 pointer-events-none text-sm font-light ${isDark ? 'text-neutral-600' : 'text-gray-400'}`}>
                                {data.type === NodeType.VIDEO && isFrameToFrame && currentVideoModel.provider === 'kling'
                                    ? t('nodes.promptOptionalKling')
                                    : data.type === NodeType.VIDEO && inputUrl
                                        ? t('nodes.describeAnimation')
                                        : t('nodes.describeGeneration')}
                            </div>
                        )}
                        <div
                            ref={promptRef}
                            contentEditable
                            suppressContentEditableWarning
                            className={`w-full bg-transparent text-sm outline-none font-light whitespace-pre-wrap [overflow-wrap:break-word] overflow-y-auto leading-snug ${isDark ? 'text-white' : 'text-gray-700'}`}
                            style={{ minHeight: data.isPromptExpanded ? '240px' : '80px' }}
                            onInput={handlePromptChange}
                            onWheel={(e) => e.stopPropagation()}
                            onClick={handleMentionChipClick}
                            onKeyDown={(e) => {
                                if (showMentionPicker) {
                                    if (e.key === 'ArrowDown') {
                                        e.preventDefault();
                                        setMentionIndex(prev => prev + 1);
                                        return;
                                    }
                                    if (e.key === 'ArrowUp') {
                                        e.preventDefault();
                                        setMentionIndex(prev => Math.max(0, prev - 1));
                                        return;
                                    }
                                    if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
                                        e.preventDefault();
                                        if (totalMentionCount > 0) {
                                            const idx = mentionIndex % totalMentionCount;
                                            if (idx < libraryAssetCandidates.length) {
                                                insertAssetMention(libraryAssetCandidates[idx]);
                                            } else {
                                                insertMention(mentionCandidates[idx - libraryAssetCandidates.length]);
                                            }
                                        }
                                        return;
                                    }
                                    if (e.key === 'Escape') {
                                        e.preventDefault();
                                        setShowMentionPicker(false);
                                        return;
                                    }
                                }
                                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                                    e.preventDefault();
                                    if (isLoading) return;
                                    const isFaceModeBlocked = !isVideoNode &&
                                        data.imageModel === 'kling-v1-5' &&
                                        data.klingReferenceMode === 'face' &&
                                        (data.faceDetectionStatus === 'error' || data.faceDetectionStatus === 'loading');
                                    if (isFaceModeBlocked) return;
                                    if (updateTimeoutRef.current) {
                                        clearTimeout(updateTimeoutRef.current);
                                    }
                                    if (localPrompt !== data.prompt) {
                                        onUpdate(data.id, { prompt: localPrompt });
                                    }
                                    onGenerate(data.id);
                                }
                            }}
                            onBlur={() => {
                                if (updateTimeoutRef.current) {
                                    clearTimeout(updateTimeoutRef.current);
                                }
                                if (localPrompt !== data.prompt) {
                                    onUpdate(data.id, { prompt: localPrompt });
                                }
                                setTimeout(() => setShowMentionPicker(false), 200);
                            }}
                        />
                    </div>
                    {/* @ Mention Dropdown (portal) */}
                    {showMentionPicker && totalMentionCount > 0 && (
                        <NodeMentionDropdown
                            candidates={mentionCandidates}
                            libraryAssets={libraryAssetCandidates}
                            selectedIndex={mentionIndex}
                            onSelect={insertMention}
                            onSelectAsset={insertAssetMention}
                            anchorRect={mentionAnchorRect}
                        />
                    )}
                    {/* Expand/Shrink Button - Below textarea */}
                    <div className="flex justify-end mt-1">
                        <button
                            onClick={() => onUpdate(data.id, { isPromptExpanded: !data.isPromptExpanded })}
                            className={`flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded transition-colors ${isDark ? 'text-neutral-500 hover:text-white hover:bg-neutral-700' : 'text-gray-400 hover:sf-rainbow-text hover:bg-white/10'}`}
                            title={data.isPromptExpanded ? t('nodes.shrinkPrompt') : t('nodes.expandPrompt')}
                        >
                            {data.isPromptExpanded ? <Shrink size={12} /> : <Expand size={12} />}
                            <span>{data.isPromptExpanded ? t('nodes.shrink') : t('nodes.expand')}</span>
                        </button>
                    </div>
                </div>
            )}

            {data.errorMessage && (
                <div className={`text-xs mb-2 p-1 rounded flex items-center justify-between gap-2 ${isDark ? 'text-red-400 bg-red-900/20 border border-red-900/50' : 'text-red-500 bg-red-50 border border-red-200'}`}>
                    <span>{sanitizeError(data.errorMessage)}</span>
                    <button
                        onClick={() => onGenerate(data.id)}
                        className={`flex-shrink-0 px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${isDark ? 'bg-red-800/60 hover:bg-red-700/80 text-red-200' : 'bg-red-100 hover:bg-red-200 text-red-600'}`}
                    >
                        {t('nodes.retry') || '重试'}
                    </button>
                </div>
            )}

            {/* Motion Control Warning - when motion mode detected but no character image */}
            {isVideoNode && videoGenerationMode === 'motion-control' && imageInputCount === 0 && (
                <div className={`text-xs mb-2 p-2 rounded flex items-start gap-2 ${isDark ? 'text-amber-400 bg-amber-900/20 border border-amber-700/50' : 'text-red-500 bg-red-50 border border-red-200'}`}>
                    <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <span>
                        {t('nodes.motionControlWarning')}
                    </span>
                </div>
            )}

            {/* Minimal controls for hideControls nodes - just regenerate button */}
            {data.hideControls && (
                <div className="flex items-center justify-end">
                    {isLoading ? (
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${isDark ? 'bg-neutral-800' : 'bg-gray-100'}`}>
                            <div className={`w-4 h-4 border-2 rounded-full animate-spin ${isDark ? 'border-white/20 border-t-white' : 'border-gray-300 border-t-gray-600'}`} />
                        </div>
                    ) : (
                        <button
                            onClick={(e) => { e.stopPropagation(); onGenerate(data.id); }}
                            className={`group w-9 h-9 rounded-lg flex items-center justify-center transition-all duration-200 ${isDark ? 'sf-rainbow-btn active:scale-95' : 'lt-btn-primary active:scale-95'}`}
                            title={t('nodes.generate')}
                        >
                            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
                                <polygon points="5 3 19 12 5 21 5 3" />
                            </svg>
                        </button>
                    )}
                </div>
            )}

            {/* Controls - Hidden for hideControls nodes (three-view) */}
            {!data.hideControls && (
                <div className="flex items-center justify-between relative">
                    <div className="flex items-center gap-2">
                        {/* Model Selector - Local, Video, and Image nodes get different dropdowns */}
                        {isLocalModelNode ? (
                            <div className="relative" ref={modelDropdownRef}>
                                <button
                                    onClick={handleModelDropdownToggle}
                                    className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors ${isDark ? 'sf-rainbow-btn text-white' : 'bg-white hover:bg-gray-50 border border-gray-200 text-gray-700'}`}
                                >
                                    <HardDrive size={12} className="sf-rainbow-text" />
                                    <span className="font-medium">{selectedLocalModel?.name || t('nodes.selectModel')}</span>
                                    <ChevronDown size={12} className="ml-0.5 opacity-50" />
                                </button>

                                {/* Local Model Dropdown Menu - Portal to body */}
                                {showModelDropdown && modelDropdownPosition && createPortal(
                                    <div 
                                        ref={modelDropdownPortalRef}
                                        className={`fixed w-56 ${isDark ? 'bg-[#252525] border border-neutral-700' : 'bg-white border border-gray-200'} rounded-lg shadow-xl overflow-hidden z-[9999] animate-in fade-in zoom-in-95 duration-100`}
                                        style={{ top: modelDropdownPosition.top, left: modelDropdownPosition.left }}
                                        onWheel={e => e.stopPropagation()}
                                        onPointerDown={e => e.stopPropagation()}
                                    >
                                        {/* Header */}
                                        <div className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 ${isDark ? 'text-neutral-400 bg-[#1a1a1a] border-b border-neutral-700' : 'text-gray-600 bg-gray-50 border-b border-gray-200'}`}>
                                            <HardDrive size={10} />
                                            {t('nodes.localModels')}
                                        </div>

                                        {isLoadingLocalModels ? (
                                            <div className={`px-3 py-4 text-xs text-center ${isDark ? 'text-neutral-500' : 'text-gray-600'}`}>{t('nodes.loadingModels')}</div>
                                        ) : localModels.length === 0 ? (
                                            <div className={`px-3 py-4 text-xs text-center ${isDark ? 'text-neutral-500' : 'text-gray-600'}`}>
                                                <p>{t('nodes.noModelsFound')}</p>
                                                <p className={`text-[10px] mt-1 ${isDark ? 'text-neutral-400' : 'text-gray-500'}`}>{t('nodes.addModelsHint')}</p>
                                            </div>
                                        ) : (
                                            localModels.map(model => (
                                                <button
                                                    key={model.id}
                                                    onClick={() => handleLocalModelChange(model)}
                                                    className={`w-full flex items-center justify-between px-3 py-2 text-[13px] text-left ${isDark ? 'hover:bg-[#333]' : 'hover:bg-gray-100'} transition-colors ${data.localModelId === model.id ? 'sf-rainbow-text' : isDark ? 'text-neutral-300' : 'text-gray-700'}`}
                                                >
                                                    <span className="flex flex-col items-start gap-0.5">
                                                        <span className="flex items-center gap-2">
                                                            <HardDrive size={12} className="sf-rainbow-text" />
                                                            {model.name}
                                                            {model.architecture && model.architecture !== 'unknown' && (
                                                                <span className="text-[10px] px-1 py-0.5 bg-white/10 sf-rainbow-text rounded">{model.architecture.toUpperCase()}</span>
                                                            )}
                                                        </span>
                                                        <span className={`text-[11px] ml-5 ${isDark ? 'text-neutral-500' : 'text-gray-500'}`}>{model.sizeFormatted}</span>
                                                    </span>
                                                    {data.localModelId === model.id && <Check size={12} />}
                                                </button>
                                            ))
                                        )}
                                    </div>,
                                    document.body
                                )}
                            </div>
                        ) : data.type === NodeType.VIDEO ? (
                            <div className="relative" ref={modelDropdownRef}>
                                <button
                                    onClick={handleModelDropdownToggle}
                                    className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors ${isDark ? 'sf-rainbow-btn text-white' : 'bg-white hover:bg-gray-50 border border-gray-200 text-gray-700'}`}
                                >
                                    {currentVideoModel.provider === 'google' ? (
                                        <GoogleIcon size={12} className={isDark ? 'text-white' : 'text-gray-700'} />
                                    ) : currentVideoModel.provider === 'kling' ? (
                                        <KlingIcon size={14} />
                                    ) : currentVideoModel.provider === 'hailuo' ? (
                                        <HailuoIcon size={14} />
                                    ) : currentVideoModel.provider === 'openai' ? (
                                        <SoraIcon size={14} />
                                    ) : currentVideoModel.provider === 'vidu' ? (
                                        <ViduIcon size={14} />
                                    ) : currentVideoModel.provider === 'jimeng' ? (
                                        <JimengIcon size={14} />
                                    ) : currentVideoModel.provider === 'seedance' ? (
                                        <DoubaoIcon size={14} />
                                    ) : currentVideoModel.provider === 'hunyuan' ? (
                                        <HunyuanIcon size={14} />
                                    ) : (
                                        <Film size={12} className="sf-rainbow-text" />
                                    )}
                                    <span className="font-medium">{currentVideoModel.name}</span>
                                    <ChevronDown size={12} className="ml-0.5 opacity-50" />
                                </button>

                                {/* Model Dropdown Menu - Portal to body */}
                                {showModelDropdown && modelDropdownPosition && createPortal(
                                    <div 
                                        ref={modelDropdownPortalRef}
                                        className={`fixed w-72 ${isDark ? 'bg-[#252525] border border-neutral-700' : 'bg-white border border-gray-200'} rounded-lg shadow-xl overflow-hidden z-[9999] animate-in fade-in zoom-in-95 duration-100 max-h-[520px] overflow-y-auto`}
                                        style={{ top: modelDropdownPosition.top, left: modelDropdownPosition.left }}
                                        onWheel={e => e.stopPropagation()}
                                        onPointerDown={e => e.stopPropagation()}
                                    >
                                        {/* Mode indicator */}
                                        <div className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 ${isDark ? 'text-neutral-400 bg-[#1a1a1a] border-b border-neutral-700' : 'text-gray-600 bg-gray-50 border-b border-gray-200'}`}>
                                            <span className={`w-1.5 h-1.5 rounded-full ${videoGenerationMode === 'text-to-video' ? 'bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500' :
                                                videoGenerationMode === 'image-to-video' ? 'bg-green-400' :
                                                    videoGenerationMode === 'motion-control' ? 'bg-orange-400' : 'bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500'
                                                }`} />
                                            {videoGenerationMode === 'text-to-video' ? t('nodes.textToVideo') :
                                                videoGenerationMode === 'image-to-video' ? t('nodes.imageToVideo') :
                                                    videoGenerationMode === 'motion-control' ? t('nodes.motionControl') :
                                                        t('nodes.frameToFrame')}
                                        </div>
                                        {/* Google Veo Models */}
                                        {availableVideoModels.filter(m => m.provider === 'google').length > 0 && (
                                            <>
                                                <div className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider ${isDark ? 'text-neutral-500 bg-[#1f1f1f]' : 'text-gray-600 bg-gray-50'}`}>
                                                    Google Veo
                                                </div>
                                                {availableVideoModels.filter(m => m.provider === 'google').map(model => (
                                                    <button
                                                        key={model.id}
                                                        onClick={() => handleVideoModelChange(model.id)}
                                                        className={`w-full flex items-start justify-between px-3 py-2 text-[13px] text-left ${isDark ? 'hover:bg-[#333]' : 'hover:bg-gray-100'} transition-colors ${currentVideoModel.id === model.id ? 'sf-rainbow-text' : isDark ? 'text-neutral-300' : 'text-gray-700'
                                                            }`}
                                                    >
                                                        <div className="flex flex-col gap-0.5 min-w-0">
                                                            <span className="flex items-center gap-2">
                                                                <GoogleIcon size={12} className={`shrink-0 ${isDark ? 'text-white' : 'text-gray-700'}`} />
                                                                {model.name}
                                                                {model.supportsAudio && (
                                                                    <span className="text-[10px] px-1 py-0.5 bg-white/10 sf-rainbow-text rounded">音频</span>
                                                                )}
                                                            </span>
                                                            {model.desc && <span className={`text-[11px] pl-5 ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{model.desc} · <Timer size={10} className="inline -mt-px" />{model.speed} · {model.costHint}</span>}
                                                        </div>
                                                        {currentVideoModel.id === model.id && <Check size={12} className="shrink-0 mt-0.5" />}
                                                    </button>
                                                ))}
                                            </>
                                        )}

                                        {/* Kling 可灵 Models */}
                                        {availableVideoModels.filter(m => m.provider === 'kling').length > 0 && (
                                            <>
                                                <div className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider border-t ${isDark ? 'text-neutral-500 bg-[#1f1f1f] border-neutral-700' : 'text-gray-600 bg-gray-50 border-gray-200'}`}>
                                                    可灵 Kling
                                                </div>
                                                {availableVideoModels.filter(m => m.provider === 'kling').map(model => (
                                                    <button
                                                        key={model.id}
                                                        onClick={() => handleVideoModelChange(model.id)}
                                                        className={`w-full flex items-start justify-between px-3 py-2 text-[13px] text-left ${isDark ? 'hover:bg-[#333]' : 'hover:bg-gray-100'} transition-colors ${currentVideoModel.id === model.id ? 'sf-rainbow-text' : isDark ? 'text-neutral-300' : 'text-gray-700'
                                                            }`}
                                                    >
                                                        <div className="flex flex-col gap-0.5 min-w-0">
                                                            <span className="flex items-center gap-2 flex-wrap">
                                                                <KlingIcon size={14} className="shrink-0" />
                                                                {model.name}
                                                                {model.recommended && (
                                                                    <span className="text-[10px] px-1 py-0.5 bg-green-600/30 text-green-400 rounded">REC</span>
                                                                )}
                                                                {model.supportsReferenceVideo && (
                                                                    <span className="text-[9px] px-1 py-0.5 bg-orange-600/30 text-orange-400 rounded">+视频</span>
                                                                )}
                                                                {model.supportsAudio && (
                                                                    <span className="text-[10px] px-1 py-0.5 bg-white/10 sf-rainbow-text rounded">音频</span>
                                                                )}
                                                            </span>
                                                            {model.desc && <span className={`text-[11px] pl-5 ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{model.desc} · <Timer size={10} className="inline -mt-px" />{model.speed} · {model.costHint}</span>}
                                                        </div>
                                                        {currentVideoModel.id === model.id && <Check size={12} className="shrink-0 mt-0.5" />}
                                                    </button>
                                                ))}
                                            </>
                                        )}

                                        {/* Hailuo 海螺 Models */}
                                        {availableVideoModels.filter(m => m.provider === 'hailuo').length > 0 && (
                                            <>
                                                <div className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider border-t ${isDark ? 'text-neutral-500 bg-[#1f1f1f] border-neutral-700' : 'text-gray-600 bg-gray-50 border-gray-200'}`}>
                                                    海螺 Hailuo
                                                </div>
                                                {availableVideoModels.filter(m => m.provider === 'hailuo').map(model => (
                                                    <button
                                                        key={model.id}
                                                        onClick={() => handleVideoModelChange(model.id)}
                                                        className={`w-full flex items-start justify-between px-3 py-2 text-[13px] text-left ${isDark ? 'hover:bg-[#333]' : 'hover:bg-gray-100'} transition-colors ${currentVideoModel.id === model.id ? 'sf-rainbow-text' : isDark ? 'text-neutral-300' : 'text-gray-700'
                                                            }`}
                                                    >
                                                        <div className="flex flex-col gap-0.5 min-w-0">
                                                            <span className="flex items-center gap-2">
                                                                <HailuoIcon size={14} className="shrink-0" />
                                                                {model.name}
                                                                {model.recommended && (
                                                                    <span className="text-[10px] px-1 py-0.5 bg-green-600/30 text-green-400 rounded">REC</span>
                                                                )}
                                                            </span>
                                                            {model.desc && <span className={`text-[11px] pl-5 ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{model.desc} · <Timer size={10} className="inline -mt-px" />{model.speed} · {model.costHint}</span>}
                                                        </div>
                                                        {currentVideoModel.id === model.id && <Check size={12} className="shrink-0 mt-0.5" />}
                                                    </button>
                                                ))}
                                            </>
                                        )}

                                        {/* Vidu 生数 Models */}
                                        {availableVideoModels.filter(m => m.provider === 'vidu').length > 0 && (
                                            <>
                                                <div className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider border-t ${isDark ? 'text-neutral-500 bg-[#1f1f1f] border-neutral-700' : 'text-gray-600 bg-gray-50 border-gray-200'}`}>
                                                    生数 Vidu
                                                </div>
                                                {availableVideoModels.filter(m => m.provider === 'vidu').map(model => (
                                                    <button
                                                        key={model.id}
                                                        onClick={() => handleVideoModelChange(model.id)}
                                                        className={`w-full flex items-start justify-between px-3 py-2 text-[13px] text-left ${isDark ? 'hover:bg-[#333]' : 'hover:bg-gray-100'} transition-colors ${currentVideoModel.id === model.id ? 'sf-rainbow-text' : isDark ? 'text-neutral-300' : 'text-gray-700'
                                                            }`}
                                                    >
                                                        <div className="flex flex-col gap-0.5 min-w-0">
                                                            <span className="flex items-center gap-2 flex-wrap">
                                                                <ViduIcon size={14} className="shrink-0" />
                                                                {model.name}
                                                                {model.recommended && (
                                                                    <span className="text-[10px] px-1 py-0.5 bg-green-600/30 text-green-400 rounded">REC</span>
                                                                )}
                                                                {model.supportsReferenceVideo && (
                                                                    <span className="text-[9px] px-1 py-0.5 bg-orange-600/30 text-orange-400 rounded" title={`最多${model.maxVideos || '?'}视频`}>+视频</span>
                                                                )}
                                                                {model.supportsAudio && (
                                                                    <span className="text-[10px] px-1 py-0.5 bg-white/10 sf-rainbow-text rounded">音频</span>
                                                                )}
                                                            </span>
                                                            {model.desc && <span className={`text-[11px] pl-5 ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{model.desc} · <Timer size={10} className="inline -mt-px" />{model.speed} · {model.costHint}</span>}
                                                        </div>
                                                        {currentVideoModel.id === model.id && <Check size={12} className="shrink-0 mt-0.5" />}
                                                    </button>
                                                ))}
                                            </>
                                        )}

                                        {/* Jimeng 即梦 Models */}
                                        {availableVideoModels.filter(m => m.provider === 'jimeng').length > 0 && (
                                            <>
                                                <div className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider border-t ${isDark ? 'text-neutral-500 bg-[#1f1f1f] border-neutral-700' : 'text-gray-600 bg-gray-50 border-gray-200'}`}>
                                                    即梦 Jimeng
                                                </div>
                                                {availableVideoModels.filter(m => m.provider === 'jimeng').map(model => (
                                                    <button
                                                        key={model.id}
                                                        onClick={() => handleVideoModelChange(model.id)}
                                                        className={`w-full flex items-start justify-between px-3 py-2 text-[13px] text-left ${isDark ? 'hover:bg-[#333]' : 'hover:bg-gray-100'} transition-colors ${currentVideoModel.id === model.id ? 'sf-rainbow-text' : isDark ? 'text-neutral-300' : 'text-gray-700'
                                                            }`}
                                                    >
                                                        <div className="flex flex-col gap-0.5 min-w-0">
                                                            <span className="flex items-center gap-2">
                                                                <JimengIcon size={14} className="shrink-0" />
                                                                {model.name}
                                                                {model.supportsAudio && (
                                                                    <span className="text-[10px] px-1 py-0.5 bg-white/10 sf-rainbow-text rounded">音频</span>
                                                                )}
                                                            </span>
                                                            {model.desc && <span className={`text-[11px] pl-5 ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{model.desc} · <Timer size={10} className="inline -mt-px" />{model.speed} · {model.costHint}</span>}
                                                        </div>
                                                        {currentVideoModel.id === model.id && <Check size={12} className="shrink-0 mt-0.5" />}
                                                    </button>
                                                ))}
                                            </>
                                        )}

                                        {/* Seedance 豆包 Models */}
                                        {availableVideoModels.filter(m => m.provider === 'seedance').length > 0 && (
                                            <>
                                                <div className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider border-t ${isDark ? 'text-neutral-500 bg-[#1f1f1f] border-neutral-700' : 'text-gray-600 bg-gray-50 border-gray-200'}`}>
                                                    <span>豆包 Seedance</span>
                                                    <span className="ml-2 text-[10px] font-normal text-amber-500/80 normal-case tracking-normal"><AlertTriangle size={10} className="inline -mt-px mr-0.5" />不支持真人人脸</span>
                                                </div>
                                                {availableVideoModels.filter(m => m.provider === 'seedance').map(model => (
                                                    <button
                                                        key={model.id}
                                                        onClick={() => handleVideoModelChange(model.id)}
                                                        className={`w-full flex items-start justify-between px-3 py-2 text-[13px] text-left ${isDark ? 'hover:bg-[#333]' : 'hover:bg-gray-100'} transition-colors ${currentVideoModel.id === model.id ? 'sf-rainbow-text' : isDark ? 'text-neutral-300' : 'text-gray-700'
                                                            }`}
                                                    >
                                                        <div className="flex flex-col gap-0.5 min-w-0">
                                                            <span className="flex items-center gap-2">
                                                                <DoubaoIcon size={14} className="shrink-0" />
                                                                {model.name}
                                                                {model.supportsAudio && (
                                                                    <span className="text-[10px] px-1 py-0.5 bg-white/10 sf-rainbow-text rounded">音频</span>
                                                                )}
                                                            </span>
                                                            {model.desc && <span className={`text-[11px] pl-5 ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{model.desc} · <Timer size={10} className="inline -mt-px" />{model.speed} · {model.costHint}</span>}
                                                        </div>
                                                        {currentVideoModel.id === model.id && <Check size={12} className="shrink-0 mt-0.5" />}
                                                    </button>
                                                ))}
                                            </>
                                        )}

                                        {/* OpenAI Sora Models */}
                                        {availableVideoModels.filter(m => m.provider === 'openai').length > 0 && (
                                            <>
                                                <div className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider border-t ${isDark ? 'text-neutral-500 bg-[#1f1f1f] border-neutral-700' : 'text-gray-600 bg-gray-50 border-gray-200'}`}>
                                                    OpenAI Sora
                                                </div>
                                                {availableVideoModels.filter(m => m.provider === 'openai').map(model => (
                                                    <button
                                                        key={model.id}
                                                        onClick={() => handleVideoModelChange(model.id)}
                                                        className={`w-full flex items-start justify-between px-3 py-2 text-[13px] text-left ${isDark ? 'hover:bg-[#333]' : 'hover:bg-gray-100'} transition-colors ${currentVideoModel.id === model.id ? 'sf-rainbow-text' : isDark ? 'text-neutral-300' : 'text-gray-700'
                                                            }`}
                                                    >
                                                        <div className="flex flex-col gap-0.5 min-w-0">
                                                            <span className="flex items-center gap-2 flex-wrap">
                                                                <SoraIcon size={14} className="shrink-0" />
                                                                {model.name}
                                                                {model.supportsReferenceVideo && (
                                                                    <span className="text-[9px] px-1 py-0.5 bg-orange-600/30 text-orange-400 rounded">+视频</span>
                                                                )}
                                                                {model.supportsAudio && (
                                                                    <span className="text-[10px] px-1 py-0.5 bg-white/10 sf-rainbow-text rounded">音频</span>
                                                                )}
                                                            </span>
                                                            {model.desc && <span className={`text-[11px] pl-5 ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{model.desc} · <Timer size={10} className="inline -mt-px" />{model.speed} · {model.costHint}</span>}
                                                        </div>
                                                        {currentVideoModel.id === model.id && <Check size={12} className="shrink-0 mt-0.5" />}
                                                    </button>
                                                ))}
                                            </>
                                        )}
                                        
                                        {/* Hunyuan 混元 Models */}
                                        {availableVideoModels.filter(m => m.provider === 'hunyuan').length > 0 && (
                                            <>
                                                <div className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider border-t ${isDark ? 'text-neutral-500 bg-[#1f1f1f] border-neutral-700' : 'text-gray-600 bg-gray-50 border-gray-200'}`}>
                                                    混元 Hunyuan
                                                </div>
                                                {availableVideoModels.filter(m => m.provider === 'hunyuan').map(model => (
                                                    <button
                                                        key={model.id}
                                                        onClick={() => handleVideoModelChange(model.id)}
                                                        className={`w-full flex items-start justify-between px-3 py-2 text-[13px] text-left ${isDark ? 'hover:bg-[#333]' : 'hover:bg-gray-100'} transition-colors ${currentVideoModel.id === model.id ? 'sf-rainbow-text' : isDark ? 'text-neutral-300' : 'text-gray-700'
                                                            }`}
                                                    >
                                                        <div className="flex flex-col gap-0.5 min-w-0">
                                                            <span className="flex items-center gap-2">
                                                                <HunyuanIcon size={14} className="shrink-0" />
                                                                {model.name}
                                                            </span>
                                                            {model.desc && <span className={`text-[11px] pl-5 ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{model.desc} · <Timer size={10} className="inline -mt-px" />{model.speed} · {model.costHint}</span>}
                                                        </div>
                                                        {currentVideoModel.id === model.id && <Check size={12} className="shrink-0 mt-0.5" />}
                                                    </button>
                                                ))}
                                            </>
                                        )}
                                    </div>,
                                    document.body
                                )}
                            </div>
                        ) : (
                            <div className="relative" ref={modelDropdownRef}>
                                <button
                                    onClick={handleModelDropdownToggle}
                                    className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors ${isDark ? 'sf-rainbow-btn text-white' : 'bg-white hover:bg-gray-50 border border-gray-200 text-gray-700'}`}
                                >
                                    {(() => {
                                        const g = (currentImageModel as any).group || '';
                                        if (g.includes('Google')) return <GoogleIcon size={12} className={isDark ? 'text-white' : 'text-gray-700'} />;
                                        if (g.includes('Kling') || g.includes('可灵')) return <KlingIcon size={14} />;
                                        if (g.includes('Vidu')) return <ViduIcon size={14} />;
                                        if (g.includes('Seedream') || g.includes('豆包')) return <DoubaoIcon size={14} />;
                                        if (g.includes('Jimeng') || g.includes('即梦')) return <JimengIcon size={14} />;
                                        if (g.includes('Hunyuan') || g.includes('混元')) return <HunyuanIcon size={14} />;
                                        if (g.includes('Qwen') || g.includes('千问')) return <QwenIcon size={14} />;
                                        if (g.includes('腾讯') || g.includes('Tencent') || g.includes('Image 2')) return <TencentIcon size={14} />;
                                        return <ImageIcon size={12} className="sf-rainbow-text" />;
                                    })()}
                                    <span className="font-medium">{currentImageModel.name}</span>
                                    <ChevronDown size={12} className="ml-0.5 opacity-50" />
                                </button>

                                {/* Image Model Dropdown Menu - Portal to body */}
                                {showModelDropdown && modelDropdownPosition && createPortal(
                                    <div 
                                        ref={modelDropdownPortalRef}
                                        className={`fixed w-72 ${isDark ? 'bg-[#252525] border border-neutral-700' : 'bg-white border border-gray-200'} rounded-lg shadow-xl overflow-hidden z-[9999] animate-in fade-in zoom-in-95 duration-100 max-h-[520px] overflow-y-auto`}
                                        style={{ top: modelDropdownPosition.top, left: modelDropdownPosition.left }}
                                        onWheel={e => e.stopPropagation()}
                                        onPointerDown={e => e.stopPropagation()}
                                    >
                                        {/* Mode indicator */}
                                        <div className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 sticky top-0 z-10 ${isDark ? 'text-neutral-400 bg-[#1a1a1a] border-b border-neutral-700' : 'text-gray-600 bg-gray-50 border-b border-gray-200'}`}>
                                            <span className={`w-1.5 h-1.5 rounded-full ${imageGenerationMode === 'text-to-image' ? 'bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500' :
                                                imageGenerationMode === 'image-to-image' ? 'bg-green-400' : 'bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500'
                                                }`} />
                                            {imageGenerationMode === 'text-to-image' ? 'Text → Image' :
                                                imageGenerationMode === 'image-to-image' ? `Image → Image` :
                                                    `${inputCount} Images → Image`}
                                        </div>
                                        {/* Dynamic model groups */}
                                        {(() => {
                                            const imgGroupIcon = (group: string) => {
                                                if (group.includes('Google')) return <GoogleIcon size={12} className={`shrink-0 ${isDark ? 'text-white' : 'text-gray-700'}`} />;
                                                if (group.includes('Kling') || group.includes('可灵')) return <KlingIcon size={14} className="shrink-0" />;
                                                if (group.includes('Vidu')) return <ViduIcon size={14} className="shrink-0" />;
                                                if (group.includes('Seedream') || group.includes('豆包')) return <DoubaoIcon size={14} className="shrink-0" />;
                                                if (group.includes('Jimeng') || group.includes('即梦')) return <JimengIcon size={14} className="shrink-0" />;
                                                if (group.includes('Hunyuan') || group.includes('混元')) return <HunyuanIcon size={14} className="shrink-0" />;
                                                if (group.includes('Qwen') || group.includes('千问')) return <QwenIcon size={14} className="shrink-0" />;
                                                if (group.includes('腾讯') || group.includes('Tencent') || group.includes('Image 2')) return <TencentIcon size={14} className="shrink-0" />;
                                                return <ImageIcon size={12} className="shrink-0 sf-rainbow-text" />;
                                            };
                                            const groups: string[] = [];
                                            availableImageModels.forEach(m => {
                                                const g = (m as any).group || m.provider || 'Other';
                                                if (!groups.includes(g)) groups.push(g);
                                            });
                                            return groups.map((groupName, gi) => {
                                                const models = availableImageModels.filter(m => ((m as any).group || m.provider || 'Other') === groupName);
                                                if (models.length === 0) return null;
                                                return (
                                                    <div key={groupName}>
                                                        <div className={`px-3 py-1 text-[11px] font-bold uppercase tracking-wider ${isDark ? `text-neutral-500 bg-[#1f1f1f]${gi > 0 ? ' border-t border-neutral-700' : ''}` : `text-gray-600 bg-gray-50${gi > 0 ? ' border-t border-gray-200' : ''}`}`}>
                                                            {groupName}
                                                        </div>
                                                        {models.map(model => (
                                                            <button
                                                                key={model.id}
                                                                onClick={() => handleImageModelChange(model.id)}
                                                                className={`w-full flex items-start justify-between px-3 py-1.5 text-[13px] text-left ${isDark ? 'hover:bg-[#333]' : 'hover:bg-gray-100'} transition-colors ${currentImageModel.id === model.id ? 'sf-rainbow-text' : isDark ? 'text-neutral-300' : 'text-gray-700'}`}
                                                            >
                                                                <div className="flex flex-col gap-0.5 min-w-0">
                                                                    <span className="flex items-center gap-2 min-w-0">
                                                                        {imgGroupIcon((model as any).group || '')}
                                                                        <span className="truncate">{model.name}</span>
                                                                        {(model as any).label && (
                                                                            <span className="text-[10px] text-neutral-500 shrink-0">{(model as any).label}</span>
                                                                        )}
                                                                        {model.recommended && (
                                                                            <span className="text-[10px] px-1 py-0.5 bg-green-600/30 text-green-400 rounded shrink-0">REC</span>
                                                                        )}
                                                                    </span>
                                                                    {(model as any).desc && <span className={`text-[11px] pl-5 ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>{(model as any).desc} · <Timer size={10} className="inline -mt-px" />{(model as any).speed} · {(model as any).costHint}</span>}
                                                                </div>
                                                                {currentImageModel.id === model.id && <Check size={12} className="shrink-0 ml-1 mt-0.5" />}
                                                            </button>
                                                        ))}
                                                    </div>
                                                );
                                            });
                                        })()}
                                    </div>,
                                    document.body
                                )}
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        {/* Unified Size/Ratio Dropdown (hidden for video nodes in motion-control mode, or image nodes without aspect ratios) */}
                        {!(isVideoNode && videoGenerationMode === 'motion-control') && (isVideoNode || sizeOptions.length > 0) && (
                            <div className="relative" ref={dropdownRef}>
                                <button
                                    onClick={() => setShowSizeDropdown(!showSizeDropdown)}
                                    className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors ${isDark ? 'sf-rainbow-btn text-white' : 'bg-white hover:bg-gray-50 border border-gray-200 text-gray-700'}`}
                                >
                                    {isVideoNode && <Monitor size={12} className="text-green-400" />}
                                    {!isVideoNode && <Crop size={12} className="sf-rainbow-text" />}
                                    {isVideoNode && currentSizeLabel === 'Auto' ? 'Auto' : currentSizeLabel}
                                </button>

                                {/* Dropdown Menu */}
                                {showSizeDropdown && (
                                    <div
                                        className={`absolute bottom-full mb-2 right-0 w-32 ${isDark ? 'bg-[#252525] border border-neutral-700' : 'bg-white border border-gray-200'} rounded-lg shadow-xl overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-100 flex flex-col max-h-60 overflow-y-auto`}
                                        onWheel={(e) => e.stopPropagation()}
                                    >
                                        <div className={`px-3 py-2 text-[10px] font-bold uppercase tracking-wider ${isDark ? 'text-neutral-500 bg-[#1f1f1f]' : 'text-gray-600 bg-gray-50'}`}>
                                            {isVideoNode ? t('nodes.resolution') : t('nodes.aspectRatio')}
                                        </div>
                                        {sizeOptions.map(option => (
                                            <button
                                                key={option}
                                                onClick={() => handleSizeSelect(option)}
                                                className={`flex items-center justify-between px-3 py-2 text-xs text-left ${isDark ? 'hover:bg-[#333]' : 'hover:bg-gray-100'} transition-colors ${currentSizeLabel === option ? 'sf-rainbow-text' : isDark ? 'text-neutral-300' : 'text-gray-700'
                                                    }`}
                                            >
                                                <span>{option}</span>
                                                {currentSizeLabel === option && <Check size={12} />}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Image Resolution Dropdown - Only for Image nodes with resolution support */}
                        {!isVideoNode && (currentImageModel as any).resolutions?.length > 0 && (
                            <div className="relative" ref={resolutionDropdownRef}>
                                <button
                                    onClick={() => setShowResolutionDropdown(!showResolutionDropdown)}
                                    className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors ${isDark ? 'sf-rainbow-btn text-white' : 'bg-white hover:bg-gray-50 border border-gray-200 text-gray-700'}`}
                                >
                                    <Monitor size={12} className="text-green-400" />
                                    {data.resolution || 'Auto'}
                                </button>

                                {/* Dropdown Menu */}
                                {showResolutionDropdown && (
                                    <div
                                        className={`absolute bottom-full mb-2 right-0 w-24 ${isDark ? 'bg-[#252525] border border-neutral-700' : 'bg-white border border-gray-200'} rounded-lg shadow-xl overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-100`}
                                        onWheel={(e) => e.stopPropagation()}
                                    >
                                        <div className={`px-3 py-2 text-[10px] font-bold uppercase tracking-wider ${isDark ? 'text-neutral-500 bg-[#1f1f1f]' : 'text-gray-600 bg-gray-50'}`}>
                                            {t('nodes.quality')}
                                        </div>
                                        {(currentImageModel as any).resolutions.map((res: string) => (
                                            <button
                                                key={res}
                                                onClick={() => handleResolutionSelect(res)}
                                                className={`flex items-center justify-between w-full px-3 py-2 text-xs text-left ${isDark ? 'hover:bg-[#333]' : 'hover:bg-gray-100'} transition-colors ${(data.resolution || 'Auto') === res ? 'sf-rainbow-text' : isDark ? 'text-neutral-300' : 'text-gray-700'}`}
                                            >
                                                <span>{res}</span>
                                                {(data.resolution || 'Auto') === res && <Check size={12} />}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Video Aspect Ratio Dropdown - Only for video nodes (hidden in motion-control mode) */}
                        {isVideoNode && videoGenerationMode !== 'motion-control' && (
                            <div className="relative" ref={aspectRatioDropdownRef}>
                                <button
                                    onClick={() => setShowAspectRatioDropdown(!showAspectRatioDropdown)}
                                    className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors ${isDark ? 'sf-rainbow-btn text-white' : 'bg-white hover:bg-gray-50 border border-gray-200 text-gray-700'}`}
                                >
                                    <Film size={12} className="sf-rainbow-text" />
                                    {data.aspectRatio || '16:9'}
                                </button>

                                {/* Aspect Ratio Dropdown Menu */}
                                {showAspectRatioDropdown && (
                                    <div className={`absolute bottom-full mb-2 right-0 w-28 ${isDark ? 'bg-[#252525] border border-neutral-700' : 'bg-white border border-gray-200'} rounded-lg shadow-xl overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-100`}>
                                        <div className={`px-3 py-2 text-[10px] font-bold uppercase tracking-wider ${isDark ? 'text-neutral-500 bg-[#1f1f1f]' : 'text-gray-600 bg-gray-50'}`}>
                                            {t('nodes.size')}
                                        </div>
                                        {(currentVideoModel?.aspectRatios || VIDEO_ASPECT_RATIOS).map((option: string) => (
                                            <button
                                                key={option}
                                                onClick={() => handleAspectRatioSelect(option)}
                                                className={`w-full flex items-center justify-between px-3 py-2 text-xs text-left ${isDark ? 'hover:bg-[#333]' : 'hover:bg-gray-100'} transition-colors ${data.aspectRatio === option ? 'sf-rainbow-text' : isDark ? 'text-neutral-300' : 'text-gray-700'}`}
                                            >
                                                <span>{option}</span>
                                                {data.aspectRatio === option && <Check size={12} />}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Duration Dropdown - Only for video nodes (hidden in motion-control mode) */}
                        {isVideoNode && videoGenerationMode !== 'motion-control' && availableDurations.length > 0 && (
                            <div className="relative" ref={durationDropdownRef}>
                                <button
                                    onClick={() => setShowDurationDropdown(!showDurationDropdown)}
                                    className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors ${isDark ? 'sf-rainbow-btn text-white' : 'bg-white hover:bg-gray-50 border border-gray-200 text-gray-700'}`}
                                >
                                    <Clock size={12} className="sf-rainbow-text" />
                                    {currentDuration}s
                                </button>

                                {/* Duration Dropdown Menu */}
                                {showDurationDropdown && (
                                    <div className={`absolute bottom-full mb-2 right-0 w-24 ${isDark ? 'bg-[#252525] border border-neutral-700' : 'bg-white border border-gray-200'} rounded-lg shadow-xl overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-100`}>
                                        <div className={`px-3 py-2 text-[10px] font-bold uppercase tracking-wider ${isDark ? 'text-neutral-500 bg-[#1f1f1f]' : 'text-gray-600 bg-gray-50'}`}>
                                            {t('nodes.duration')}
                                        </div>
                                        {availableDurations.map((dur: number) => (
                                            <button
                                                key={dur}
                                                onClick={() => handleDurationChange(dur)}
                                                className={`w-full flex items-center justify-between px-3 py-2 text-xs text-left ${isDark ? 'hover:bg-[#333]' : 'hover:bg-gray-100'} transition-colors ${currentDuration === dur ? 'sf-rainbow-text' : isDark ? 'text-neutral-300' : 'text-gray-700'}`}
                                            >
                                                <span>{dur}s</span>
                                                {currentDuration === dur && <Check size={12} />}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Generate Count Dropdown - For image and video nodes */}
                        {!isLocalModelNode && !isLoading && (
                            <div className="relative" ref={countDropdownRef}>
                                <button
                                    onClick={() => setShowCountDropdown(!showCountDropdown)}
                                    className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors ${isDark ? 'sf-rainbow-btn text-white' : 'bg-white hover:bg-gray-50 border border-gray-200 text-gray-700'}`}
                                >
                                    {isVideoNode
                                        ? <Film size={12} className="sf-rainbow-text" />
                                        : <ImageIcon size={12} className="sf-rainbow-text" />
                                    }
                                    ×{data.generateCount || 1}
                                </button>

                                {showCountDropdown && (
                                    <div className={`absolute bottom-full mb-2 right-0 w-24 ${isDark ? 'bg-[#252525] border border-neutral-700' : 'bg-white border border-gray-200'} rounded-lg shadow-xl overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-100`}>
                                        <div className={`px-3 py-2 text-[10px] font-bold uppercase tracking-wider ${isDark ? 'text-neutral-500 bg-[#1f1f1f]' : 'text-gray-600 bg-gray-50'}`}>
                                            {t('nodes.generateCountLabel')}
                                        </div>
                                        {[1, 3, 5].map(count => (
                                            <button
                                                key={count}
                                                onClick={() => {
                                                    onUpdate(data.id, { generateCount: count });
                                                    setShowCountDropdown(false);
                                                }}
                                                className={`w-full flex items-center justify-between px-3 py-2 text-xs text-left ${isDark ? 'hover:bg-[#333]' : 'hover:bg-gray-100'} transition-colors ${(data.generateCount || 1) === count ? 'sf-rainbow-text' : isDark ? 'text-neutral-300' : 'text-gray-700'}`}
                                            >
                                                <span>×{count}</span>
                                                {(data.generateCount || 1) === count && <Check size={12} />}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Warning icon with tooltip for models with restrictions */}
                        {isVideoNode && currentVideoModel.warning && (
                            <div className="relative group/warn flex items-center">
                                <div className="flex items-center justify-center w-6 h-6 rounded-md bg-amber-500/15 text-amber-400 cursor-help">
                                    <AlertTriangle size={12} />
                                </div>
                                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 px-2.5 py-1.5 rounded-lg bg-neutral-900 border border-neutral-700 text-amber-300 text-[10px] whitespace-nowrap opacity-0 pointer-events-none group-hover/warn:opacity-100 transition-opacity duration-150 shadow-lg z-50">
                                    {currentVideoModel.warning}
                                    <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-neutral-700" />
                                </div>
                            </div>
                        )}

                        {/* Generate Button - Active even after success to allow re-generation */}
                        {!isLoading && (() => {
                            // Check if generation is blocked due to no face detected in Face mode
                            const isFaceModeBlocked = !isVideoNode &&
                                data.imageModel === 'kling-v1-5' &&
                                data.klingReferenceMode === 'face' &&
                                (data.faceDetectionStatus === 'error' || data.faceDetectionStatus === 'loading');

                            return (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (isFaceModeBlocked) {
                                            return;
                                        }
                                        onGenerate(data.id);
                                    }}
                                    disabled={isFaceModeBlocked}
                                    className={`group w-9 h-9 rounded-lg flex items-center justify-center transition-all duration-200 ${isFaceModeBlocked
                                        ? 'bg-[var(--sf-border)]/50 cursor-not-allowed opacity-50'
                                        : isDark
                                            ? 'sf-rainbow-btn active:scale-95'
                                            : 'lt-btn-primary active:scale-95'
                                        }`}
                                    title={isFaceModeBlocked ? t('nodes.cannotGenerate') : t('nodes.generate')}
                                >
                                    <svg
                                        viewBox="0 0 24 24"
                                        className="w-4 h-4 transition-transform duration-200"
                                        fill="currentColor"
                                    >
                                        <polygon points="5 3 19 12 5 21 5 3" />
                                    </svg>
                                </button>
                            );
                        })()}
                    </div>
                </div>
            )}

            {/* Kling V1.5 Reference Settings - For Image nodes with connected input */}
            {!isVideoNode && data.imageModel === 'kling-v1-5' && connectedImageNodes.length > 0 && (
                <div className="mt-3 pt-3 border-t border-neutral-800">
                    <div className="text-[10px] text-neutral-500 uppercase tracking-wider mb-2">{t('nodes.referenceSettings')}</div>

                    {/* Mode Tabs */}
                    <div className="flex gap-1 mb-3 p-1 bg-neutral-800/50 rounded-lg">
                        <button
                            onClick={() => onUpdate(data.id, { klingReferenceMode: 'subject', detectedFaces: undefined, faceDetectionStatus: undefined })}
                            className={`flex-1 px-3 py-1.5 text-xs rounded-md transition-colors ${(data.klingReferenceMode || 'subject') === 'subject'
                                ? 'bg-neutral-700 text-white font-medium'
                                : 'text-neutral-400 hover:text-white hover:bg-neutral-700/50'
                                }`}
                        >
                            {t('nodes.subject')}
                        </button>
                        <button
                            onClick={() => {
                                // Just switch mode, face detection will be triggered by effect
                                onUpdate(data.id, { klingReferenceMode: 'face', faceDetectionStatus: 'loading', detectedFaces: undefined });
                            }}
                            className={`flex-1 px-3 py-1.5 text-xs rounded-md transition-colors ${data.klingReferenceMode === 'face'
                                ? 'bg-neutral-700 text-white font-medium'
                                : 'text-neutral-400 hover:text-white hover:bg-neutral-700/50'
                                }`}
                        >
                            {t('nodes.face')}
                        </button>
                    </div>

                    {/* Reference Image Preview with Face Detection Overlay */}
                    {connectedImageNodes[0]?.url && (
                        <div className="mb-3">
                            {/* Main image with face highlight */}
                            <div className="rounded-lg overflow-hidden bg-black relative flex items-center justify-center" style={{ maxHeight: '200px' }}>
                                <div className="relative">
                                    <img
                                        src={connectedImageNodes[0].url}
                                        alt="Reference"
                                        className="max-h-[200px] w-auto h-auto block object-contain"
                                    />
                                    {/* Face detection corner brackets - Kling style */}
                                    {data.klingReferenceMode === 'face' && data.faceDetectionStatus === 'success' && data.detectedFaces && data.detectedFaces.length > 0 && (
                                        <>
                                            {data.detectedFaces.map((face, idx) => (
                                                <div
                                                    key={idx}
                                                    className="absolute pointer-events-none"
                                                    style={{
                                                        left: `${face.x}%`,
                                                        top: `${face.y}%`,
                                                        width: `${face.width}%`,
                                                        height: `${face.height}%`,
                                                    }}
                                                >
                                                    {/* Corner brackets - larger with glow */}
                                                    <div className="absolute -top-1 -left-1 w-8 h-8 border-t-4 border-l-4 border-green-400 rounded-tl-xl" style={{ filter: 'drop-shadow(0 0 4px rgba(74, 222, 128, 0.8))' }} />
                                                    <div className="absolute -top-1 -right-1 w-8 h-8 border-t-4 border-r-4 border-green-400 rounded-tr-xl" style={{ filter: 'drop-shadow(0 0 4px rgba(74, 222, 128, 0.8))' }} />
                                                    <div className="absolute -bottom-1 -left-1 w-8 h-8 border-b-4 border-l-4 border-green-400 rounded-bl-xl" style={{ filter: 'drop-shadow(0 0 4px rgba(74, 222, 128, 0.8))' }} />
                                                    <div className="absolute -bottom-1 -right-1 w-8 h-8 border-b-4 border-r-4 border-green-400 rounded-br-xl" style={{ filter: 'drop-shadow(0 0 4px rgba(74, 222, 128, 0.8))' }} />
                                                </div>
                                            ))}
                                        </>
                                    )}
                                    {/* Loading indicator */}
                                    {data.klingReferenceMode === 'face' && data.faceDetectionStatus === 'loading' && (
                                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                            <div className="text-xs text-white">{t('nodes.detectingFaces')}</div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Face thumbnail below - Kling style */}
                            {data.klingReferenceMode === 'face' && data.faceDetectionStatus === 'success' && data.detectedFaces && data.detectedFaces.length > 0 && (
                                <div className="flex justify-center mt-3">
                                    <div className="w-14 h-14 rounded-lg border-2 border-green-400 overflow-hidden bg-black">
                                        <img
                                            src={connectedImageNodes[0].url}
                                            alt="Detected face"
                                            className="w-full h-full object-cover"
                                            style={{
                                                objectPosition: `${data.detectedFaces[0].x + data.detectedFaces[0].width / 2}% ${data.detectedFaces[0].y + data.detectedFaces[0].height / 2}%`,
                                                transform: `scale(${100 / Math.max(data.detectedFaces[0].width, data.detectedFaces[0].height) * 0.8})`
                                            }}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* No Face Detected Warning */}
                    {data.klingReferenceMode === 'face' && data.faceDetectionStatus === 'error' && (
                        <div className="mb-3 p-2 bg-amber-900/20 border border-amber-700/50 rounded-lg">
                            <div className="flex items-start gap-2 text-amber-400 text-xs">
                                <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                                <span>{t('nodes.noFaceDetected')}</span>
                            </div>
                        </div>
                    )}

                    {/* Subject Mode: Show BOTH Face Reference and Subject Reference sliders */}
                    {(data.klingReferenceMode || 'subject') === 'subject' && (
                        <>
                            <div className="space-y-1 mb-3">
                                <div className="flex justify-between text-[10px]">
                                    <span className="text-neutral-400">{t('nodes.faceReference')}</span>
                                    <span className="text-white font-medium">{data.klingFaceIntensity ?? 65}</span>
                                </div>
                                <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    value={data.klingFaceIntensity ?? 65}
                                    onChange={(e) => onUpdate(data.id, { klingFaceIntensity: parseInt(e.target.value) })}
                                    className="w-full h-1.5 bg-neutral-700 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-md"
                                />
                            </div>
                            <div className="space-y-1">
                                <div className="flex justify-between text-[10px]">
                                    <span className="text-neutral-400">{t('nodes.subjectReference')}</span>
                                    <span className="text-white font-medium">{data.klingSubjectIntensity ?? 50}</span>
                                </div>
                                <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    value={data.klingSubjectIntensity ?? 50}
                                    onChange={(e) => onUpdate(data.id, { klingSubjectIntensity: parseInt(e.target.value) })}
                                    className="w-full h-1.5 bg-neutral-700 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-md"
                                />
                            </div>
                        </>
                    )}

                    {/* Face Mode: Show single Reference Strength slider */}
                    {data.klingReferenceMode === 'face' && data.faceDetectionStatus === 'success' && (
                        <div className="space-y-1">
                            <div className="flex justify-between text-[10px]">
                                <span className="text-neutral-400">{t('nodes.referenceStrength')}</span>
                                <span className="text-white font-medium">{data.klingFaceIntensity ?? 42}</span>
                            </div>
                            <input
                                type="range"
                                min="0"
                                max="100"
                                value={data.klingFaceIntensity ?? 42}
                                onChange={(e) => onUpdate(data.id, { klingFaceIntensity: parseInt(e.target.value) })}
                                className="w-full h-1.5 bg-neutral-700 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-md"
                            />
                        </div>
                    )}
                </div>
            )}

            {/* Video Extra Settings - Auto-shown when relevant (audio toggle, frame inputs) */}
            {isVideoNode && (connectedImageNodes.length >= 2 || data.videoModel === 'kling-v2-6') && (
                <div className={`mt-2 pt-2 border-t space-y-3 ${isDark ? 'border-neutral-800' : 'border-gray-200'}`}>
                    {/* Audio Toggle - Only for Kling 2.6 */}
                    {data.videoModel === 'kling-v2-6' && (
                        <div className={`inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg w-fit ${isDark ? 'bg-neutral-800/50' : 'bg-gray-100'}`}>
                            <svg className="w-3.5 h-3.5 sf-rainbow-text" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                            </svg>
                            <span className={`text-[11px] ${isDark ? 'text-neutral-300' : 'text-gray-600'}`}>Audio</span>
                            <button
                                onClick={() => onUpdate(data.id, { generateAudio: !(data.generateAudio !== false) })}
                                className={`relative w-8 h-4 rounded-full transition-colors ${data.generateAudio !== false ? 'bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500' : (isDark ? 'bg-neutral-700' : 'bg-gray-300')}`}
                            >
                                <span
                                    className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform shadow-md ${data.generateAudio !== false ? 'left-4' : 'left-0.5'}`}
                                />
                            </button>
                        </div>
                    )}

                    {/* Frame Inputs - Show when 2+ nodes are connected */}
                    {connectedImageNodes.length >= 2 && (
                        <div className="space-y-2">
                            <label className={`text-[10px] uppercase tracking-wider ${isDark ? 'text-neutral-500' : 'text-gray-500'}`}>
                                {videoGenerationMode === 'motion-control' ? t('nodes.inputReferences') : t('nodes.connectedFrames')}
                                {videoGenerationMode !== 'motion-control' && <span className={isDark ? 'text-neutral-600' : 'text-gray-400'}> {t('nodes.dragToReorder')}</span>}
                            </label>

                            {frameInputsWithUrls.length === 0 ? (
                                <div className={`text-xs italic py-2 ${isDark ? 'text-neutral-600' : 'text-gray-400'}`}>
                                    {videoGenerationMode === 'motion-control' ? t('nodes.connectVideoAndImage') : t('nodes.connectImageNodes')}
                                </div>
                            ) : videoGenerationMode === 'motion-control' ? (
                                <div className="flex gap-2">
                                    {frameInputsWithUrls.map((input, index) => (
                                        <div
                                            key={input.nodeId}
                                            className={`flex-1 flex flex-col items-center gap-2 p-2 rounded-lg border ${isDark ? 'bg-neutral-800 border-neutral-700/50' : 'bg-gray-50 border-gray-200'}`}
                                        >
                                            <div className={`relative w-full aspect-video overflow-hidden rounded flex items-center justify-center ${isDark ? 'bg-black' : 'bg-gray-100'}`}>
                                                {input.url ? (
                                                    <img
                                                        src={input.url}
                                                        alt={input.type === NodeType.VIDEO ? t('nodes.motionRef') : t('nodes.characterRef')}
                                                        className="w-full h-full object-contain"
                                                    />
                                                ) : (
                                                    <div className={`text-[10px] ${isDark ? 'text-neutral-600' : 'text-gray-400'}`}>{t('nodes.noPreview')}</div>
                                                )}
                                                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                                                <div className="absolute bottom-1 left-1 right-1">
                                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded block text-center truncate ${input.type === NodeType.VIDEO
                                                        ? 'bg-gradient-to-r from-pink-500/80 via-purple-500/80 to-blue-500/80 text-white'
                                                        : 'bg-gradient-to-r from-pink-500/80 via-purple-500/80 to-blue-500/80 text-white'
                                                        }`}>
                                                        {input.type === NodeType.VIDEO ? t('nodes.motionRef') : t('nodes.characterRef')}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="space-y-2 max-h-[200px] overflow-y-auto" onWheel={(e) => e.stopPropagation()}>
                                    {frameInputsWithUrls.map((input, index) => {
                                        const isStart = input.order === 'start';
                                        const isEnd = input.order === 'end';
                                        return (
                                            <div
                                                key={input.nodeId}
                                                draggable
                                                onDragStart={() => setDraggedIndex(index)}
                                                onDragOver={(e) => e.preventDefault()}
                                                onDrop={() => {
                                                    if (draggedIndex !== null) {
                                                        handleFrameReorder(draggedIndex, index);
                                                        setDraggedIndex(null);
                                                    }
                                                }}
                                                onDragEnd={() => setDraggedIndex(null)}
                                                className={`flex items-center gap-2 p-2 rounded-lg cursor-grab active:cursor-grabbing transition-all ${isDark ? 'bg-neutral-800' : 'bg-gray-100'} ${draggedIndex === index ? 'opacity-50 scale-95' : ''
                                                    }`}
                                            >
                                                <GripVertical size={14} className={isDark ? 'text-neutral-600' : 'text-gray-400'} />
                                                <img
                                                    src={input.url}
                                                    alt={`Frame ${index + 1}`}
                                                    className="w-12 h-12 object-cover rounded"
                                                />
                                                <div className="flex-1">
                                                    <span className={`text-xs font-medium px-2 py-0.5 rounded ${isStart
                                                        ? (isDark ? 'bg-green-600/30 text-green-400' : 'bg-green-100 text-green-700')
                                                        : isEnd
                                                            ? (isDark ? 'bg-orange-600/30 text-orange-400' : 'bg-orange-100 text-orange-700')
                                                            : (isDark ? 'bg-white/10 sf-rainbow-text' : 'bg-gray-200 sf-rainbow-text')
                                                        }`}>
                                                        {isStart ? t('nodes.start') : isEnd ? t('nodes.end') : `${t('nodes.frame')} ${index + 1}`}
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div >
        </HoverBorderGradient>
    );
};

// Memoize to prevent re-renders when parent state changes
export const NodeControls = memo(NodeControlsComponent);
