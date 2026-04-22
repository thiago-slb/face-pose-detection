/**
 * useFaceDetection
 *
 * Responsibilities:
 *  1. Run the VisionCamera frame processor at ~15 fps (skip every other frame)
 *  2. Pass targetPose to the native pipeline via frame processor arguments
 *  3. Route native results:
 *       type='guidance' → apply EMA smoothing, derive FaceGuidance, throttle to ≤10fps
 *       type='captured' → surface via captureResult state for the caller to consume
 *  4. Mock mode: simulate the full guidance + capture sequence for dev builds
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useFrameOutput, type Frame } from 'react-native-vision-camera';
import { useSharedValue, runOnJS } from 'react-native-reanimated';

import { detectFace, isPluginLinked } from '../frameProcessors/detectFace';
import { FaceDataSmoother } from '../utils/emaFilter';
import { applySmoothing, deriveGuidance } from '../utils/faceGuidance';
import {
  DEFAULT_THRESHOLDS,
  NativeResultType,
  type DetectionThresholds,
  type FaceGuidance,
  type NativeGuidanceResult,
  type NativeCaptureResult,
  type NativeFrameResult,
  type RawFaceDetectionResult,
} from '../types/faceDetection';

// ─── Mock guidance sequence (simulators / Storybook) ─────────────────────────
const MOCK_SEQUENCE: FaceGuidance[] = [
  {
    faceDetected: false, detectedPose: 'center',
    distanceStatus: 'good', alignmentStatus: 'noFace', qualityStatus: 'good',
    qualityScore: 0, stabilizationProgress: 0,
    primaryMessage: 'Position your face in the frame', secondaryMessage: null,
  },
  {
    faceDetected: true, detectedPose: 'center',
    distanceStatus: 'tooFar', alignmentStatus: 'centered', qualityStatus: 'good',
    qualityScore: 0.7, stabilizationProgress: 0,
    primaryMessage: 'Move a little closer', secondaryMessage: null,
  },
  {
    faceDetected: true, detectedPose: 'center',
    distanceStatus: 'good', alignmentStatus: 'offCenter', qualityStatus: 'good',
    qualityScore: 0.8, stabilizationProgress: 0,
    primaryMessage: 'Center your face', secondaryMessage: 'Look straight ahead',
  },
  {
    faceDetected: true, detectedPose: 'center',
    distanceStatus: 'good', alignmentStatus: 'centered', qualityStatus: 'good',
    qualityScore: 0.9, stabilizationProgress: 0,
    primaryMessage: 'Look straight ahead', secondaryMessage: null,
  },
];

const DEFAULT_GUIDANCE: FaceGuidance = {
  faceDetected: false,
  detectedPose: 'center',
  distanceStatus: 'good',
  alignmentStatus: 'noFace',
  qualityStatus: 'good',
  qualityScore: 0,
  stabilizationProgress: 0,
  primaryMessage: 'Position your face in the frame',
  secondaryMessage: null,
};

// ─── Options ─────────────────────────────────────────────────────────────────
export interface UseFaceDetectionOptions {
  mockMode?: boolean;
  thresholds?: Partial<DetectionThresholds>;
  stateUpdateIntervalMs?: number;
  processEveryNFrames?: number;
  /** Active pose to score against. */
  targetPose?: string;
}

// ─── Return type ─────────────────────────────────────────────────────────────
export interface UseFaceDetectionResult {
  guidance: FaceGuidance;
  debugReadout: {
    cx: number | null;
    cy: number | null;
    yaw: number | null;
    pitch: number | null;
    roll: number | null;
    brightness: number | null;
    sharpness: number | null;
    faceSizeRatio: number | null;
    detectedPose: FaceGuidance['detectedPose'];
    stabilizationProgress: number;
    alignmentStatus: FaceGuidance['alignmentStatus'];
    faceDetected: boolean;
    lastGuidanceAtMs: number | null;
    lastNativeCapturePoseId: string | null;
    lastNativeCaptureAtMs: number | null;
  };
  /** Set when native pipeline delivers a best-frame capture. Clear after consuming. */
  captureResult: NativeCaptureResult | null;
  /** Call after reading captureResult to clear it and re-arm for the next pose. */
  clearCaptureResult: () => void;
  frameOutput: ReturnType<typeof useFrameOutput>;
  isNativeLinked: boolean;
}

// ─── Hook ────────────────────────────────────────────────────────────────────
export function useFaceDetection(opts: UseFaceDetectionOptions = {}): UseFaceDetectionResult {
  const {
    mockMode: mockModeOverride,
    thresholds: thresholdOverrides,
    stateUpdateIntervalMs = 100,
    processEveryNFrames   = 2,
    targetPose            = 'center',
  } = opts;
  const mockMode = mockModeOverride ?? !isPluginLinked;
  const effectiveProcessEveryNFrames = Math.max(1, Math.floor(processEveryNFrames));

  const thresholds = useMemo(
    () => ({ ...DEFAULT_THRESHOLDS, ...thresholdOverrides }),
    [thresholdOverrides],
  );

  const smoother        = useMemo(() => new FaceDataSmoother(thresholds.emaAlpha), [thresholds]);
  const noFaceCountRef  = useRef(0);
  const latestRef       = useRef<FaceGuidance>(DEFAULT_GUIDANCE);
  const latestDebugRef  = useRef<UseFaceDetectionResult['debugReadout']>({
    cx: null,
    cy: null,
    yaw: null,
    pitch: null,
    roll: null,
    brightness: null,
    sharpness: null,
    faceSizeRatio: null,
    detectedPose: 'center',
    stabilizationProgress: 0,
    alignmentStatus: 'noFace',
    faceDetected: false,
    lastGuidanceAtMs: null,
    lastNativeCapturePoseId: null,
    lastNativeCaptureAtMs: null,
  });
  const [guidance, setGuidance]           = useState<FaceGuidance>(DEFAULT_GUIDANCE);
  const [debugReadout, setDebugReadout]   = useState<UseFaceDetectionResult['debugReadout']>({
    cx: null,
    cy: null,
    yaw: null,
    pitch: null,
    roll: null,
    brightness: null,
    sharpness: null,
    faceSizeRatio: null,
    detectedPose: 'center',
    stabilizationProgress: 0,
    alignmentStatus: 'noFace',
    faceDetected: false,
    lastGuidanceAtMs: null,
    lastNativeCapturePoseId: null,
    lastNativeCaptureAtMs: null,
  });
  const [captureResult, setCaptureResult] = useState<NativeCaptureResult | null>(null);

  const clearCaptureResult = useCallback(() => setCaptureResult(null), []);

  // ── Mock mode — guidance cycling ──
  useEffect(() => {
    if (!mockMode) return;
    let i = 0;
    const id = setInterval(() => {
      latestRef.current = MOCK_SEQUENCE[i % MOCK_SEQUENCE.length];
      i++;
    }, 900);
    return () => clearInterval(id);
  }, [mockMode]);

  // ── Mock mode — capture simulation ──
  // When mock guidance reaches "all good", wait STABILIZATION_MS then fire a capture.
  useEffect(() => {
    if (!mockMode) return;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const checkInterval = setInterval(() => {
      const g = latestRef.current;
      const allGood =
        g.faceDetected &&
        g.distanceStatus  === 'good' &&
        g.alignmentStatus === 'centered' &&
        g.qualityStatus   === 'good';

      if (allGood && timerId === null) {
        // Simulate native stabilization progress via latestRef
        const start = Date.now();
        const windowMs = 500;

        timerId = setTimeout(() => {
          setCaptureResult({
            type:         NativeResultType.CAPTURED,
            poseId:       targetPose,
            qualityScore: 0.92,
            scores: {
              brightness: 0.88, sharpness: 0.85, centeredness: 0.94,
              poseAccuracy: 0.97, stability: 0.91, faceSize: 0.87, composite: 0.92,
            },
          });
          timerId = null;
        }, windowMs);

        // Animate mock stabilizationProgress in latestRef
        const animInterval = setInterval(() => {
          const elapsed = Date.now() - start;
          const progress = Math.min(elapsed / windowMs, 1);
          latestRef.current = { ...latestRef.current, stabilizationProgress: progress };
          if (elapsed >= windowMs) clearInterval(animInterval);
        }, 50);
      } else if (!allGood && timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
        latestRef.current = { ...latestRef.current, stabilizationProgress: 0 };
      }
    }, 100);

    return () => {
      clearInterval(checkInterval);
      if (timerId !== null) clearTimeout(timerId);
    };
  }, [mockMode, targetPose]);

  // ── Real frame result handler (JS thread, called via runOnJS) ──
  const handleResult = useCallback((raw: NativeFrameResult) => {
    if (raw.type === NativeResultType.CAPTURED) {
      latestDebugRef.current = {
        ...latestDebugRef.current,
        lastNativeCapturePoseId: raw.poseId,
        lastNativeCaptureAtMs: Date.now(),
      };
      setCaptureResult(raw);
      return;
    }
    const guidanceRaw: NativeGuidanceResult = raw;

    const asRaw: RawFaceDetectionResult | null = guidanceRaw.faceDetected
      ? {
          faceDetected: true,
          boundingBox:  guidanceRaw.boundingBoxX != null ? {
            x:      guidanceRaw.boundingBoxX,
            y:      guidanceRaw.boundingBoxY!,
            width:  guidanceRaw.boundingBoxWidth!,
            height: guidanceRaw.boundingBoxHeight!,
          } : undefined,
          yaw:        guidanceRaw.yaw,
          pitch:      guidanceRaw.pitch,
          roll:       guidanceRaw.roll,
          brightness: guidanceRaw.brightness,
          sharpness:  guidanceRaw.sharpness,
        }
      : { faceDetected: false };

    const faceData = applySmoothing(asRaw, smoother, noFaceCountRef.current, thresholds);
    noFaceCountRef.current = faceData.noFaceFrameCount;
    const nextGuidance: FaceGuidance = {
      ...deriveGuidance(faceData, thresholds),
      stabilizationProgress:
        typeof guidanceRaw.stabilizationProgress === 'number' ? guidanceRaw.stabilizationProgress : 0,
    };
    latestRef.current = nextGuidance;
    latestDebugRef.current = {
      ...latestDebugRef.current,
      cx: typeof guidanceRaw.faceCenterX === 'number' ? guidanceRaw.faceCenterX : null,
      cy: typeof guidanceRaw.faceCenterY === 'number' ? guidanceRaw.faceCenterY : null,
      yaw: typeof guidanceRaw.yaw === 'number' ? guidanceRaw.yaw : null,
      pitch: typeof guidanceRaw.pitch === 'number' ? guidanceRaw.pitch : null,
      roll: typeof guidanceRaw.roll === 'number' ? guidanceRaw.roll : null,
      brightness: typeof guidanceRaw.brightness === 'number' ? guidanceRaw.brightness : null,
      sharpness: typeof guidanceRaw.sharpness === 'number' ? guidanceRaw.sharpness : null,
      faceSizeRatio: typeof guidanceRaw.faceSizeRatio === 'number' ? guidanceRaw.faceSizeRatio : null,
      detectedPose: nextGuidance.detectedPose,
      stabilizationProgress: nextGuidance.stabilizationProgress,
      alignmentStatus: nextGuidance.alignmentStatus,
      faceDetected: guidanceRaw.faceDetected,
      lastGuidanceAtMs: Date.now(),
    };
  }, [smoother, thresholds]);

  // ── Periodic state sync (decouples React renders from camera frame rate) ──
  useEffect(() => {
    const id = setInterval(() => {
      setGuidance(prev => {
        const next = latestRef.current;
        if (
          prev.faceDetected         === next.faceDetected         &&
          prev.detectedPose         === next.detectedPose         &&
          prev.distanceStatus       === next.distanceStatus       &&
          prev.alignmentStatus      === next.alignmentStatus      &&
          prev.stabilizationProgress === next.stabilizationProgress
        ) return prev;
        return next;
      });
      setDebugReadout(prev => {
        const next = latestDebugRef.current;
        if (
          prev.cx === next.cx &&
          prev.cy === next.cy &&
          prev.yaw === next.yaw &&
          prev.pitch === next.pitch &&
          prev.roll === next.roll &&
          prev.brightness === next.brightness &&
          prev.sharpness === next.sharpness &&
          prev.faceSizeRatio === next.faceSizeRatio &&
          prev.detectedPose === next.detectedPose &&
          prev.stabilizationProgress === next.stabilizationProgress &&
          prev.alignmentStatus === next.alignmentStatus &&
          prev.faceDetected === next.faceDetected &&
          prev.lastGuidanceAtMs === next.lastGuidanceAtMs &&
          prev.lastNativeCapturePoseId === next.lastNativeCapturePoseId &&
          prev.lastNativeCaptureAtMs === next.lastNativeCaptureAtMs
        ) return prev;
        return next;
      });
    }, stateUpdateIntervalMs);
    return () => clearInterval(id);
  }, [stateUpdateIntervalMs]);

  // ── Frame output worklet ──
  const frameSkip = useSharedValue(0);

  const onFrame = useCallback((frame: Frame) => {
    'worklet';
    frameSkip.value = (frameSkip.value + 1) % effectiveProcessEveryNFrames;
    if (frameSkip.value !== 0) {
      frame.dispose();
      return;
    }

    // Pass the current target pose directly from the hook closure.
    // Using a Reanimated SharedValue here can become stale in VisionCamera's
    // worklet runtime, causing native to keep scoring against "center".
    const raw = detectFace(frame, { targetPose });
    if (raw != null) runOnJS(handleResult)(raw);
    frame.dispose();
  }, [effectiveProcessEveryNFrames, handleResult, frameSkip, targetPose]);

  const frameOutput = useFrameOutput({
    onFrame,
    // Ensure Android ML Kit always receives a compatible format.
    pixelFormat: 'yuv',
  });

  return {
    guidance,
    debugReadout,
    captureResult,
    clearCaptureResult,
    frameOutput,
    isNativeLinked: isPluginLinked,
  };
}
