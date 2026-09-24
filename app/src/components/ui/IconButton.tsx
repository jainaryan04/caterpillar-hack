import { Pressable, StyleSheet } from 'react-native';
import { colors, radius, touch } from '@/theme/tokens';
import { Icon, type IconName } from './Icon';

export function IconButton({
  icon,
  label,
  onPress,
  tone = 'default',
  size = touch.min,
}: {
  icon: IconName;
  /** Always required: read by TalkBack since there is no visible text. */
  label: string;
  onPress: () => void;
  tone?: 'default' | 'brand' | 'plain';
  size?: number;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.base,
        { width: size, height: size },
        tone === 'brand' && styles.brand,
        tone === 'plain' && styles.plain,
        pressed && { opacity: 0.7 },
      ]}
    >
      <Icon name={icon} size={Math.round(size * 0.48)} color={tone === 'brand' ? colors.onBrand : colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brand: { backgroundColor: colors.brand, borderColor: colors.brand },
  plain: { backgroundColor: 'transparent', borderColor: 'transparent' },
});
