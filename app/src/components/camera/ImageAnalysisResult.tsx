import { StyleSheet, View } from 'react-native';
import type { ImageAnalysis, ImageFindingSeverity } from '@/types/agent';
import { colors, radius, spacing } from '@/theme/tokens';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Icon, type IconName } from '../ui/Icon';
import { Badge } from '../ui/StatusBadge';

const severity: Record<ImageFindingSeverity, { icon: IconName; color: string; label: string }> = {
  critical: { icon: 'alert-octagon', color: colors.danger, label: 'Critical' },
  caution: { icon: 'alert', color: colors.warning, label: 'Caution' },
  info: { icon: 'information-outline', color: colors.info, label: 'Note' },
};

const confidenceLabel = { low: 'Low confidence', medium: 'Medium confidence', high: 'High confidence' };

/** Agent's reading of a machinery photo. Uncertainty is shown, never hidden. */
export function ImageAnalysisResult({ analysis }: { analysis: ImageAnalysis }) {
  const hasCritical = analysis.findings.some((f) => f.severity === 'critical');
  return (
    <Card accent={hasCritical ? 'danger' : undefined} style={styles.card}>
      <View style={styles.head}>
        <View style={styles.mark}>
          <Icon name="waveform" size={14} color={colors.onBrand} />
        </View>
        <AppText variant="label" tone="secondary" caps style={{ flex: 1 }}>
          Jarvis · Photo check
        </AppText>
        <Badge label={confidenceLabel[analysis.confidence]} fg={colors.textSecondary} bg={colors.neutralSubtle} />
      </View>

      <AppText variant="heading">{analysis.summary}</AppText>

      <View style={styles.findings}>
        {analysis.findings.map((f, i) => {
          const s = severity[f.severity];
          return (
            <View key={i} style={styles.finding} accessibilityLabel={`${s.label}: ${f.label}`}>
              <Icon name={s.icon} size={18} color={s.color} />
              <AppText variant="body" style={{ flex: 1 }}>
                {f.label}
              </AppText>
            </View>
          );
        })}
      </View>

      <View style={styles.limits}>
        <View style={styles.row}>
          <Icon name="help-circle-outline" size={18} color={colors.warning} />
          <AppText variant="label" tone="warning" caps>
            What I can’t confirm
          </AppText>
        </View>
        <AppText variant="small">{analysis.limitations}</AppText>
      </View>

      <View style={styles.next}>
        <AppText variant="label" tone="secondary" caps>
          What to do
        </AppText>
        <AppText variant="bodyStrong">{analysis.recommendedAction}</AppText>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  mark: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  findings: { gap: spacing.sm },
  finding: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  limits: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.warning,
    backgroundColor: colors.warningSubtle,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  next: { gap: spacing.xs, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
});
