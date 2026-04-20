import type { Pose, PoseId } from '../types/faceScan';

export const POSES: Pose[] = [
  { id: 'center', label: 'Center', instruction: 'Look straight ahead' },
  { id: 'left',   label: 'Left',   instruction: 'Turn your head to the left' },
  { id: 'right',  label: 'Right',  instruction: 'Turn your head to the right' },
  { id: 'up',     label: 'Up',     instruction: 'Tilt your head slightly up' },
  { id: 'down',   label: 'Down',   instruction: 'Tilt your head slightly down' },
];

export const FRAME_COLORS: Record<PoseId, string> = {
  center: '#4F46E5',
  left:   '#7C3AED',
  right:  '#6D28D9',
  up:     '#5B21B6',
  down:   '#4C1D95',
};

export const STABILIZATION_MS = 600;
export const CAPTURE_FLASH_MS  = 750;

export const C = {
  bg:            '#070A12',
  surface:       '#0F1322',
  surfaceHigh:   '#161B2E',
  border:        'rgba(255,255,255,0.07)',
  primary:       '#6366F1',
  primaryGlow:   'rgba(99,102,241,0.18)',
  success:       '#22C55E',
  successGlow:   'rgba(34,197,94,0.18)',
  captured:      '#4ADE80',
  warning:       '#F59E0B',
  danger:        '#EF4444',
  textPrimary:   '#FFFFFF',
  textSecondary: '#9CA3AF',
  textMuted:     '#4B5563',
  ovalIdle:      'rgba(255,255,255,0.20)',
  ovalDetecting: '#6366F1',
  ovalStable:    '#22C55E',
  ovalCaptured:  '#4ADE80',
};
