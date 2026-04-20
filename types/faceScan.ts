export type PoseId = 'center' | 'left' | 'right' | 'up' | 'down';
export type PoseStatus = 'idle' | 'detecting' | 'stabilizing' | 'captured';
export type DistanceStatus = 'tooClose' | 'tooFar' | 'good';
export type AlignmentStatus = 'centered' | 'offCenter' | 'partiallyOutside' | 'noFace';
export type QualityStatus = 'good' | 'tooDark' | 'tooBright' | 'blurry';
export type AppScreen = 'intro' | 'scanning' | 'success';

export interface Pose {
  id: PoseId;
  label: string;
  instruction: string;
}

export interface CapturedFrame {
  poseId: PoseId;
  /** Real file URI from camera snapshot. */
  uri?: string;
}

export interface FaceScanState {
  screen: AppScreen;
  currentPoseIndex: number;
  poseStatus: PoseStatus;
  distanceStatus: DistanceStatus;
  alignmentStatus: AlignmentStatus;
  qualityStatus: QualityStatus;
  capturedFrames: (CapturedFrame | null)[];
}
