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

  // Current target pose comes from state so React re-renders propagate it to
  // useFaceDetection, which updates the SharedValue fed into the worklet.
  const targetPose = POSES[scanState.currentPoseIndex]?.id ?? 'center';

  const { guidance, captureResult, clearCaptureResult, frameOutput, isNativeLinked } =
    useFaceDetection({ ...detectionOpts, targetPose });

  // ── Drive stabilization progress bar from native ──────────────────────────
  useEffect(() => {
    const progress = guidance.stabilizationProgress;

    if (progress > 0 && phaseRef.current === 'detecting') {
      phaseRef.current = 'stabilizing';
      setScanState(s => ({ ...s, poseStatus: 'stabilizing' }));
    } else if (progress === 0 && phaseRef.current === 'stabilizing') {
      phaseRef.current = 'detecting';
      setScanState(s => ({ ...s, poseStatus: 'detecting' }));
    }

    stabilizationAnim.setValue(progress);
  }, [guidance.stabilizationProgress, stabilizationAnim]);

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
    if (!captureResult.uri) {
      clearCaptureResult();
      return;
    }

    const poseIdx = poseIndexRef.current;
    const pose    = POSES[poseIdx];

    clearCaptureResult();

    const frame: CapturedFrame = {
      poseId:    pose.id,
      uri: captureResult.uri,
    };

    const newFrames = capturedRef.current.map((f, i) => (i === poseIdx ? frame : f));
    capturedRef.current = newFrames;

    phaseRef.current = 'captured';
    setScanState(s => ({ ...s, poseStatus: 'captured', capturedFrames: newFrames }));
    stabilizationAnim.setValue(0);

    setTimeout(() => {
      if (!isRunningRef.current) return;
      const next = poseIdx + 1;
      if (next < POSES.length) {
        poseIndexRef.current = next;
        phaseRef.current     = 'detecting';
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
    stabilizationAnim,
    cameraRef,
    frameOutput,
    startScan,
    retakeScan,
    isNativeLinked,
  };
}
