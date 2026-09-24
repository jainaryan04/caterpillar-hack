import { StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '@/theme/tokens';
import { AppText } from '../ui/AppText';
import { Icon } from '../ui/Icon';

/** Safety note kept visually separate from the answer body. */
export function CautionCallout({ text }: { text: string }) {
  return (
    <View style={styles.box} accessibilityLabel={`Caution. ${text}`}>
      <Icon name="alert" size={18} color={colors.warning} />
      <View style={{ flex: 1 }}>
        <AppText variant="label" tone="warning" caps>
          Caution
        </AppText>
        <AppText variant="small">{text}</AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.warning,
    backgroundColor: colors.warningSubtle,
  },
});
