/**
 * canvas.js
 *
 * Agent skill: Query current canvas state.
 * Reads canvas context provided by the frontend to understand what nodes exist.
 */

export function createCanvasQueryTool(context) {
    return {
        name: 'canvas_query',
        description: 'Get the current state of the canvas including all nodes, their types, statuses, and connections. Use this to understand what the user has on their canvas before suggesting actions.',
        parameters: {
            type: 'object',
            properties: {
                filter: {
                    type: 'string',
                    enum: ['all', 'images', 'videos', 'completed', 'failed', 'loading'],
                    description: 'Filter nodes by type or status. Default: all',
                },
            },
            required: [],
        },
        func: async ({ filter }) => {
            const canvasState = context.canvasState;
            if (!canvasState || !canvasState.nodes || canvasState.nodes.length === 0) {
                return 'The canvas is currently empty. No nodes found.';
            }

            let nodes = canvasState.nodes;

            if (filter === 'images') {
                nodes = nodes.filter(n => n.type === 'Image');
            } else if (filter === 'videos') {
                nodes = nodes.filter(n => n.type === 'Video');
            } else if (filter === 'completed') {
                nodes = nodes.filter(n => n.status === 'success');
            } else if (filter === 'failed') {
                nodes = nodes.filter(n => n.status === 'error');
            } else if (filter === 'loading') {
                nodes = nodes.filter(n => n.status === 'loading');
            }

            if (nodes.length === 0) {
                return `No nodes match filter "${filter}". Canvas has ${canvasState.nodes.length} total nodes.`;
            }

            const summary = nodes.map(n => {
                const status = n.status || 'idle';
                const prompt = (n.prompt || '').substring(0, 60);
                const model = n.model || n.imageModel || n.videoModel || '';
                let resultInfo = '';
                if (n.resultUrl) {
                    resultInfo = n.resultUrl.startsWith('data:')
                        ? ' [has image data]'
                        : ` url:${n.resultUrl}`;
                }
                return `- [${n.type}] id:${n.id} "${n.title || ''}" (${status}) model:${model}${resultInfo} prompt:"${prompt}..."`;
            }).join('\n');

            const groups = canvasState.groups || [];
            const groupInfo = groups.length > 0
                ? `\n\nGroups: ${groups.map(g => `"${g.label}" (${g.nodeIds?.length || 0} nodes)`).join(', ')}`
                : '';

            return `Canvas has ${nodes.length} nodes${filter && filter !== 'all' ? ` (filter: ${filter})` : ''}:\n${summary}${groupInfo}`;
        },
    };
}
