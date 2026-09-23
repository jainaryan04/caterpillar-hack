import { Pressable, StyleSheet } from 'react-native';
import { colors, radius, spacing, touch } from '@/theme/tokens';
import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

/** Selectable filter chip / suggestion chip. */
export function Chip({
  label,
  selected,
  onPress,
  icon,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  icon?: IconName;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, selected && styles.selected, pressed && { opacity: 0.75 }]}
    >
      {icon ? <Icon name={icon} size={16} color={selected ? colors.onBrand : colors.textSecondary} /> : null}
      <AppText variant="small" tone={selected ? 'onBrand' : 'primary'} style={{ fontFamily: 'IBMPlexSans_500Medium' }}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: touch.min - 8,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.raised,
  },
  selected: { backgroundColor: colors.brand, borderColor: colors.brand },
});
