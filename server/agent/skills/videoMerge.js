/**
 * videoMerge.js
 *
 * Agent skill: Merge multiple video nodes into one final video.
 * Returns a canvas action for the frontend to execute the merge.
 */

export function createVideoMergeTool(context) {
    return {
        name: 'video_merge',
        description: 'Merge multiple completed video nodes into a single video. Use this after video generation is complete to combine all clips into a final output. Supports transitions between clips.',
        parameters: {
            type: 'object',
            properties: {
                sourceNodeIds: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Array of video node IDs to merge in order. If empty, merges all completed video nodes.',
                },
                transition: {
                    type: 'string',
                    enum: ['none', 'fade', 'dissolve', 'wipeleft', 'wiperight', 'slideright', 'slideleft'],
                    description: 'Transition effect between clips. Default: "fade"',
                },
                transitionDuration: {
                    type: 'number',
                    description: 'Duration of transition in seconds (0.3-2.0). Default: 0.5',
                },
            },
            required: [],
        },
        func: async ({ sourceNodeIds, transition, transitionDuration }) => {
            context.addAction({
                type: 'merge_videos',
                data: {
                    sourceNodeIds: sourceNodeIds || [],
                    transition: transition || 'fade',
                    transitionDuration: transitionDuration || 0.5,
                },
            });

            const nodeDesc = sourceNodeIds?.length
                ? `${sourceNodeIds.length} specified video nodes`
                : 'all completed video nodes';

            return `Video merge planned for ${nodeDesc} with "${transition || 'fade'}" transition. The merge will execute and produce a final combined video.`;
        },
    };
}
