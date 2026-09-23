import { memo } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import type { AgentAction, AgentMessage as Message } from '@/types/agent';
import { colors, radius, spacing } from '@/theme/tokens';
import { formatTimeOfDay } from '@/utils/format';
import { AppText } from '../ui/AppText';
import { Icon } from '../ui/Icon';
import { RemoteImage } from '../ui/RemoteImage';
import { AgentActions } from './AgentActions';
import { withManualAction } from './agentActionMeta';
import { CautionCallout } from './CautionCallout';
import { Citations, NoSourceNotice } from './Citations';
import { ContextTag } from './ContextTag';

const NON_KNOWLEDGE: AgentAction['type'][] = ['TRIGGER_SOS', 'CONTACT_SUPERVISOR', 'OPEN_CAMERA', 'OPEN_TASK'];

/**
 * Operator messages: right-aligned on a raised surface.
 * Agent answers: left-aligned, no bubble, full width so procedures read like
 * a document (same pattern as the Supervisor assistant).
 */
export const AgentMessage = memo(function AgentMessage({
  message,
  onRunAction,
  onRetry,
}: {
  message: Message;
  onRunAction: (action: AgentAction) => void;
  onRetry: (id: string) => void;
}) {
  const time = formatTimeOfDay(message.createdAt);

  if (message.role === 'operator') {
    return (
      <View style={styles.operatorWrap}>
        {message.context?.imageUri ? (
          <Image source={{ uri: message.context.imageUri }} style={styles.photo} accessibilityLabel="Attached machinery photo" />
        ) : message.context ? (
          <ContextTag context={message.context} />
        ) : null}
        <View style={styles.operatorBubble}>
          <AppText variant="body">{message.text}</AppText>
        </View>
        <View style={styles.metaRow}>
          {message.mode === 'voice' ? <Icon name="microphone" size={12} color={colors.textMuted} /> : null}
          <AppText variant="small" tone="muted" style={styles.meta}>
            {message.mode === 'voice' ? 'Voice · ' : ''}
            {time}
          </AppText>
        </View>
        {message.status === 'failed' ? (
          <View style={styles.failed} accessibilityLiveRegion="polite">
            <Icon name="alert-outline" size={16} color={colors.warning} />
            <AppText variant="small" tone="warning" style={{ flex: 1 }}>
              Not sent. Cat is unavailable right now.
            </AppText>
            <Pressable accessibilityRole="button" onPress={() => onRetry(message.id)} hitSlop={10} style={styles.retry}>
              <AppText variant="small" tone="brand" style={{ fontFamily: 'IBMPlexSans_600SemiBold' }}>
                Retry
              </AppText>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  }

  const actions = withManualAction(message.actions ?? [], message.manual);
  const isKnowledgeAnswer = !actions.some((a) => NON_KNOWLEDGE.includes(a.type));
  const sos = actions.some((a) => a.type === 'TRIGGER_SOS');

  return (
    <View style={[styles.agentWrap, sos && styles.agentSos]}>
      <View style={styles.agentHeader}>
        <View style={styles.agentMark}>
          <Icon name="waveform" size={14} color={colors.onBrand} />
        </View>
        <AppText variant="label" tone="secondary" caps>
          Cat
        </AppText>
        <AppText variant="small" tone="muted">
          {time}
        </AppText>
      </View>
      <AppText variant="body">{message.text}</AppText>
      {message.imageUrl ? (
        <RemoteImage
          uri={message.imageUrl}
          style={styles.manualImage}
          label={`Manual picture${message.manual?.topic ? `: ${message.manual.topic}` : ''}`}
          failedText="Manual picture unavailable on the Cat server"
        />
      ) : null}
      {message.caution ? <CautionCallout text={message.caution} /> : null}
      {message.citations?.length ? (
        <Citations citations={message.citations} />
      ) : isKnowledgeAnswer ? (
        <NoSourceNotice />
      ) : null}
      <AgentActions actions={actions} onRun={onRunAction} />
    </View>
  );
});

const styles = StyleSheet.create({
  operatorWrap: { alignItems: 'flex-end', gap: spacing.xs, marginLeft: spacing.xxxl },
  operatorBubble: {
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderBottomRightRadius: radius.sm,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.sm + 2,
  },
  photo: { width: 180, height: 135, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  meta: { fontSize: 12 },
  failed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    alignSelf: 'stretch',
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.warningSubtle,
  },
  retry: { paddingHorizontal: spacing.sm, minHeight: 32, justifyContent: 'center' },
  agentWrap: { gap: spacing.xs, paddingRight: spacing.sm },
  manualImage: {
    width: '100%',
    height: 180,
    marginTop: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: '#FAFAF7',
  },
  agentSos: { borderLeftWidth: 3, borderLeftColor: colors.danger, paddingLeft: spacing.md },
  agentHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  agentMark: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
