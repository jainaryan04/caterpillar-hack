import { useEffect, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { colors, spacing } from '@/theme/tokens';
import { AppText } from '../ui/AppText';

/** Inline "Cat is thinking" row for the chat list. */
export function ThinkingIndicator() {
  const dots = useState(() => [0, 1, 2].map(() => new Animated.Value(0.3)))[0];

  useEffect(() => {
    const anim = Animated.loop(
      Animated.stagger(
        160,
        dots.map((d) =>
          Animated.sequence([
            Animated.timing(d, { toValue: 1, duration: 280, useNativeDriver: true }),
            Animated.timing(d, { toValue: 0.3, duration: 280, useNativeDriver: true }),
          ]),
        ),
      ),
    );
    anim.start();
    return () => anim.stop();
  }, [dots]);

  return (
    <View style={styles.row} accessibilityLiveRegion="polite" accessibilityLabel="Cat is thinking">
      <View style={styles.dots}>
        {dots.map((d, i) => (
          <Animated.View key={i} style={[styles.dot, { opacity: d }]} />
        ))}
      </View>
      <AppText variant="label" tone="secondary" caps>
        Thinking
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  dots: { flexDirection: 'row', gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand },
});
