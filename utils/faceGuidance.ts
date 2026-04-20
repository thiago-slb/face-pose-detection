import type {
  RawFaceDetectionResult,
  FaceData,
  FaceGuidance,
  PoseId,
  DistanceStatus,
  AlignmentStatus,
  QualityStatus,
  DetectionThresholds,
} from '../types/faceDetection';
import { FaceDataSmoother } from './emaFilter';

// ─── Pose ────────────────────────────────────────────────────────────────────
export function derivePose(yaw: number, pitch: number, t: DetectionThresholds): PoseId {
  if (yaw < t.pose.yawLeft)     return 'left';
  if (yaw > t.pose.yawRight)    return 'right';
  if (pitch > t.pose.pitchUp)   return 'up';
  if (pitch < t.pose.pitchDown) return 'down';
  return 'center';
}

// ─── Distance ────────────────────────────────────────────────────────────────
export function deriveDistance(faceSizeRatio: number, t: DetectionThresholds): DistanceStatus {
  if (faceSizeRatio < t.distance.tooFar)   return 'tooFar';
  if (faceSizeRatio > t.distance.tooClose) return 'tooClose';
  return 'good';
}

// ─── Alignment ───────────────────────────────────────────────────────────────
export function deriveAlignment(cx: number, cy: number, t: DetectionThresholds): AlignmentStatus {
  // Add tolerance outside [0, 1] to account for normalization/rotation jitter.
  if (cx < -0.03 || cx > 1.03 || cy < -0.03 || cy > 1.03) return 'partiallyOutside';

  // Use an elliptical zone so "centered" feels closer to the oval guide.
  const dx = Math.abs(cx - 0.5) / t.alignment.maxOffsetX;
  const dy = Math.abs(cy - 0.5) / t.alignment.maxOffsetY;
  const inEllipse = dx * dx + dy * dy <= 0.90;

  if (inEllipse) return 'centered';
  return 'offCenter';
}

// ─── Quality ─────────────────────────────────────────────────────────────────
export function deriveQualityStatus(
  brightness: number,
  sharpness: number,
  t: DetectionThresholds,
): QualityStatus {
  if (brightness < t.quality.minBrightness) return 'tooDark';
  if (brightness > t.quality.maxBrightness) return 'tooBright';
  if (sharpness  < t.quality.minSharpness)  return 'blurry';
  return 'good';
}

/**
 * Composite quality score (0-1). Higher = better frame to use.
 *
 *   brightness component: peaks at 0.5 luma, falls off toward 0 or 1
 *   sharpness  component: directly proportional — sharper is always better
 *
 *   Sharpness has 65% weight because blur is the dominant failure mode for
 *   face-capture; lighting problems tend to be caught by the qualityStatus gate.
 */
export function computeQualityScore(brightness: number, sharpness: number): number {
  const brightnessScore = 1 - Math.abs(brightness - 0.5) * 2; // peaks at 0.5
  return sharpness * 0.65 + brightnessScore * 0.35;
}

// ─── Message bank ─────────────────────────────────────────────────────────────
const DISTANCE_MESSAGES: Record<'tooFar' | 'tooClose', readonly string[]> = {
  tooFar:   ['Move a little closer', 'Bring your face closer to the phone'],
  tooClose: ['Move slightly back',   'Hold the phone a bit farther away'],
};

const _msgCounters: Partial<Record<string, number>> = {};
function rotate(key: string, msgs: readonly string[]): string {
  const idx = (_msgCounters[key] ?? 0) % msgs.length;
  _msgCounters[key] = idx + 1;
  return msgs[idx];
}

const POSE_INSTRUCTIONS: Record<PoseId, string> = {
  center: 'Look straight ahead',
  left:   'Turn your head to the left',
  right:  'Turn your head to the right',
  up:     'Tilt your head up',
  down:   'Tilt your head down',
};

const QUALITY_MESSAGES: Record<Exclude<QualityStatus, 'good'>, string> = {
  tooDark:   'Too dark — find better lighting',
  tooBright: 'Too much light — move to a softer area',
  blurry:    'Hold your phone steady',
};

// ─── Main derivation ──────────────────────────────────────────────────────────
export function deriveGuidance(
  faceData: FaceData,
  t: DetectionThresholds,
): FaceGuidance {
  if (!faceData.faceDetected) {
    return {
      faceDetected:    false,
      detectedPose:    'center',
      distanceStatus:  'good',
      alignmentStatus: 'noFace',
      qualityStatus:   'good',
      qualityScore:    0,
      stabilizationProgress: 0,
      primaryMessage:  'Position your face in the frame',
      secondaryMessage: null,
    };
  }

  const detectedPose    = derivePose(faceData.yaw, faceData.pitch, t);
  const distanceStatus  = deriveDistance(faceData.faceSizeRatio, t);
  const alignmentStatus = deriveAlignment(faceData.faceCenterX, faceData.faceCenterY, t);
  const qualityStatus   = deriveQualityStatus(faceData.brightness, faceData.sharpness, t);
  const qualityScore    = computeQualityScore(faceData.brightness, faceData.sharpness);

  // Priority: distance > alignment > quality > pose instruction
  let primaryMessage: string;
  let secondaryMessage: string | null = null;

  if (distanceStatus === 'tooFar') {
    primaryMessage = rotate('tooFar', DISTANCE_MESSAGES.tooFar);
  } else if (distanceStatus === 'tooClose') {
    primaryMessage = rotate('tooClose', DISTANCE_MESSAGES.tooClose);
  } else if (alignmentStatus === 'partiallyOutside') {
    primaryMessage = 'Keep your face inside the frame';
  } else if (alignmentStatus === 'offCenter') {
    primaryMessage   = 'Center your face';
    secondaryMessage = POSE_INSTRUCTIONS[detectedPose];
  } else if (qualityStatus !== 'good') {
    primaryMessage   = QUALITY_MESSAGES[qualityStatus];
    secondaryMessage = POSE_INSTRUCTIONS[detectedPose];
  } else {
    primaryMessage = POSE_INSTRUCTIONS[detectedPose];
  }

  return {
    faceDetected: true,
    detectedPose,
    distanceStatus,
    alignmentStatus,
    qualityStatus,
    qualityScore,
    stabilizationProgress: 0,
    primaryMessage,
    secondaryMessage,
  };
}

// ─── Smoother application ─────────────────────────────────────────────────────
export function applySmoothing(
  raw: RawFaceDetectionResult | null,
  smoother: FaceDataSmoother,
  noFaceCount: number,
  thresholds: DetectionThresholds,
): FaceData {
  if (!raw?.faceDetected || !raw.boundingBox) {
    const newCount = noFaceCount + 1;
    if (newCount >= thresholds.noFaceResetFrames) smoother.resetAll();
    return {
      faceDetected: false,
      yaw: 0, pitch: 0, roll: 0,
      faceSizeRatio: 0,
      faceCenterX: 0.5, faceCenterY: 0.5,
      brightness: 0.5, sharpness: 0,
      noFaceFrameCount: newCount,
    };
  }

  const bb = raw.boundingBox;
  const cx = bb.x + bb.width  / 2;
  const cy = bb.y + bb.height / 2;

  return {
    faceDetected:  true,
    yaw:           smoother.yaw.update(raw.yaw      ?? 0),
    pitch:         smoother.pitch.update(raw.pitch   ?? 0),
    roll:          smoother.roll.update(raw.roll     ?? 0),
    faceSizeRatio: smoother.sizeRatio.update(bb.height),
    faceCenterX:   smoother.centerX.update(cx),
    faceCenterY:   smoother.centerY.update(cy),
    // Default to neutral values when native doesn't provide quality metrics
    // (e.g., in mock mode). This ensures quality never blocks the flow on dev.
    brightness:    smoother.brightness.update(raw.brightness ?? 0.5),
    sharpness:     smoother.sharpness.update(raw.sharpness   ?? 1.0),
    noFaceFrameCount: 0,
  };
}

// ─── Readiness check ──────────────────────────────────────────────────────────
// ALL conditions must be met — including quality — to start the stabilization window.
export function isReadyForPose(guidance: FaceGuidance, targetPose: PoseId): boolean {
  return (
    guidance.faceDetected &&
    guidance.detectedPose    === targetPose &&
    guidance.distanceStatus  === 'good' &&
    guidance.alignmentStatus === 'centered' &&
    guidance.qualityStatus   === 'good'
  );
}
