import type { HybridObject } from 'react-native-nitro-modules';
import type { Frame } from 'react-native-vision-camera/src/specs/instances/Frame.nitro';

export interface FaceDetectionArgs {
  targetPose: string;
}

export enum NativeResultType {
  GUIDANCE = 0,
  CAPTURED = 1,
}

export interface GuidanceResult {
  type: NativeResultType.GUIDANCE;
  faceDetected: boolean;
  boundingBoxX?: number;
  boundingBoxY?: number;
  boundingBoxWidth?: number;
  boundingBoxHeight?: number;
  yaw?: number;
  pitch?: number;
  roll?: number;
  brightness?: number;
  sharpness?: number;
  faceSizeRatio?: number;
  faceCenterX?: number;
  faceCenterY?: number;
  stabilizationProgress: number;
}

export interface CaptureScores {
  brightness: number;
  sharpness: number;
  centeredness: number;
  poseAccuracy: number;
  stability: number;
  faceSize: number;
  composite: number;
}

export interface CaptureResult {
  type: NativeResultType.CAPTURED;
  poseId: string;
  uri?: string;
  qualityScore: number;
  scores: CaptureScores;
}

export type NativeFrameResult = GuidanceResult | CaptureResult;

export interface FaceDetectionFrameProcessor
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  processFrame(frame: Frame, args: FaceDetectionArgs): NativeFrameResult | null;
}
