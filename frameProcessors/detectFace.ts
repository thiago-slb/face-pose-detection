/**
 * VisionCamera v5 + Nitro frame processor binding.
 *
 * Phase 1 migration: JS now looks up a Nitro HybridObject instead of using the
 * legacy VisionCameraProxy.initFrameProcessorPlugin(...) API.
 *
 * Call `detectFace(frame, { targetPose })` from inside a `useFrameOutput({ onFrame })` worklet.
 * It runs synchronously on the camera thread — keep it fast.
 *
 * Return type is a tagged union:
 *   { type: 'guidance', ... }  — emitted every processed frame
 *   { type: 'captured', ... }  — emitted once when native pipeline selects best frame
 */
import {
  NitroModules,
  type BoxedHybridObject,
} from 'react-native-nitro-modules';
import type { FaceDetectionFrameProcessor } from 'react-native-face-detection';
import type { Frame } from 'react-native-vision-camera';
import type { NativeFrameResult } from '../types/faceDetection';

export const FACE_DETECTION_HYBRID_NAME = 'FaceDetectionFrameProcessor';

let boxedProcessor: BoxedHybridObject<FaceDetectionFrameProcessor> | null = null;

try {
  if (NitroModules.hasHybridObject(FACE_DETECTION_HYBRID_NAME)) {
    const processor = NitroModules.createHybridObject<FaceDetectionFrameProcessor>(
      FACE_DETECTION_HYBRID_NAME,
    );
    // Box once in the JS runtime so worklets can unbox safely in their runtime.
    boxedProcessor = NitroModules.box(processor);
  }
} catch {
  boxedProcessor = null;
}

/**
 * Worklet-safe face detection + capture-pipeline call.
 * Pass `targetPose` so the native pipeline knows which pose it is scoring against.
 * Returns null when: plugin is not linked, or an unrecoverable error occurred.
 */
export function detectFace(
  frame: Frame,
  args: { targetPose: string },
): NativeFrameResult | null {
  'worklet';
  if (boxedProcessor == null) return null;
  const processor = boxedProcessor.unbox();
  const result = processor.processFrame(frame, args);
  if (result == null) return null;
  return result;
}

/**
 * True when the native HybridObject loaded correctly.
 * When false, useFaceDetection automatically enables mock mode.
 */
export const isPluginLinked = boxedProcessor != null;
