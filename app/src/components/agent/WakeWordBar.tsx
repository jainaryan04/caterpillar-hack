import { Pressable, StyleSheet, View } from 'react-native';
import { useAgent } from '@/state/AgentProvider';
import { colors, radius, spacing, touch } from '@/theme/tokens';
import { AppText } from '../ui/AppText';
import { JarvisOrb } from './JarvisOrb';

/**
 * Resting state of the voice assistant: a quiet orb and the wake-word hint.
 * Tapping it starts listening. While the real wake-word engine isn't
 * connected, a clearly labelled demo button fakes the "Jarvis" detection.
 */
export function WakeWordBar() {
  const { startVoice, canSimulateWakeWord, simulateWakeWord } = useAgent();
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Talk to Jarvis"
        accessibilityHint="Starts listening"
        onPress={() => startVoice()}
        style={({ pressed }) => [styles.main, pressed && { opacity: 0.8 }]}
      >
        <JarvisOrb phase="idle" size={40} />
        <View>
          <AppText variant="bodyStrong">Say “Jarvis” to talk</AppText>
          <AppText variant="small" tone="muted">
            or tap here
          </AppText>
        </View>
      </Pressable>
      {canSimulateWakeWord ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Demo: simulate the wake word Jarvis"
          onPress={simulateWakeWord}
          style={({ pressed }) => [styles.demo, pressed && { opacity: 0.7 }]}
        >
          <AppText variant="label" tone="muted" caps style={{ fontSize: 10 }}>
            Demo
          </AppText>
          <AppText variant="small" style={{ fontFamily: 'IBMPlexSans_600SemiBold' }}>
            “Jarvis”
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: touch.min },
  demo: {
    minHeight: touch.min,
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
  },
});
