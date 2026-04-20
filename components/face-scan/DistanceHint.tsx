import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import type { DistanceStatus } from '../../types/faceScan';
import { C } from '../../constants/faceScanConfig';

const MESSAGES: Record<Exclude<DistanceStatus, 'good'>, string[]> = {
  tooFar:   ['Move a little closer', 'Bring your face closer to the phone'],
  tooClose: ['Move slightly back', 'Hold the phone a bit farther away'],
};

const messageRef: Record<string, number> = {};

function getMessage(status: Exclude<DistanceStatus, 'good'>): string {
  const msgs = MESSAGES[status];
  const idx = messageRef[status] ?? 0;
  messageRef[status] = (idx + 1) % msgs.length;
  return msgs[idx];
}

interface Props {
  distanceStatus: DistanceStatus;
}

export function DistanceHint({ distanceStatus }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const msgRef  = useRef('');

  useEffect(() => {
    if (distanceStatus !== 'good') {
      msgRef.current = getMessage(distanceStatus);
      Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    } else {
      Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }).start();
    }
  }, [distanceStatus, opacity]);

  const isClose = distanceStatus === 'tooClose';
  const color   = isClose ? C.warning : C.textSecondary;

  return (
    <Animated.View style={[styles.row, { opacity }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.text, { color }]}>{msgRef.current}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    minHeight: 22,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  text: {
    fontSize: 14,
    fontWeight: '400',
    letterSpacing: 0.1,
  },
});
