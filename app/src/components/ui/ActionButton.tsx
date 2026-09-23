import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius, spacing, touch } from '@/theme/tokens';
import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ActionButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  icon?: IconName;
  size?: 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  /** Extra line under the label, e.g. "2 of 6 checks left" */
  hint?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

const fg: Record<Variant, string> = {
  primary: colors.onBrand,
  secondary: colors.text,
  ghost: colors.text,
  danger: colors.text,
};

export function ActionButton({
  label,
  onPress,
  variant = 'primary',
  icon,
  size = 'lg',
  disabled,
  loading,
  hint,
  accessibilityHint,
  style,
}: ActionButtonProps) {
  const inactive = disabled || loading;
  const color = inactive && variant === 'primary' ? colors.textSecondary : fg[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint ?? hint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        { minHeight: size === 'lg' ? touch.large : touch.min },
        styles[variant],
        inactive && variant === 'primary' && styles.primaryDisabled,
        pressed && (variant === 'primary' ? styles.primaryPressed : styles.pressed),
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={color} />
      ) : (
        <View style={styles.row}>
          {icon ? <Icon name={icon} size={22} color={color} /> : null}
          <View style={styles.labels}>
            <AppText variant="bodyStrong" style={[styles.label, { color }]}>
              {label}
            </AppText>
            {hint ? (
              <AppText variant="small" style={{ color, opacity: 0.8 }}>
                {hint}
              </AppText>
            ) : null}
          </View>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  labels: { alignItems: 'center' },
  label: { fontSize: 17 },
  primary: { backgroundColor: colors.brand, borderColor: colors.brand },
  primaryPressed: { backgroundColor: colors.brandPressed, borderColor: colors.brandPressed },
  primaryDisabled: { backgroundColor: colors.raised, borderColor: colors.borderStrong },
  secondary: { backgroundColor: colors.raised, borderColor: colors.borderStrong },
  ghost: { backgroundColor: 'transparent', borderColor: 'transparent' },
  danger: { backgroundColor: colors.dangerStrong, borderColor: colors.danger },
  pressed: { opacity: 0.75 },
});
