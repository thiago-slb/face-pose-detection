import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { C, POSES } from '../../constants/faceScanConfig';

interface Props {
  currentIndex: number;
}

export function ScanProgress({ currentIndex }: Props) {
  const total = POSES.length;

  return (
    <View style={styles.container}>
      <Text style={styles.label}>
        <Text style={styles.current}>{currentIndex + 1}</Text>
        <Text style={styles.sep}> / </Text>
        <Text style={styles.total}>{total}</Text>
      </Text>

      <View style={styles.track}>
        {POSES.map((_, i) => {
          const done    = i < currentIndex;
          const active  = i === currentIndex;
          return (
            <View
              key={i}
              style={[
                styles.segment,
                done   && styles.segDone,
                active && styles.segActive,
              ]}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
    paddingTop: 6,
    gap: 8,
  },
  label: {
    alignSelf: 'flex-end',
  },
  current: {
    fontSize: 13,
    fontWeight: '700',
    color: C.textPrimary,
    letterSpacing: 0.5,
  },
  sep: {
    fontSize: 13,
    color: C.textMuted,
  },
  total: {
    fontSize: 13,
    color: C.textMuted,
  },
  track: {
    flexDirection: 'row',
    gap: 4,
    height: 3,
  },
  segment: {
    flex: 1,
    borderRadius: 2,
    backgroundColor: C.border,
  },
  segDone: {
    backgroundColor: C.success,
  },
  segActive: {
    backgroundColor: C.primary,
  },
});
