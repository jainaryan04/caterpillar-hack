import { StyleSheet, View, type ViewProps } from 'react-native';
import { colors, radius, spacing } from '@/theme/tokens';

export interface CardProps extends ViewProps {
  /** 2px top border for the one thing on screen that needs action. */
  accent?: 'brand' | 'danger' | 'warning';
  padded?: boolean;
}

const accentColor = { brand: colors.brand, danger: colors.danger, warning: colors.warning };

export function Card({ accent, padded = true, style, ...rest }: CardProps) {
  return (
    <View
      {...rest}
      style={[
        styles.card,
        padded && styles.padded,
        accent && { borderTopWidth: 2, borderTopColor: accentColor[accent] },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  padded: { padding: spacing.lg },
});
