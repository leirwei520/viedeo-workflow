/**
 * subtitleRemoverService.ts
 * Client for local video-subtitle-remover integration.
 */

import { API_URL, authFetch } from '../config/api';

export type InpaintMode = 'sttn-auto' | 'sttn-det' | 'lama' | 'propainter' | 'opencv';

export interface SubtitleRemoverStartOptions {
  inpaintMode?: InpaintMode;
  /** Format: "ymin,ymax,xmin,xmax" or multiple areas separated by ";" */
  subtitleArea?: string;
}

export interface SubtitleRemoverJobStatus {
  jobId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  error?: string | null;
  videoUrl?: string;
  filename?: string;
  duration?: number;
  size?: number;
}

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_MS = 60 * 60 * 1000;

export async function checkSubtitleRemoverHealth(): Promise<{ available: boolean; vsrInstalled?: boolean }> {
  try {
    const resp = await authFetch(`${API_URL}/subtitle-remover/health`);
    const data = await resp.json();
    return { available: resp.ok && data.status === 'ok', vsrInstalled: data.vsr_installed };
  } catch {
    return { available: false };
  }
}

export async function startSubtitleRemoval(
  file: File,
  options: SubtitleRemoverStartOptions = {}
): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('inpaintMode', options.inpaintMode || 'sttn-det');
  if (options.subtitleArea?.trim()) {
    formData.append('subtitleArea', options.subtitleArea.trim());
  }

  const resp = await authFetch(`${API_URL}/subtitle-remover/start`, {
    method: 'POST',
    body: formData,
  });

  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data.error || 'Failed to start subtitle removal');
  }
  return data.jobId as string;
}

export async function getSubtitleRemovalStatus(jobId: string): Promise<SubtitleRemoverJobStatus> {
  const resp = await authFetch(`${API_URL}/subtitle-remover/status/${jobId}`);
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data.error || 'Failed to get job status');
  }
  return data as SubtitleRemoverJobStatus;
}

export async function waitForSubtitleRemoval(
  jobId: string,
  onProgress?: (progress: number, status: string) => void
): Promise<SubtitleRemoverJobStatus> {
  const start = Date.now();

  while (Date.now() - start < MAX_POLL_MS) {
    const status = await getSubtitleRemovalStatus(jobId);
    onProgress?.(status.progress, status.status);

    if (status.status === 'completed') {
      if (!status.videoUrl) throw new Error('Processing completed but no video URL returned');
      return status;
    }
    if (status.status === 'failed') {
      throw new Error(status.error || 'Subtitle removal failed');
    }

    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error('Subtitle removal timed out');
}
