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
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Animated } from 'react-native';
import type { CameraRef } from 'react-native-vision-camera';

import { useFaceDetection, type UseFaceDetectionOptions } from './useFaceDetection';
import { POSES, CAPTURE_FLASH_MS } from '../constants/faceScanConfig';
import type { FaceScanState, CapturedFrame } from '../types/faceScan';

type ScanPhase = 'detecting' | 'stabilizing' | 'captured';
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

const INITIAL_STATE: FaceScanState = {
  screen:          'intro',
  currentPoseIndex: 0,
  poseStatus:      'idle',
  distanceStatus:  'good',
  alignmentStatus: 'centered',
  qualityStatus:   'good',
  capturedFrames:  [...BLANK_FRAMES],
};

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

export function useFaceScanFlow(detectionOpts?: UseFaceDetectionOptions): UseFaceScanFlowResult {
  const [scanState, setScanState] = useState<FaceScanState>(INITIAL_STATE);
  const stabilizationAnim = useRef(new Animated.Value(0)).current;
  const cameraRef         = useRef<CameraRef | null>(null);

  const phaseRef      = useRef<ScanPhase>('detecting');
  const poseIndexRef  = useRef(0);
  const capturedRef   = useRef<(CapturedFrame | null)[]>([...BLANK_FRAMES]);
  const isRunningRef  = useRef(false);
  const lastNonZeroProgressAtRef = useRef<number>(0);
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
  const stabilizingSinceRef = useRef<number | null>(null);

  // Current target pose comes from state so React re-renders propagate it to
  // useFaceDetection, which updates the SharedValue fed into the worklet.
  const targetPose = POSES[scanState.currentPoseIndex]?.id ?? 'center';

  const { guidance, debugReadout, captureResult, clearCaptureResult, frameOutput, isNativeLinked } =
    useFaceDetection({ ...detectionOpts, targetPose });

  // ── Drive stabilization progress bar from native ──────────────────────────
  useEffect(() => {
    const rawProgress =
      typeof guidance.stabilizationProgress === 'number'
        ? guidance.stabilizationProgress
        : 0;
    const poseMatches = guidance.detectedPose === targetPose;
    const guidanceReady =
      guidance.faceDetected &&
      guidance.distanceStatus === 'good' &&
      guidance.alignmentStatus === 'centered' &&
      guidance.qualityStatus === 'good';
    const progress = poseMatches && guidanceReady ? rawProgress : 0;
    const now = Date.now();

    if (progress > 0 && phaseRef.current === 'detecting') {
      phaseRef.current = 'stabilizing';
      lastNonZeroProgressAtRef.current = now;
      stabilizingSinceRef.current = now;
      setScanState(s => ({ ...s, poseStatus: 'stabilizing' }));
    } else if (progress > 0) {
      lastNonZeroProgressAtRef.current = now;
    } else if (progress === 0 && phaseRef.current === 'stabilizing') {
      const elapsedSinceNonZero = now - lastNonZeroProgressAtRef.current;
      if (elapsedSinceNonZero >= STABILIZATION_DROP_GRACE_MS) {
        phaseRef.current = 'detecting';
        stabilizingSinceRef.current = null;
        setScanState(s => ({ ...s, poseStatus: 'detecting' }));
      }
    }

    stabilizationAnim.setValue(progress);
  }, [
    guidance.stabilizationProgress,
    guidance.detectedPose,
    guidance.faceDetected,
    guidance.distanceStatus,
    guidance.alignmentStatus,
    guidance.qualityStatus,
    targetPose,
    stabilizationAnim,
  ]);

  // ── Polling fallback for stabilization grace period ───────────────────────
  // The grace-period check in the progress effect only runs when guidance deps
  // change. If stabilizationProgress stays at 0 and nothing else moves, the
  // effect never re-fires and poseStatus gets permanently stuck at 'stabilizing'.
  // This interval catches that case independently of React render cycles.
  useEffect(() => {
    const id = setInterval(() => {
      if (phaseRef.current !== 'stabilizing') return;
      const elapsed = Date.now() - lastNonZeroProgressAtRef.current;
      if (elapsed >= STABILIZATION_DROP_GRACE_MS) {
        phaseRef.current = 'detecting';
        stabilizingSinceRef.current = null;
        setScanState(s => ({ ...s, poseStatus: 'detecting' }));
        stabilizationAnim.setValue(0);
      }
    }, 200);
    return () => clearInterval(id);
  }, [stabilizationAnim]);

  // ── Mirror guidance fields into scan state ─────────────────────────────────
  useEffect(() => {
    if (!isRunningRef.current) return;
    setScanState(s => ({
      ...s,
      distanceStatus:  guidance.distanceStatus,
      alignmentStatus: guidance.alignmentStatus,
      qualityStatus:   guidance.qualityStatus,
    }));
  }, [guidance.distanceStatus, guidance.alignmentStatus, guidance.qualityStatus]);

  // ── React to native capture events ────────────────────────────────────────
  useEffect(() => {
    if (!captureResult || !isRunningRef.current) return;
    setLastCaptureEvent({
      poseId: captureResult.poseId ?? null,
      hasUri: !!captureResult.uri,
      atMs: Date.now(),
      outcome: 'none',
    });
    if (!captureResult.uri) {
      setLastCaptureEvent({
        poseId: captureResult.poseId ?? null,
        hasUri: false,
        atMs: Date.now(),
        outcome: 'missing_uri',
      });
      clearCaptureResult();
      // Native delivered a window with no viable frames — reset so pipeline retries.
      if (phaseRef.current !== 'captured') {
        phaseRef.current = 'detecting';
        stabilizingSinceRef.current = null;
        lastNonZeroProgressAtRef.current = 0;
        setScanState(s => ({ ...s, poseStatus: 'detecting' }));
        stabilizationAnim.setValue(0);
      }
      return;
    }

    const poseIdx = poseIndexRef.current;
    const pose    = POSES[poseIdx];
    const completedPoseIds = new Set(
      capturedRef.current
        .filter((f): f is CapturedFrame => f != null)
        .map(f => f.poseId),
    );
    if (completedPoseIds.has(captureResult.poseId as CapturedFrame['poseId'])) {
      setLastCaptureEvent({
        poseId: captureResult.poseId ?? null,
        hasUri: true,
        atMs: Date.now(),
        outcome: 'stale_previous_pose',
      });
      clearCaptureResult();
      return;
    }
    if (phaseRef.current === 'captured' && captureResult.poseId === pose.id) {
      setLastCaptureEvent({
        poseId: captureResult.poseId ?? null,
        hasUri: true,
        atMs: Date.now(),
        outcome: 'duplicate_for_current_pose',
      });
      clearCaptureResult();
      return;
    }
    if (captureResult.poseId !== pose.id) {
      setLastCaptureEvent({
        poseId: captureResult.poseId ?? null,
        hasUri: true,
        atMs: Date.now(),
        outcome: 'pose_mismatch',
      });
      clearCaptureResult();
      return;
    }

    clearCaptureResult();

    const frame: CapturedFrame = {
      poseId:    pose.id,
      uri: captureResult.uri,
    };

    const newFrames = capturedRef.current.map((f, i) => (i === poseIdx ? frame : f));
    capturedRef.current = newFrames;
    setAcceptedCaptureMeta({ poseId: pose.id, atMs: Date.now() });
    setLastCaptureEvent({
      poseId: pose.id,
      hasUri: true,
      atMs: Date.now(),
      outcome: 'accepted',
    });

    phaseRef.current = 'captured';
    stabilizingSinceRef.current = null;
    setScanState(s => ({ ...s, poseStatus: 'captured', capturedFrames: newFrames }));
    stabilizationAnim.setValue(0);

    setTimeout(() => {
      if (!isRunningRef.current) return;
      const next = poseIdx + 1;
      if (next < POSES.length) {
        poseIndexRef.current = next;
        phaseRef.current     = 'detecting';
        stabilizingSinceRef.current = null;
        setScanState(s => ({
          ...s,
          currentPoseIndex: next,
          poseStatus:       'detecting',
        }));
      } else {
        isRunningRef.current = false;
        setScanState(s => ({ ...s, screen: 'success' }));
      }
    }, CAPTURE_FLASH_MS);
  }, [captureResult, clearCaptureResult, stabilizationAnim]);

  // ── startScan / retakeScan ────────────────────────────────────────────────
  const startScan = useCallback(() => {
    stabilizationAnim.setValue(0);
    isRunningRef.current = true;
    poseIndexRef.current = 0;
    phaseRef.current     = 'detecting';
    capturedRef.current  = [...BLANK_FRAMES];
    setAcceptedCaptureMeta({ poseId: null, atMs: null });
    setLastCaptureEvent({ poseId: null, hasUri: null, atMs: null, outcome: 'none' });
    stabilizingSinceRef.current = null;
    setScanState({
      ...INITIAL_STATE,
      screen:         'scanning',
      poseStatus:     'detecting',
      capturedFrames: [...BLANK_FRAMES],
    });
  }, [stabilizationAnim]);

  const retakeScan = useCallback(() => {
    isRunningRef.current = false;
    startScan();
  }, [startScan]);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => { isRunningRef.current = false; };
  }, []);

  return {
    state: scanState,
    debugReadout: {
      ...debugReadout,
      targetPose,
      acceptedCapturePoseId: acceptedCaptureMeta.poseId,
      acceptedCaptureAtMs: acceptedCaptureMeta.atMs,
      completedPoseIds: scanState.capturedFrames
        .filter((f): f is CapturedFrame => f != null)
        .map(f => f.poseId),
      poseStatus: scanState.poseStatus,
      stabilizingForMs:
        scanState.poseStatus === 'stabilizing' && stabilizingSinceRef.current != null
          ? Date.now() - stabilizingSinceRef.current
          : null,
      msSinceLastProgress:
        scanState.poseStatus === 'stabilizing' && lastNonZeroProgressAtRef.current > 0
          ? Date.now() - lastNonZeroProgressAtRef.current
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
