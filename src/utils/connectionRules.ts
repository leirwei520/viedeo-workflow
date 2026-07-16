import { NodeType } from '../types';

/**
 * Pure type-level connection validation.
 * Returns true if a node of `parentType` can be a parent of a node of `childType`.
 */
export const isValidConnectionByType = (parentType: NodeType, childType: NodeType): boolean => {
    if (parentType === NodeType.AUDIO || childType === NodeType.AUDIO) return false;
    if (childType === NodeType.TEXT) return false;

    if (parentType === NodeType.TEXT) {
        return childType === NodeType.IMAGE || childType === NodeType.VIDEO;
    }
    if (parentType === NodeType.VIDEO) {
        return childType === NodeType.VIDEO || childType === NodeType.VIDEO_EDITOR;
    }
    if (parentType === NodeType.IMAGE) {
        return childType === NodeType.IMAGE || childType === NodeType.VIDEO || childType === NodeType.IMAGE_EDITOR;
    }
    if (parentType === NodeType.IMAGE_EDITOR) {
        return childType === NodeType.IMAGE || childType === NodeType.VIDEO || childType === NodeType.IMAGE_EDITOR;
    }
    if (parentType === NodeType.VIDEO_EDITOR) {
        return childType === NodeType.VIDEO;
    }
    return true;
};

/**
 * Returns all NodeType values that can serve as a parent for the given child type.
 */
export const getConnectableParentTypes = (childType: NodeType): NodeType[] => {
    return Object.values(NodeType).filter(pt => isValidConnectionByType(pt, childType));
};
