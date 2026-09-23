import { StyleSheet, View } from 'react-native';
import { useAgent } from '@/state/AgentProvider';
import { colors, radius, spacing } from '@/theme/tokens';
import { AppText } from '../ui/AppText';

/** Where the voice is coming from: the live Cat session, or the demo stand-in. */
export function VoiceStatusPill() {
  const { voiceConnection, voiceIsLive } = useAgent();
  let color: string = colors.textMuted;
  let label = 'Voice off';
  if (!voiceIsLive) {
    color = colors.info;
    label = 'Demo voice (no mic)';
  } else if (voiceConnection === 'connected') {
    color = colors.success;
    label = 'Live · listening for “Hey Cat”';
  } else if (voiceConnection === 'connecting') {
    color = colors.warning;
    label = 'Connecting to Cat…';
  } else if (voiceConnection === 'error') {
    color = colors.danger;
    label = 'Voice connection failed';
  }
  return (
    <View style={styles.pill} accessibilityLabel={label}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <AppText variant="small" tone="secondary" style={{ fontSize: 13 }}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    borderRadius: radius.round,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
