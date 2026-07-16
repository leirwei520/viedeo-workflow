/**
 * videoGeneration.js
 *
 * Agent skill: Plan batch video generation from completed image nodes.
 * Returns canvas actions for the frontend to create video nodes and trigger generation.
 */

const AVAILABLE_MODELS = [
    { id: 'Kling/3.0', name: '可灵 3.0', cost: '¥6.0/5s', durations: '3-15s', note: '旗舰版，画质最优 ⭐推荐' },
    { id: 'Kling/2.5', name: '可灵 2.5 Turbo', cost: '¥4.8/5s', durations: '5/10s', note: '极速生成，性价比高' },
    { id: 'Kling/2.6-audio', name: '可灵 2.6 音画同出', cost: '¥6.3/5s', durations: '5/10s', note: '视频+音效同步' },
    { id: 'Hailuo/2.3', name: '海螺 2.3', cost: '¥4.0/5s', durations: '6/10s', note: '画质增强，细节丰富' },
    { id: 'Hailuo/2.3-fast', name: '海螺 2.3 Fast', cost: '¥3.3/5s', durations: '6/10s', note: '快速出片，适合批量' },
    { id: 'Seedance/2.0', name: '豆包 2.0', cost: '¥5.0/5s', durations: '5-15s', note: '动漫/插画风格 ⚠️不支持真人' },
    { id: 'Vidu/q2', name: '生数 Q2', cost: '¥3.5/5s', durations: '1-10s', note: '均衡型，支持多图' },
    { id: 'Vidu/q3', name: '生数 Q3', cost: '¥4.8/5s', durations: '3-10s', note: '新一代，支持音频' },
    { id: 'GV/3.1', name: 'Google Veo 3.1', cost: '¥6.0/4s', durations: '4/8/12s', note: '顶级画质，音画同出' },
    { id: 'Jimeng/3.0pro', name: '即梦 3.0 Pro', cost: '¥4.8/5s', durations: '5/10s', note: '音画同出，宽屏比丰富' },
    { id: 'OS/2.0', name: 'Sora 2.0', cost: '¥7.5/5s', durations: '4/8/12s', note: 'OpenAI出品' },
    { id: 'Hunyuan/1.5', name: '混元 1.5', cost: '¥4.0/5s', durations: '5s', note: '性价比高' },
];

const MODEL_LIST_TEXT = AVAILABLE_MODELS.map(
    (m, i) => `${i + 1}. ${m.name} (${m.id}) — ${m.cost}, ${m.durations}, ${m.note}`
).join('\n');

export function createVideoGenerationTool(context) {
    return {
        name: 'video_generate_batch',
        description: `Create videos from existing image nodes on the canvas. Each video uses its source image as the first frame (image-to-video mode).

Available models:
${MODEL_LIST_TEXT}

IMPORTANT: Before calling this tool, you MUST ask the user which model and duration they prefer. Present the model list and let them choose. Only call this tool after the user has made a selection.`,
        parameters: {
            type: 'object',
            properties: {
                sourceNodeIds: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Array of image node IDs to generate videos from. If empty, uses all completed image nodes on canvas.',
                },
                model: {
                    type: 'string',
                    description: `Video model ID. Must be one of: ${AVAILABLE_MODELS.map(m => m.id).join(', ')}`,
                },
                duration: {
                    type: 'number',
                    description: 'Video duration in seconds. Must be within the selected model\'s supported range.',
                },
                prompt: {
                    type: 'string',
                    description: 'Optional prompt override for all videos. If not set, inherits from source image prompt.',
                },
            },
            required: ['model', 'duration'],
        },
        func: async ({ sourceNodeIds, model, duration, prompt }) => {
            const validModel = AVAILABLE_MODELS.find(m => m.id === model);
            if (!validModel) {
                return `无效的模型 "${model}"。请从以下模型中选择：\n${MODEL_LIST_TEXT}`;
            }

            context.addAction({
                type: 'create_and_generate_videos',
                data: {
                    sourceNodeIds: sourceNodeIds || [],
                    model: model,
                    duration: duration || 5,
                    promptOverride: prompt || null,
                },
            });

            const nodeDesc = sourceNodeIds?.length
                ? `${sourceNodeIds.length} 个图片节点`
                : '画布上所有已完成的图片';

            return `视频生成已启动：${nodeDesc}，模型: ${validModel.name}，时长: ${duration}s。视频节点已创建并开始自动生成。`;
        },
    };
}
