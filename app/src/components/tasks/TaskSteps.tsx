import { StyleSheet, View } from 'react-native';
import type { TaskStep } from '@/types/domain';
import { colors, radius, spacing } from '@/theme/tokens';
import { CautionCallout } from '../agent/CautionCallout';
import { AppText } from '../ui/AppText';

/** Numbered work instructions, visually distinct from the safety check. */
export function TaskSteps({ steps }: { steps: TaskStep[] }) {
  return (
    <View style={styles.list}>
      {steps.map((step, i) => (
        <View key={step.id} style={styles.step}>
          <View style={styles.num}>
            <AppText variant="mono" style={{ fontSize: 13 }}>
              {i + 1}
            </AppText>
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="body">{step.instruction}</AppText>
            {step.caution ? <CautionCallout text={step.caution} /> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.lg },
  step: { flexDirection: 'row', gap: spacing.md },
  num: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -2,
  },
});
