/**
 * imageGeneration.js
 *
 * Agent skill: Plan batch image generation.
 * Returns canvas actions for the frontend to create image nodes and trigger generation.
 */

export function createImageGenerationTool(context) {
    return {
        name: 'image_generate_batch',
        description: 'Create and generate multiple images on the canvas as a grouped storyboard. Use this after generating storyboard scripts to create images for each scene, or when the user wants to generate multiple images. The images will be created as nodes on the canvas and generation will start automatically.',
        parameters: {
            type: 'object',
            properties: {
                images: {
                    type: 'array',
                    description: 'Array of images to generate',
                    items: {
                        type: 'object',
                        properties: {
                            prompt: { type: 'string', description: 'Detailed image generation prompt' },
                            model: { type: 'string', description: 'Image model (e.g., "gem-3.0", "gem-3.1", "kling-img-3.0", "chuhaibang"). Default: "gem-3.0"' },
                            aspectRatio: { type: 'string', description: 'Aspect ratio (e.g., "16:9", "1:1", "9:16"). Default: "16:9"' },
                        },
                        required: ['prompt'],
                    },
                },
                groupLabel: { type: 'string', description: 'Optional label for the node group (e.g., "太空冒险 分镜"). If provided, nodes will be grouped together.' },
            },
            required: ['images'],
        },
        func: async ({ images, groupLabel }) => {
            if (!Array.isArray(images) || images.length === 0) {
                return 'No images specified. Please provide at least one image with a prompt.';
            }

            if (images.length > 20) {
                return 'Too many images. Maximum is 20 images per batch.';
            }

            const imageNodes = images.map((img, i) => ({
                prompt: img.prompt,
                model: img.model || 'gem-3.0',
                aspectRatio: img.aspectRatio || '16:9',
                title: `Scene ${i + 1}`,
            }));

            context.addAction({
                type: 'create_and_generate_images',
                data: { images: imageNodes, groupLabel: groupLabel || undefined },
            });

            return `Queued ${imageNodes.length} images for generation. They will appear on the canvas and generation will start automatically. Models: ${[...new Set(imageNodes.map(n => n.model))].join(', ')}`;
        },
    };
}
