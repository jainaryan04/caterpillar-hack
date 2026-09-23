import { Pressable, StyleSheet, View } from 'react-native';
import { useAgent } from '@/state/AgentProvider';
import { colors, radius, spacing, touch } from '@/theme/tokens';
import { AppText } from '../ui/AppText';
import { CatOrb } from './CatOrb';

/**
 * Voice entry point on the Cat tab. With live voice, "Hands-free" keeps a
 * session open so "Hey Cat" works from any screen; tapping the bar opens the
 * listening view. Without it (Expo Go / mock mode), the tap runs the demo voice.
 */
export function WakeWordBar() {
  const { startVoice, handsFree, connectVoice, disconnectVoice, voiceConnection, voiceConnectionDetail, voiceIsLive, wakePhrase } =
    useAgent();
  const listening = voiceIsLive && voiceConnection === 'connected';
  const sub = !voiceIsLive
    ? 'Demo: tap to hear a sample question'
    : voiceConnection === 'connecting'
      ? 'Connecting to Cat…'
      : voiceConnection === 'error'
        ? voiceConnectionDetail ?? 'Voice connection failed'
        : listening
          ? 'Listening from any screen'
          : 'or tap here';

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Talk to Cat"
        accessibilityHint="Opens the listening view"
        onPress={() => startVoice()}
        style={({ pressed }) => [styles.main, pressed && { opacity: 0.8 }]}
      >
        <CatOrb phase={listening ? 'listening' : 'idle'} size={40} />
        <View style={{ flex: 1 }}>
          <AppText variant="bodyStrong">Say “{wakePhrase}” to talk</AppText>
          <AppText variant="small" tone={voiceConnection === 'error' ? 'warning' : 'muted'} numberOfLines={2}>
            {sub}
          </AppText>
        </View>
      </Pressable>
      {voiceIsLive ? (
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: handsFree }}
          accessibilityLabel="Hands-free listening"
          onPress={() => (handsFree ? disconnectVoice() : connectVoice())}
          style={({ pressed }) => [styles.toggle, handsFree && styles.toggleOn, pressed && { opacity: 0.7 }]}
        >
          <AppText variant="label" caps style={{ fontSize: 10, color: handsFree ? colors.onBrand : colors.textMuted }}>
            Hands-free
          </AppText>
          <AppText variant="small" style={{ fontFamily: 'IBMPlexSans_600SemiBold', color: handsFree ? colors.onBrand : colors.text }}>
            {handsFree ? 'On' : 'Off'}
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
  toggle: {
    minHeight: touch.min,
    minWidth: 84,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  toggleOn: { backgroundColor: colors.brand, borderColor: colors.brand },
});
