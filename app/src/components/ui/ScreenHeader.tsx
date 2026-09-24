import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, spacing } from '@/theme/tokens';
import { AppText } from './AppText';
import { IconButton } from './IconButton';

/** Header for pushed (non-tab) screens: back button, label, optional right slot. */
export function ScreenHeader({ label, right }: { label: string; right?: ReactNode }) {
  return (
    <View style={styles.row}>
      <IconButton
        icon="arrow-left"
        label="Back"
        tone="plain"
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/home'))}
      />
      <AppText variant="label" tone="secondary" caps style={styles.label} numberOfLines={1}>
        {label}
      </AppText>
      <View style={styles.right}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.canvas,
  },
  label: { flex: 1, marginLeft: spacing.xs },
  right: { minWidth: 48, alignItems: 'flex-end' },
});
