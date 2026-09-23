import { router } from 'expo-router';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAgent } from '@/state/AgentProvider';
import type { AgentAction, VoicePhase } from '@/types/agent';
import { radius, spacing } from '@/theme/tokens';
import { ActionButton } from '../ui/ActionButton';
import { AppText } from '../ui/AppText';
import { RemoteImage } from '../ui/RemoteImage';
import { AgentActions } from './AgentActions';
import { withManualAction } from './agentActionMeta';
import { CatOrb } from './CatOrb';
import { ContextTag } from './ContextTag';
import { VoiceStatusPill } from './VoiceStatusPill';
import { Waveform } from './Waveform';

const phaseLabel: Record<VoicePhase, string> = {
  idle: 'Cat',
  listening: 'Listening',
  thinking: 'Thinking',
  responding: 'Cat is speaking',
  done: 'Answered',
  error: 'Not available',
};

/**
 * Full-screen voice interaction, mounted once at the root so "Hey Cat", the
 * mic buttons and "Ask Cat about this" all open it over whatever screen the
 * operator is on. Driven by the live voice session (see useVoiceController).
 */
export function VoiceOverlay() {
  const { voice, overlayVisible, cancelVoice, dismissVoice, startVoice, runAction, setChatContext, wakePhrase } = useAgent();
  const insets = useSafeAreaInsets();
  const { phase, response } = voice;
  const fromVideo = !!voice.context?.videoId;

  const runFromOverlay = (action: AgentAction) => {
    dismissVoice();
    runAction(action);
  };

  const continueInChat = () => {
    setChatContext(voice.context);
    dismissVoice();
    router.navigate('/agent');
  };

  const waveMode = phase === 'listening' ? 'listening' : phase === 'thinking' ? 'thinking' : phase === 'responding' ? 'responding' : 'idle';

  return (
    <Modal
      visible={overlayVisible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={cancelVoice}
    >
      <View style={[styles.screen, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.top}>
          <VoiceStatusPill />
          {voice.context ? <ContextTag context={voice.context} /> : null}
        </View>

        <View style={styles.center}>
          <CatOrb phase={phase} size={phase === 'responding' || phase === 'done' ? 88 : 128} />
          <AppText
            variant="label"
            caps
            tone={phase === 'listening' ? 'brand' : phase === 'error' ? 'warning' : phase === 'done' ? 'success' : 'secondary'}
            style={styles.phaseLabel}
            accessibilityLiveRegion="assertive"
          >
            {phaseLabel[phase]}
          </AppText>
          <View style={styles.wave}>
            <Waveform mode={waveMode} height={phase === 'responding' || phase === 'done' ? 36 : 64} />
          </View>

          {phase === 'listening' || phase === 'thinking' ? (
            <View style={styles.transcriptBox}>
              {voice.transcript ? (
                <AppText variant="title" style={styles.center_text}>
                  “{voice.transcript}”
                </AppText>
              ) : (
                <AppText variant="heading" tone="secondary" style={styles.center_text}>
                  Say “{wakePhrase}”, then your question
                </AppText>
              )}
              {voice.status ? (
                <AppText variant="small" tone="brand" style={styles.center_text}>
                  {voice.status}
                </AppText>
              ) : null}
              {voice.hint ? (
                <AppText variant="small" tone="warning" style={styles.center_text}>
                  {voice.hint}
                </AppText>
              ) : null}
            </View>
          ) : null}

          {(phase === 'responding' || phase === 'done') ? (
            <ScrollView style={styles.answer} contentContainerStyle={{ paddingBottom: spacing.md }}>
              {voice.transcript ? (
                <AppText variant="small" tone="muted" style={{ marginBottom: spacing.sm }}>
                  “{voice.transcript}”
                </AppText>
              ) : null}
              {voice.status && !response?.text ? (
                <AppText variant="body" tone="brand">
                  {voice.status}
                </AppText>
              ) : null}
              {response?.text ? (
                <AppText variant="body" style={{ fontSize: 18, lineHeight: 27 }}>
                  {response.text}
                </AppText>
              ) : null}
              {response?.imageUrl ? (
                <RemoteImage
                  uri={response.imageUrl}
                  style={styles.manualImage}
                  label="Picture from the manual"
                  failedText="Manual picture unavailable on the Cat server"
                />
              ) : null}
              {voice.pages ? (
                <AppText variant="small" tone="brand" style={{ marginTop: spacing.sm }}>
                  Opening manual page {voice.pages.page}…
                </AppText>
              ) : null}
              {phase === 'done' && response ? (
                <AgentActions
                  actions={withManualAction(response.actions, response.manual)}
                  onRun={runFromOverlay}
                  exclude={fromVideo ? ['RESUME_VIDEO'] : []}
                />
              ) : null}
            </ScrollView>
          ) : null}

          {phase === 'error' ? (
            <AppText variant="body" tone="secondary" style={styles.center_text}>
              {voice.error ?? 'Cat is unavailable right now.'}
            </AppText>
          ) : null}
        </View>

        <View style={styles.actions}>
          {phase === 'done' ? (
            <>
              {fromVideo ? (
                <ActionButton label="Resume video" icon="play" onPress={() => runFromOverlay({ type: 'RESUME_VIDEO' })} />
              ) : null}
              <View style={styles.row}>
                <ActionButton
                  label="Ask again"
                  icon="microphone"
                  variant="secondary"
                  onPress={() => startVoice(voice.context)}
                  style={styles.flex}
                />
                <ActionButton label="Chat" icon="message-text-outline" variant="secondary" onPress={continueInChat} style={styles.flex} />
              </View>
              <ActionButton label="Close" variant="ghost" size="md" onPress={dismissVoice} />
            </>
          ) : phase === 'error' ? (
            <View style={styles.row}>
              <ActionButton label="Close" variant="secondary" onPress={dismissVoice} style={styles.flex} />
              <ActionButton label="Try again" icon="microphone" onPress={() => startVoice(voice.context)} style={styles.flex} />
            </View>
          ) : (
            <ActionButton
              label={phase === 'responding' ? 'Hide' : 'Cancel'}
              icon="close"
              variant="secondary"
              onPress={cancelVoice}
              accessibilityHint={phase === 'responding' ? 'Closes this view; Cat finishes speaking' : undefined}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'rgba(8,8,8,0.97)', paddingHorizontal: spacing.xl },
  top: { minHeight: 36, alignItems: 'center', gap: spacing.sm },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  center_text: { textAlign: 'center', maxWidth: 340 },
  phaseLabel: { fontSize: 15, letterSpacing: 4, marginTop: spacing.sm },
  wave: { alignSelf: 'stretch', alignItems: 'center', marginVertical: spacing.sm },
  transcriptBox: { minHeight: 110, justifyContent: 'center', alignItems: 'center', gap: spacing.sm },
  answer: { alignSelf: 'stretch', maxHeight: '55%', flexGrow: 0 },
  manualImage: { width: '100%', height: 180, marginTop: spacing.md, borderRadius: radius.md, backgroundColor: '#FAFAF7' },
  actions: { gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
});
