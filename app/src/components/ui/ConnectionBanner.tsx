import { StyleSheet, View } from 'react-native';
import { useConnectionState } from '@/hooks/useConnectionState';
import { colors, spacing } from '@/theme/tokens';
import { AppText } from './AppText';
import { Icon } from './Icon';

/** Amber strip shown while the realtime connection is down. */
export function ConnectionBanner() {
  const state = useConnectionState();
  if (state === 'online') return null;
  return (
    <View style={styles.strip} accessibilityRole="alert">
      <Icon name={state === 'offline' ? 'wifi-off' : 'sync'} size={16} color={colors.warning} />
      <AppText variant="small" tone="warning" style={{ flex: 1 }}>
        {state === 'offline'
          ? 'Offline. Showing saved data. Jarvis needs a connection.'
          : 'Reconnecting… Live updates paused.'}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.warningSubtle,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(245,158,11,0.3)',
  },
});
