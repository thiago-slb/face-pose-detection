/**
 * useFaceScanFlow
 *
 * Orchestrates the 5-pose guided face scan.
 *
 * State machine per pose (native-driven):
 *   idle ──► detecting ──► stabilizing ──► captured ──► [next pose or success]
 *
 * The stabilization window and best-frame selection are handled entirely in
 * native code (FaceCapturePipeline). This hook reacts to:
 *   - guidance.stabilizationProgress  → drives the progress bar animation
 *   - captureResult                   → native has selected the best frame;
 *                                        store the URI and advance to next pose
 *
 * Flow control uses a single useReducer instead of scattered mutable refs.
 * The grace period for stabilization drop is enforced with a one-shot
 * setTimeout rather than a polling interval.
 */
import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from 'react';
import { Animated } from 'react-native';
import type { CameraRef } from 'react-native-vision-camera';

import { useFaceDetection, type UseFaceDetectionOptions } from './useFaceDetection';
import { POSES, CAPTURE_FLASH_MS } from '../constants/faceScanConfig';
import type { FaceScanState, CapturedFrame } from '../types/faceScan';

const STABILIZATION_DROP_GRACE_MS = 350;
const NATIVE_DEBUG_THRESHOLDS = {
  maxYawDeviation: 20,
  maxPitchDeviation: 12,
  minYawForSidePose: 22,
  minPitchForVerticalPose: 16,
  minCenteredness: 0.40,
  maxAlignmentOffsetX: 0.13,
  maxAlignmentOffsetY: 0.15,
  readinessMinSize: 0.15,
  readinessMaxSize: 0.80,
  minBrightness: 0.20,
  maxBrightness: 0.88,
  minSharpness: 0.12,
} as const;
const TARGET_POSE_ANGLES: Record<string, { yaw: number; pitch: number }> = {
  center: { yaw: 0, pitch: 0 },
  left: { yaw: -30, pitch: 0 },
  right: { yaw: 30, pitch: 0 },
  up: { yaw: 0, pitch: 20 },
  down: { yaw: 0, pitch: -20 },
};

const BLANK_FRAMES: (CapturedFrame | null)[] = Array(POSES.length).fill(null);

// ─── State machine ─────────────────────────────────────────────────────────────

type ScanPhase = 'detecting' | 'stabilizing' | 'captured';

interface MachineState {
  running: boolean;
  done: boolean;
  poseIndex: number;
  phase: ScanPhase;
  frames: (CapturedFrame | null)[];
}

type MachineAction =
  | { type: 'start' }
  | { type: 'retake' }
  | { type: 'progress_active' }
  | { type: 'grace_expired' }
  | { type: 'capture_ok'; frame: CapturedFrame; poseIndex: number }
  | { type: 'capture_bad' }
  | { type: 'advance' };

const MACHINE_INIT: MachineState = {
  running: false,
  done: false,
  poseIndex: 0,
  phase: 'detecting',
  frames: [...BLANK_FRAMES],
};

function scanReducer(state: MachineState, action: MachineAction): MachineState {
  switch (action.type) {
    case 'start':
    case 'retake':
      return { running: true, done: false, poseIndex: 0, phase: 'detecting', frames: [...BLANK_FRAMES] };

    case 'progress_active':
      if (!state.running || state.phase !== 'detecting') return state;
      return { ...state, phase: 'stabilizing' };

    case 'grace_expired':
      if (!state.running || state.phase !== 'stabilizing') return state;
      return { ...state, phase: 'detecting' };

    case 'capture_ok': {
      if (!state.running || state.phase === 'captured' || action.poseIndex !== state.poseIndex) return state;
      const frames = state.frames.map((f, i) => (i === action.poseIndex ? action.frame : f));
      return { ...state, phase: 'captured', frames };
    }

    case 'capture_bad':
      if (!state.running || state.phase === 'captured') return state;
      return { ...state, phase: 'detecting' };

    case 'advance': {
      if (!state.running) return state;
      const next = state.poseIndex + 1;
      if (next < POSES.length) return { ...state, poseIndex: next, phase: 'detecting' };
      return { ...state, running: false, done: true };
    }

    default:
      return state;
  }
}

// ─── Public interface ──────────────────────────────────────────────────────────

export interface UseFaceScanFlowResult {
  state: FaceScanState;
  debugReadout: ReturnType<typeof useFaceDetection>['debugReadout'] & {
    targetPose: string;
    acceptedCapturePoseId: string | null;
    acceptedCaptureAtMs: number | null;
    completedPoseIds: string[];
    poseStatus: FaceScanState['poseStatus'];
    stabilizingForMs: number | null;
    msSinceLastProgress: number | null;
    lastCaptureEvent: {
      poseId: string | null;
      hasUri: boolean | null;
      atMs: number | null;
      outcome: 'none' | 'missing_uri' | 'pose_mismatch' | 'stale_previous_pose' | 'duplicate_for_current_pose' | 'accepted';
    };
    validation: {
      poseMatch: boolean;
      faceDetected: boolean;
      distanceGood: boolean;
      alignmentCentered: boolean;
      qualityGood: boolean;
      yawWithinWindow: boolean;
      pitchWithinWindow: boolean;
      directionalReady: boolean;
      centerednessReady: boolean;
      alignmentXReady: boolean;
      alignmentYReady: boolean;
      faceSizeReady: boolean;
      brightnessReady: boolean;
      sharpnessReady: boolean;
      centerednessScore: number | null;
      guidanceReady: boolean;
    };
  };
  /** Animated.Value [0, 1] driven by native stabilization progress. */
  stabilizationAnim: Animated.Value;
  cameraRef: React.RefObject<CameraRef | null>;
  frameOutput: ReturnType<typeof useFaceDetection>['frameOutput'];
  startScan: () => void;
  retakeScan: () => void;
  isNativeLinked: boolean;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useFaceScanFlow(detectionOpts?: UseFaceDetectionOptions): UseFaceScanFlowResult {
  const [machine, dispatch] = useReducer(scanReducer, MACHINE_INIT);
  const stabilizationAnim = useRef(new Animated.Value(0)).current;
  const cameraRef = useRef<CameraRef | null>(null);

  // Guidance-derived status fields — updated at frame rate, kept separate from
  // flow state so frequent guidance ticks don't touch the flow reducer.
  const [guidanceStatus, setGuidanceStatus] = useState<{
    distanceStatus: FaceScanState['distanceStatus'];
    alignmentStatus: FaceScanState['alignmentStatus'];
    qualityStatus: FaceScanState['qualityStatus'];
  }>({ distanceStatus: 'good', alignmentStatus: 'noFace', qualityStatus: 'good' });

  const [acceptedCaptureMeta, setAcceptedCaptureMeta] = useState<{
    poseId: string | null;
    atMs: number | null;
  }>({ poseId: null, atMs: null });
  const [lastCaptureEvent, setLastCaptureEvent] = useState<{
    poseId: string | null;
    hasUri: boolean | null;
    atMs: number | null;
    outcome: 'none' | 'missing_uri' | 'pose_mismatch' | 'stale_previous_pose' | 'duplicate_for_current_pose' | 'accepted';
  }>({ poseId: null, hasUri: null, atMs: null, outcome: 'none' });

  // One-shot timer that fires after STABILIZATION_DROP_GRACE_MS of zero progress,
  // replacing the 200ms polling interval that caught the same stuck-stabilizing case.
  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stabilizingSinceRef = useRef<number | null>(null);
  const lastProgressAtRef = useRef<number>(0);

  const targetPose = POSES[machine.poseIndex]?.id ?? 'center';

  const {
    guidance,
    debugReadout,
    captureResult,
    clearCaptureResult,
    frameOutput,
    isNativeLinked,
  } = useFaceDetection({ ...detectionOpts, targetPose });

  // ── Clear grace timer when phase leaves stabilizing ───────────────────────
  useEffect(() => {
    if (machine.phase !== 'stabilizing' && graceTimerRef.current !== null) {
      clearTimeout(graceTimerRef.current);
      graceTimerRef.current = null;
    }
  }, [machine.phase]);

  // ── Drive stabilization progress bar + phase transitions ──────────────────
  useEffect(() => {
    if (!machine.running) return;
    const rawProgress =
      typeof guidance.stabilizationProgress === 'number' ? guidance.stabilizationProgress : 0;
    const poseMatches = guidance.detectedPose === targetPose;
    const guidanceReady =
      guidance.faceDetected &&
      guidance.distanceStatus === 'good' &&
      guidance.alignmentStatus === 'centered' &&
      guidance.qualityStatus === 'good';
    const progress = poseMatches && guidanceReady ? rawProgress : 0;
    const now = Date.now();

    stabilizationAnim.setValue(progress);

    if (progress > 0) {
      lastProgressAtRef.current = now;
      if (graceTimerRef.current !== null) {
        clearTimeout(graceTimerRef.current);
        graceTimerRef.current = null;
      }
      if (machine.phase === 'detecting') {
        stabilizingSinceRef.current = now;
        dispatch({ type: 'progress_active' });
      }
    } else if (machine.phase === 'stabilizing' && graceTimerRef.current === null) {
      graceTimerRef.current = setTimeout(() => {
        graceTimerRef.current = null;
        stabilizingSinceRef.current = null;
        stabilizationAnim.setValue(0);
        dispatch({ type: 'grace_expired' });
      }, STABILIZATION_DROP_GRACE_MS);
    }
  }, [
    guidance.stabilizationProgress,
    guidance.detectedPose,
    guidance.faceDetected,
    guidance.distanceStatus,
    guidance.alignmentStatus,
    guidance.qualityStatus,
    targetPose,
    machine.running,
    machine.phase,
    stabilizationAnim,
  ]);

  // ── Mirror guidance status fields into scan state ─────────────────────────
  useEffect(() => {
    if (!machine.running) return;
    setGuidanceStatus({
      distanceStatus:  guidance.distanceStatus,
      alignmentStatus: guidance.alignmentStatus,
      qualityStatus:   guidance.qualityStatus,
    });
  }, [guidance.distanceStatus, guidance.alignmentStatus, guidance.qualityStatus, machine.running]);

  // ── React to native capture events ────────────────────────────────────────
  useEffect(() => {
    if (!captureResult || !machine.running) return;

    if (!captureResult.uri) {
      setLastCaptureEvent({ poseId: captureResult.poseId ?? null, hasUri: false, atMs: Date.now(), outcome: 'missing_uri' });
      clearCaptureResult();
      if (machine.phase !== 'captured') {
        stabilizingSinceRef.current = null;
        lastProgressAtRef.current = 0;
        stabilizationAnim.setValue(0);
        dispatch({ type: 'capture_bad' });
      }
      return;
    }

    const pose = POSES[machine.poseIndex];
    const completedPoseIds = new Set(
      machine.frames.filter((f): f is CapturedFrame => f != null).map(f => f.poseId),
    );

    if (completedPoseIds.has(captureResult.poseId as CapturedFrame['poseId'])) {
      setLastCaptureEvent({ poseId: captureResult.poseId ?? null, hasUri: true, atMs: Date.now(), outcome: 'stale_previous_pose' });
      clearCaptureResult();
      return;
    }
    if (machine.phase === 'captured' && captureResult.poseId === pose.id) {
      setLastCaptureEvent({ poseId: captureResult.poseId ?? null, hasUri: true, atMs: Date.now(), outcome: 'duplicate_for_current_pose' });
      clearCaptureResult();
      return;
    }
    if (captureResult.poseId !== pose.id) {
      setLastCaptureEvent({ poseId: captureResult.poseId ?? null, hasUri: true, atMs: Date.now(), outcome: 'pose_mismatch' });
      clearCaptureResult();
      return;
    }

    const frame: CapturedFrame = { poseId: pose.id, uri: captureResult.uri };
    clearCaptureResult();
    dispatch({ type: 'capture_ok', frame, poseIndex: machine.poseIndex });
    setAcceptedCaptureMeta({ poseId: pose.id, atMs: Date.now() });
    setLastCaptureEvent({ poseId: pose.id, hasUri: true, atMs: Date.now(), outcome: 'accepted' });
    stabilizationAnim.setValue(0);

    setTimeout(() => {
      dispatch({ type: 'advance' });
    }, CAPTURE_FLASH_MS);
  }, [captureResult, clearCaptureResult, machine.running, machine.poseIndex, machine.phase, machine.frames, stabilizationAnim]);

  // ── startScan / retakeScan ────────────────────────────────────────────────
  const resetAux = useCallback(() => {
    stabilizationAnim.setValue(0);
    if (graceTimerRef.current !== null) {
      clearTimeout(graceTimerRef.current);
      graceTimerRef.current = null;
    }
    stabilizingSinceRef.current = null;
    lastProgressAtRef.current = 0;
    setAcceptedCaptureMeta({ poseId: null, atMs: null });
    setLastCaptureEvent({ poseId: null, hasUri: null, atMs: null, outcome: 'none' });
    setGuidanceStatus({ distanceStatus: 'good', alignmentStatus: 'noFace', qualityStatus: 'good' });
  }, [stabilizationAnim]);

  const startScan = useCallback(() => {
    resetAux();
    dispatch({ type: 'start' });
  }, [resetAux]);

  const retakeScan = useCallback(() => {
    resetAux();
    dispatch({ type: 'retake' });
  }, [resetAux]);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (graceTimerRef.current !== null) clearTimeout(graceTimerRef.current);
    };
  }, []);

  // ── Derive FaceScanState ──────────────────────────────────────────────────
  const screen: FaceScanState['screen'] = machine.done ? 'success' : machine.running ? 'scanning' : 'intro';
  const poseStatus: FaceScanState['poseStatus'] = machine.running ? machine.phase : 'idle';

  const state: FaceScanState = {
    screen,
    currentPoseIndex: machine.poseIndex,
    poseStatus,
    ...guidanceStatus,
    capturedFrames: machine.frames,
  };

  return {
    state,
    debugReadout: {
      ...debugReadout,
      targetPose,
      acceptedCapturePoseId: acceptedCaptureMeta.poseId,
      acceptedCaptureAtMs: acceptedCaptureMeta.atMs,
      completedPoseIds: machine.frames
        .filter((f): f is CapturedFrame => f != null)
        .map(f => f.poseId),
      poseStatus,
      stabilizingForMs:
        poseStatus === 'stabilizing' && stabilizingSinceRef.current != null
          ? Date.now() - stabilizingSinceRef.current
          : null,
      msSinceLastProgress:
        poseStatus === 'stabilizing' && lastProgressAtRef.current > 0
          ? Date.now() - lastProgressAtRef.current
          : null,
      lastCaptureEvent,
      validation: {
        poseMatch: guidance.detectedPose === targetPose,
        faceDetected: guidance.faceDetected,
        distanceGood: guidance.distanceStatus === 'good',
        alignmentCentered: guidance.alignmentStatus === 'centered',
        qualityGood: guidance.qualityStatus === 'good',
        yawWithinWindow: (() => {
          const yaw = debugReadout.yaw;
          const target = TARGET_POSE_ANGLES[targetPose] ?? TARGET_POSE_ANGLES.center;
          if (yaw == null) return false;
          return Math.abs(yaw - target.yaw) <= NATIVE_DEBUG_THRESHOLDS.maxYawDeviation;
        })(),
        pitchWithinWindow: (() => {
          const pitch = debugReadout.pitch;
          const target = TARGET_POSE_ANGLES[targetPose] ?? TARGET_POSE_ANGLES.center;
          if (pitch == null) return false;
          return Math.abs(pitch - target.pitch) <= NATIVE_DEBUG_THRESHOLDS.maxPitchDeviation;
        })(),
        directionalReady: (() => {
          const yaw = debugReadout.yaw;
          const pitch = debugReadout.pitch;
          if (yaw == null || pitch == null) return false;
          if (targetPose === 'left') return yaw <= -NATIVE_DEBUG_THRESHOLDS.minYawForSidePose;
          if (targetPose === 'right') return yaw >= NATIVE_DEBUG_THRESHOLDS.minYawForSidePose;
          if (targetPose === 'up') return pitch >= NATIVE_DEBUG_THRESHOLDS.minPitchForVerticalPose;
          if (targetPose === 'down') return pitch <= -NATIVE_DEBUG_THRESHOLDS.minPitchForVerticalPose;
          return (
            Math.abs(yaw) <= NATIVE_DEBUG_THRESHOLDS.maxYawDeviation &&
            Math.abs(pitch) <= NATIVE_DEBUG_THRESHOLDS.maxPitchDeviation
          );
        })(),
        centerednessReady: (() => {
          const cx = debugReadout.cx;
          const cy = debugReadout.cy;
          if (cx == null || cy == null) return false;
          const dist = Math.hypot(cx - 0.5, cy - 0.5);
          const centeredness = Math.max(0, 1 - dist * 3);
          return centeredness >= NATIVE_DEBUG_THRESHOLDS.minCenteredness;
        })(),
        alignmentXReady: (() => {
          const cx = debugReadout.cx;
          if (cx == null) return false;
          return Math.abs(cx - 0.5) <= NATIVE_DEBUG_THRESHOLDS.maxAlignmentOffsetX;
        })(),
        alignmentYReady: (() => {
          const cy = debugReadout.cy;
          if (cy == null) return false;
          return Math.abs(cy - 0.5) <= NATIVE_DEBUG_THRESHOLDS.maxAlignmentOffsetY;
        })(),
        faceSizeReady: (() => {
          const ratio = debugReadout.faceSizeRatio;
          if (ratio == null) return false;
          return (
            ratio >= NATIVE_DEBUG_THRESHOLDS.readinessMinSize &&
            ratio <= NATIVE_DEBUG_THRESHOLDS.readinessMaxSize
          );
        })(),
        brightnessReady: (() => {
          const value = debugReadout.brightness;
          if (value == null) return false;
          return (
            value >= NATIVE_DEBUG_THRESHOLDS.minBrightness &&
            value <= NATIVE_DEBUG_THRESHOLDS.maxBrightness
          );
        })(),
        sharpnessReady: (() => {
          const value = debugReadout.sharpness;
          if (value == null) return false;
          return value >= NATIVE_DEBUG_THRESHOLDS.minSharpness;
        })(),
        centerednessScore: (() => {
          const cx = debugReadout.cx;
          const cy = debugReadout.cy;
          if (cx == null || cy == null) return null;
          const dist = Math.hypot(cx - 0.5, cy - 0.5);
          return Math.max(0, 1 - dist * 3);
        })(),
        guidanceReady:
          guidance.faceDetected &&
          guidance.distanceStatus === 'good' &&
          guidance.alignmentStatus === 'centered' &&
          guidance.qualityStatus === 'good',
      },
    },
    stabilizationAnim,
    cameraRef,
    frameOutput,
    startScan,
    retakeScan,
    isNativeLinked,
  };
}
