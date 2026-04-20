import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import type { QualityStatus } from '../../types/faceScan';
import { C } from '../../constants/faceScanConfig';

const QUALITY_META: Record<Exclude<QualityStatus, 'good'>, { label: string; color: string }> = {
  tooDark:   { label: 'Too dark — find better lighting',   color: C.warning },
  tooBright: { label: 'Too much light — move to shade',    color: C.warning },
  blurry:    { label: 'Hold your phone steady',            color: C.warning },
};

interface Props {
  qualityStatus: QualityStatus;
}

export function QualityHint({ qualityStatus }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const toValue = qualityStatus !== 'good' ? 1 : 0;
    Animated.timing(opacity, { toValue, duration: 200, useNativeDriver: true }).start();
  }, [qualityStatus, opacity]);

  if (qualityStatus === 'good') {
    return <Animated.View style={[styles.row, { opacity }]} />;
  }

  const meta = QUALITY_META[qualityStatus];

  return (
    <Animated.View style={[styles.row, { opacity }]}>
      <View style={[styles.dot, { backgroundColor: meta.color }]} />
      <Text style={[styles.text, { color: meta.color }]}>{meta.label}</Text>
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
