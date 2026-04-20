declare module 'react-native-face-detection' {
  import type { HybridObject } from 'react-native-nitro-modules';
  import type { Frame } from 'react-native-vision-camera';
  import type { NativeFrameResult } from './faceDetection';

  export interface FaceDetectionFrameProcessor
    extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
    processFrame(frame: Frame, args: { targetPose: string }): NativeFrameResult | null;
  }
}
