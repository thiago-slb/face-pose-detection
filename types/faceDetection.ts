// ─── Raw output from native frame processor plugin ──────────────────────────
// All bounding box values are normalized 0-1, top-left origin.
// Angles are in degrees; sign conventions are platform-normalized by the native layer:
//   yaw:   positive = user's head turned RIGHT, negative = LEFT
//   pitch: positive = user's head tilted UP,    negative = DOWN
//   roll:  positive = counterclockwise tilt

export interface RawFaceDetectionResult {
  faceDetected: boolean;
  boundingBox?: {
    x: number;      // left edge, 0-1
    y: number;      // top edge, 0-1
    width: number;  // 0-1
    height: number; // 0-1
  };
  yaw?: number;   // degrees
  pitch?: number; // degrees
  roll?: number;  // degrees
  trackingId?: number;
  brightness?: number;  // 0-1, mean luma of face bounding box
  sharpness?: number;   // 0-1, normalised Laplacian variance (0=blurry, 1=sharp)
  leftEyeOpenProbability?: number;
  rightEyeOpenProbability?: number;
}

// ─── Native frame result (tagged union returned by the plugin) ───────────────

/** Per-frame guidance data — emitted on every processed frame. */
export interface NativeGuidanceResult {
  type: 'guidance';
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
  /** Native stabilization window progress [0, 1]. */
  stabilizationProgress: number;
}

/** Per-pose capture result — emitted once when the native pipeline selects its best frame. */
export interface NativeCaptureResult {
  type: 'captured';
  poseId: string;
  /** Absolute file path to the saved JPEG. Absent in mock mode or on simulator. */
  uri?: string;
  /** Composite quality score [0, 1]. Higher = better frame. */
  qualityScore: number;
  scores: {
    brightness:   number;
    sharpness:    number;
    centeredness: number;
    poseAccuracy: number;
    stability:    number;
    faceSize:     number;
    composite:    number;
  };
}

export type NativeFrameResult = NativeGuidanceResult | NativeCaptureResult;

// ─── Smoothed / normalised face data ────────────────────────────────────────
export interface FaceData {
  faceDetected: boolean;
  yaw: number;
  pitch: number;
  roll: number;
  faceSizeRatio: number;
  faceCenterX: number;
  faceCenterY: number;
  brightness: number;
  sharpness: number;
  noFaceFrameCount: number;
}

// ─── Derived guidance ────────────────────────────────────────────────────────
export type PoseId          = 'center' | 'left' | 'right' | 'up' | 'down';
export type DistanceStatus  = 'tooClose' | 'tooFar' | 'good';
export type AlignmentStatus = 'centered' | 'offCenter' | 'partiallyOutside' | 'noFace';
export type QualityStatus   = 'good' | 'tooDark' | 'tooBright' | 'blurry';

export interface FaceGuidance {
  faceDetected: boolean;
  detectedPose: PoseId;
  distanceStatus: DistanceStatus;
  alignmentStatus: AlignmentStatus;
  qualityStatus: QualityStatus;
  qualityScore: number;
  primaryMessage: string;
  secondaryMessage: string | null;
  /** Native stabilization window progress [0, 1]. Drives the progress bar. */
  stabilizationProgress: number;
}

// ─── Thresholds (all tunable) ────────────────────────────────────────────────
export interface DetectionThresholds {
  pose: {
    yawLeft: number;
    yawRight: number;
    pitchUp: number;
    pitchDown: number;
  };
  distance: {
    tooFar: number;
    tooClose: number;
  };
  alignment: {
    maxOffsetX: number;
    maxOffsetY: number;
  };
  quality: {
    minBrightness: number;
    maxBrightness: number;
    minSharpness: number;
  };
  emaAlpha: {
    angles: number;
    position: number;
    size: number;
    quality: number;
  };
  noFaceResetFrames: number;
}

export const DEFAULT_THRESHOLDS: DetectionThresholds = {
  pose: {
    yawLeft:   -22,
    yawRight:   22,
    pitchUp:    16,
    pitchDown: -16,
  },
  distance: {
    tooFar:   0.20,
    tooClose: 0.65,
  },
  alignment: {
    // Balanced strictness: centered should feel intentional, not too permissive.
    maxOffsetX: 0.20,
    maxOffsetY: 0.24,
  },
  quality: {
    minBrightness: 0.25,
    maxBrightness: 0.82,
    minSharpness:  0.15,
  },
  emaAlpha: {
    angles:   0.35,
    position: 0.30,
    size:     0.25,
    quality:  0.30,
  },
  noFaceResetFrames: 5,
};
