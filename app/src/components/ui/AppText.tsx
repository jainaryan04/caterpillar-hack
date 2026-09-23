import { Text, type TextProps } from 'react-native';
import { colors, type as typeScale, type TypeVariant } from '@/theme/tokens';

type Tone = 'primary' | 'secondary' | 'muted' | 'brand' | 'success' | 'warning' | 'danger' | 'onBrand';

const toneColor: Record<Tone, string> = {
  primary: colors.text,
  secondary: colors.textSecondary,
  muted: colors.textMuted,
  brand: colors.brand,
  success: colors.success,
  warning: colors.warning,
  danger: colors.danger,
  onBrand: colors.onBrand,
};

export interface AppTextProps extends TextProps {
  variant?: TypeVariant;
  tone?: Tone;
  /** Uppercase, used with the `label` variant for panel headers. */
  caps?: boolean;
}

export function AppText({ variant = 'body', tone = 'primary', caps, style, children, ...rest }: AppTextProps) {
  return (
    <Text
      {...rest}
      maxFontSizeMultiplier={1.4}
      style={[typeScale[variant], { color: toneColor[tone] }, caps && { textTransform: 'uppercase' }, style]}
    >
      {children}
    </Text>
  );
}
