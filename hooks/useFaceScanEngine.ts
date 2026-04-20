import { useState, useRef, useCallback, useEffect } from 'react';
import { Animated } from 'react-native';
import type { FaceScanState, CapturedFrame } from '../types/faceScan';
import { POSES, STABILIZATION_MS, CAPTURE_FLASH_MS } from '../constants/faceScanConfig';

type Issue = 'tooFar' | 'tooClose' | 'offCenter' | 'tooDark' | 'blurry';

function randomIssue(): Issue | null {
  const r = Math.random();
  if (r < 0.28) return null;
  if (r < 0.46) return 'tooFar';
  if (r < 0.61) return 'tooClose';
  if (r < 0.73) return 'offCenter';
  if (r < 0.83) return 'tooDark';
  if (r < 0.92) return 'blurry';
  return null;
}

const randInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const INITIAL: FaceScanState = {
  screen: 'intro',
  currentPoseIndex: 0,
  poseStatus: 'idle',
  distanceStatus: 'good',
  alignmentStatus: 'centered',
  qualityStatus: 'good',
  capturedFrames: Array(5).fill(null),
};

export function useFaceScanEngine() {
  const [state, setState] = useState<FaceScanState>(INITIAL);
  const stabilizationAnim = useRef(new Animated.Value(0)).current;
  const runIdRef = useRef<symbol | null>(null);
  const activeAnim = useRef<Animated.CompositeAnimation | null>(null);

  const cancelCurrent = () => {
    runIdRef.current = null;
    activeAnim.current?.stop();
    activeAnim.current = null;
  };

  const startScan = useCallback(() => {
    cancelCurrent();
    stabilizationAnim.setValue(0);

    const id = Symbol('scan');
    runIdRef.current = id;
    const blank: (CapturedFrame | null)[] = Array(5).fill(null);

    setState({ ...INITIAL, screen: 'scanning', capturedFrames: blank });

    // Nested async function with full closure over `id` — avoids stale ref issues
    async function runPose(poseIdx: number, frames: (CapturedFrame | null)[]) {
      if (id !== runIdRef.current) return;

      const set = (updater: (s: FaceScanState) => FaceScanState) => {
        if (id === runIdRef.current) setState(updater);
      };

      const wait = (ms: number): Promise<boolean> =>
        new Promise(res => setTimeout(() => res(id === runIdRef.current), ms));

      // --- detecting phase ---
      set(s => ({
        ...s,
        currentPoseIndex: poseIdx,
        poseStatus: 'detecting',
        distanceStatus: 'good',
        alignmentStatus: 'centered',
        qualityStatus: 'good',
      }));

      if (!await wait(randInt(800, 1600))) return;

      // Simulate 1–2 issues
      const issues: Issue[] = [];
      const i1 = randomIssue();
      if (i1) issues.push(i1);
      if (Math.random() < 0.25) {
        const i2 = randomIssue();
        if (i2 && i2 !== i1) issues.push(i2);
      }

      for (const issue of issues) {
        if (id !== runIdRef.current) return;

        if (issue === 'tooFar') {
          set(s => ({ ...s, distanceStatus: 'tooFar' }));
          if (!await wait(randInt(1800, 2600))) return;
          set(s => ({ ...s, distanceStatus: 'good' }));
        } else if (issue === 'tooClose') {
          set(s => ({ ...s, distanceStatus: 'tooClose' }));
          if (!await wait(randInt(1800, 2600))) return;
          set(s => ({ ...s, distanceStatus: 'good' }));
        } else if (issue === 'offCenter') {
          set(s => ({ ...s, alignmentStatus: 'offCenter' }));
          if (!await wait(randInt(1400, 2200))) return;
          set(s => ({ ...s, alignmentStatus: 'centered' }));
        } else if (issue === 'tooDark') {
          set(s => ({ ...s, qualityStatus: 'tooDark' }));
          if (!await wait(randInt(1400, 2200))) return;
          set(s => ({ ...s, qualityStatus: 'good' }));
        } else if (issue === 'blurry') {
          set(s => ({ ...s, qualityStatus: 'blurry' }));
          if (!await wait(randInt(1200, 2000))) return;
          set(s => ({ ...s, qualityStatus: 'good' }));
        }

        // Brief "all good" window before next issue or stabilization
        if (!await wait(350)) return;
      }

      if (id !== runIdRef.current) return;

      // --- stabilizing phase ---
      stabilizationAnim.setValue(0);
      set(s => ({ ...s, poseStatus: 'stabilizing' }));

      await new Promise<void>(resolve => {
        const anim = Animated.timing(stabilizationAnim, {
          toValue: 1,
          duration: STABILIZATION_MS,
          useNativeDriver: false,
        });
        activeAnim.current = anim;
        anim.start(() => resolve());
      });

      if (id !== runIdRef.current) return;

      // --- captured phase ---
      const pose = POSES[poseIdx];
      const frame: CapturedFrame = { poseId: pose.id };
      const newFrames = frames.map((f, i) => (i === poseIdx ? frame : f));

      set(s => ({ ...s, poseStatus: 'captured', capturedFrames: newFrames }));

      if (!await wait(CAPTURE_FLASH_MS)) return;

      if (poseIdx < POSES.length - 1) {
        runPose(poseIdx + 1, newFrames);
      } else {
        set(s => ({ ...s, screen: 'success' }));
      }
    }

    // Start after state flush
    setTimeout(() => runPose(0, blank), 0);
  }, [stabilizationAnim]);

  const retakeScan = useCallback(() => startScan(), [startScan]);

  useEffect(() => () => cancelCurrent(), []);

  return { state, stabilizationAnim, startScan, retakeScan };
}
