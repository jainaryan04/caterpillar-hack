import { Pressable, StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '@/theme/tokens';
import { AppText } from '../ui/AppText';
import { Icon, type IconName } from '../ui/Icon';

export interface QuickAction {
  label: string;
  hint: string;
  icon: IconName;
  onPress: () => void;
}

/** Large icon + label tiles for the secondary destinations on Home. */
export function QuickActions({ actions }: { actions: QuickAction[] }) {
  return (
    <View style={styles.row}>
      {actions.map((a) => (
        <Pressable
          key={a.label}
          accessibilityRole="button"
          accessibilityLabel={`${a.label}. ${a.hint}`}
          onPress={a.onPress}
          style={({ pressed }) => [styles.tile, pressed && { backgroundColor: colors.raised }]}
        >
          <Icon name={a.icon} size={26} color={colors.brand} />
          <AppText variant="bodyStrong">{a.label}</AppText>
          <AppText variant="small" tone="muted" numberOfLines={2} style={{ fontSize: 13, lineHeight: 17 }}>
            {a.hint}
          </AppText>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm },
  tile: {
    flex: 1,
    minHeight: 112,
    padding: spacing.md,
    gap: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
});
