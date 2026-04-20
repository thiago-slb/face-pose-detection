import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { useFaceScanFlow } from '@/hooks/useFaceScanFlow';
import { FaceScanIntroScreen }   from '@/components/face-scan/FaceScanIntroScreen';
import { FaceScanCameraScreen }  from '@/components/face-scan/FaceScanCameraScreen';
import { FaceScanSuccessScreen } from '@/components/face-scan/FaceScanSuccessScreen';

export default function HomeScreen() {
  const {
    state,
    debugReadout,
    stabilizationAnim,
    cameraRef,
    frameOutput,
    isNativeLinked,
    startScan,
    retakeScan,
  } = useFaceScanFlow();

  if (state.screen === 'intro') {
    return (
      <>
        <StatusBar style="light" />
        <FaceScanIntroScreen onStart={startScan} />
      </>
    );
  }

  if (state.screen === 'scanning') {
    return (
      <>
        <StatusBar style="light" hidden />
        <FaceScanCameraScreen
          state={state}
          debugReadout={debugReadout}
          stabilizationAnim={stabilizationAnim}
          cameraRef={cameraRef}
          frameOutput={frameOutput}
          isNativeLinked={isNativeLinked}
          onCancel={retakeScan}
        />
      </>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <FaceScanSuccessScreen
        capturedFrames={state.capturedFrames}
        onContinue={startScan}
        onRetake={retakeScan}
      />
    </>
  );
}
