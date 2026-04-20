import React, { useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import type { PoseStatus } from '../../types/faceScan';
import { C } from '../../constants/faceScanConfig';

interface Props {
  poseStatus: PoseStatus;
  stabilizationAnim: Animated.Value;
}

export function StabilizationIndicator({ poseStatus, stabilizationAnim }: Props) {
  const [trackWidth, setTrackWidth] = useState(0);

  const isStabilizing = poseStatus === 'stabilizing';
  const isCaptured    = poseStatus === 'captured';
  const isVisible     = isStabilizing || isCaptured;

  const fillWidth = trackWidth > 0
    ? stabilizationAnim.interpolate({ inputRange: [0, 1], outputRange: [0, trackWidth] })
    : 0;

  const fillColor = isCaptured ? C.captured : C.success;

  return (
    <View style={styles.wrapper}>
      <View
        style={styles.track}
        onLayout={e => setTrackWidth(e.nativeEvent.layout.width)}
      >
        {isVisible && trackWidth > 0 && (
          <Animated.View
            style={[
              styles.fill,
              { width: fillWidth, backgroundColor: fillColor },
            ]}
          />
        )}
      </View>

      <Text style={[
        styles.label,
        { opacity: isStabilizing ? 1 : isCaptured ? 0 : 0 },
        isStabilizing && { color: C.success },
      ]}>
        {isStabilizing ? 'Capturing best frame…' : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: 24,
    gap: 8,
    minHeight: 30,
  },
  track: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    borderRadius: 2,
  },
  label: {
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.3,
    textAlign: 'center',
  },
});
