import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import type { CapturedFrame } from '../../types/faceScan';
import { C, POSES } from '../../constants/faceScanConfig';

interface Props {
  currentIndex: number;
  capturedFrames: (CapturedFrame | null)[];
}

function PoseDot({ label, state }: { label: string; state: 'pending' | 'active' | 'done' }) {
  const scale = useRef(new Animated.Value(state === 'active' ? 0 : 1)).current;

  useEffect(() => {
    if (state === 'active') {
      const anim = Animated.loop(
        Animated.sequence([
          Animated.timing(scale, { toValue: 1.2, duration: 700, useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1.0, duration: 700, useNativeDriver: true }),
        ])
      );
      scale.setValue(1);
      anim.start();
      return () => { anim.stop(); scale.setValue(1); };
    } else {
      scale.setValue(1);
    }
  }, [state, scale]);

  const bg =
    state === 'done'    ? C.success   :
    state === 'active'  ? C.primary   :
    C.textMuted;

  return (
    <View style={styles.dotWrap}>
      <Animated.View style={[styles.dot, { backgroundColor: bg, transform: [{ scale }] }]}>
        {state === 'done' && <Text style={styles.check}>✓</Text>}
      </Animated.View>
      <Text style={[styles.dotLabel, state === 'active' && { color: C.textPrimary }]}>
        {label}
      </Text>
    </View>
  );
}

interface PoseTrackerProps {
  currentIndex: number;
  capturedFrames: (CapturedFrame | null)[];
}

export function PoseTracker({ currentIndex, capturedFrames }: PoseTrackerProps) {
  return (
    <View style={styles.row}>
      {POSES.map((pose, i) => {
        const done   = capturedFrames[i] !== null;
        const active = !done && i === currentIndex;
        return (
          <PoseDot
            key={pose.id}
            label={pose.label}
            state={done ? 'done' : active ? 'active' : 'pending'}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
    paddingVertical: 4,
  },
  dotWrap: {
    alignItems: 'center',
    gap: 5,
  },
  dot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  check: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '700',
  },
  dotLabel: {
    fontSize: 10,
    color: C.textMuted,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
