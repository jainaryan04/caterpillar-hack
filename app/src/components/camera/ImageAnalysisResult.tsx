import { StyleSheet, View } from 'react-native';
import type { AgentAction, ImageAnalysis, ImageFindingSeverity } from '@/types/agent';
import { colors, radius, spacing } from '@/theme/tokens';
import { AgentActions } from '../agent/AgentActions';
import { withManualAction } from '../agent/agentActionMeta';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Icon, type IconName } from '../ui/Icon';
import { RemoteImage } from '../ui/RemoteImage';

const severity: Record<ImageFindingSeverity, { icon: IconName; color: string; label: string }> = {
  critical: { icon: 'alert-octagon', color: colors.danger, label: 'Critical' },
  caution: { icon: 'alert', color: colors.warning, label: 'Caution' },
  info: { icon: 'information-outline', color: colors.info, label: 'Note' },
};

/** Agent's reading of a machinery photo, with a button to the manual page it came from. */
export function ImageAnalysisResult({
  analysis,
  onRunAction,
}: {
  analysis: ImageAnalysis;
  onRunAction?: (action: AgentAction) => void;
}) {
  const hasCritical = analysis.findings.some((f) => f.severity === 'critical');
  return (
    <Card accent={hasCritical ? 'danger' : undefined} style={styles.card}>
      <View style={styles.head}>
        <View style={styles.mark}>
          <Icon name="waveform" size={14} color={colors.onBrand} />
        </View>
        <AppText variant="label" tone="secondary" caps style={{ flex: 1 }}>
          Cat · Photo check
        </AppText>
      </View>

      <AppText variant="heading">{analysis.summary}</AppText>

      {analysis.annotatedImageUrl || analysis.manualCloseupUrl ? (
        <View style={styles.compare}>
          {analysis.annotatedImageUrl ? (
            <Figure uri={analysis.annotatedImageUrl} caption="Your photo, as Cat read it" />
          ) : null}
          {analysis.manualCloseupUrl ? (
            <Figure uri={analysis.manualCloseupUrl} caption="Same part in the manual" paper />
          ) : null}
        </View>
      ) : null}

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

      <View style={styles.next}>
        <AppText variant="label" tone="secondary" caps>
          What to do
        </AppText>
        <AppText variant="bodyStrong">{analysis.recommendedAction}</AppText>
      </View>

      {onRunAction ? <AgentActions actions={withManualAction([], analysis.manual)} onRun={onRunAction} /> : null}
    </Card>
  );
}

function Figure({ uri, caption, paper }: { uri: string; caption: string; paper?: boolean }) {
  return (
    <View style={styles.figure}>
      <RemoteImage uri={uri} style={[styles.figureImage, paper && { backgroundColor: '#FAFAF7' }]} label={caption} />
      <AppText variant="small" tone="muted" style={{ fontSize: 12 }}>
        {caption}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  compare: { flexDirection: 'row', gap: spacing.sm },
  figure: { flex: 1, gap: spacing.xs },
  figureImage: { width: '100%', height: 140, borderRadius: radius.md, backgroundColor: colors.inset },
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
  next: { gap: spacing.xs, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
});
