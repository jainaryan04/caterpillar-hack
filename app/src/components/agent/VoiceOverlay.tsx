import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAgent } from '@/state/AgentProvider';
import type { AgentAction, VoicePhase } from '@/types/agent';
import { spacing } from '@/theme/tokens';
import { ActionButton } from '../ui/ActionButton';
import { AppText } from '../ui/AppText';
import { AgentActions } from './AgentActions';
import { CautionCallout } from './CautionCallout';
import { Citations } from './Citations';
import { ContextTag } from './ContextTag';
import { JarvisOrb } from './JarvisOrb';
import { Waveform } from './Waveform';

const phaseCopy: Record<VoicePhase, { label: string; status: string }> = {
  idle: { label: 'Jarvis', status: 'Say “Jarvis” to talk' },
  listening: { label: 'Listening', status: 'Jarvis is listening…' },
  thinking: { label: 'Thinking', status: 'Working on an answer…' },
  responding: { label: 'Responding', status: 'Jarvis' },
  error: { label: 'Not available', status: '' },
};

const REVEAL_MS_PER_WORD = 55;

/**
 * Full-screen voice interaction. Mounted once at the root so the wake word,
 * the mic button and "Ask Jarvis about this" all open the same experience on
 * top of whatever screen the operator is on.
 */
export function VoiceOverlay() {
  const { voice, overlayVisible, cancelVoice, dismissVoice, finishSpeaking, startVoice, runAction, setChatContext } =
    useAgent();
  const insets = useSafeAreaInsets();
  // Words revealed so far, tied to the response they belong to.
  const [reveal, setReveal] = useState<{ id?: string; count: number }>({ count: 0 });

  const words = voice.response?.text.split(' ') ?? [];
  const revealed = reveal.id === voice.response?.id ? reveal.count : 0;
  const revealDone = voice.phase === 'responding' && revealed >= words.length;

  // Reveal the answer progressively, standing in for text-to-speech pacing.
  useEffect(() => {
    const response = voice.response;
    if (voice.phase !== 'responding' || !response) return;
    const total = response.text.split(' ').length;
    let count = 0;
    const timer = setInterval(() => {
      count += 1;
      setReveal({ id: response.id, count });
      if (count >= total) clearInterval(timer);
    }, REVEAL_MS_PER_WORD);
    return () => clearInterval(timer);
  }, [voice.phase, voice.response]);

  const phase = voice.phase;
  const copy = phaseCopy[phase];
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

  return (
    <Modal
      visible={overlayVisible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={cancelVoice}
    >
      <View style={[styles.screen, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.top}>
          {voice.context ? <ContextTag context={voice.context} /> : <View />}
        </View>

        <View style={styles.center}>
          <Pressable
            onPress={phase === 'listening' ? finishSpeaking : undefined}
            accessibilityRole={phase === 'listening' ? 'button' : undefined}
            accessibilityLabel={phase === 'listening' ? 'Done speaking' : undefined}
            disabled={phase !== 'listening'}
          >
            <JarvisOrb phase={phase} size={phase === 'responding' ? 96 : 136} />
          </Pressable>

          <AppText
            variant="label"
            caps
            tone={phase === 'listening' ? 'brand' : phase === 'error' ? 'warning' : 'secondary'}
            style={styles.phaseLabel}
            accessibilityLiveRegion="assertive"
          >
            {copy.label}
          </AppText>

          <View style={styles.wave}>
            <Waveform
              mode={
                phase === 'listening'
                  ? 'listening'
                  : phase === 'thinking'
                    ? 'thinking'
                    : phase === 'responding' && !revealDone
                      ? 'responding'
                      : 'idle'
              }
              height={phase === 'responding' ? 40 : 72}
            />
          </View>

          {phase === 'listening' || phase === 'thinking' ? (
            <View style={styles.transcriptBox}>
              {voice.transcript ? (
                <AppText variant="title" style={styles.transcript}>
                  “{voice.transcript}”
                </AppText>
              ) : (
                <AppText variant="body" tone="muted" style={styles.transcript}>
                  {copy.status}
                </AppText>
              )}
            </View>
          ) : null}

          {phase === 'responding' && voice.response ? (
            <ScrollView style={styles.answer} contentContainerStyle={{ paddingBottom: spacing.md }}>
              <AppText variant="small" tone="muted" style={{ marginBottom: spacing.sm }}>
                “{voice.transcript}”
              </AppText>
              <AppText variant="body" style={{ fontSize: 18, lineHeight: 27 }}>
                {words.slice(0, revealed).join(' ')}
              </AppText>
              {revealDone ? (
                <>
                  {voice.response.caution ? <CautionCallout text={voice.response.caution} /> : null}
                  <Citations citations={voice.response.citations} />
                  <AgentActions
                    actions={voice.response.actions}
                    onRun={runFromOverlay}
                    exclude={fromVideo ? ['RESUME_VIDEO'] : []}
                  />
                </>
              ) : null}
            </ScrollView>
          ) : null}

          {phase === 'error' ? (
            <AppText variant="body" tone="secondary" style={styles.transcript}>
              {voice.error ?? 'Jarvis is unavailable right now.'} Your question was not sent.
            </AppText>
          ) : null}
        </View>

        <View style={styles.actions}>
          {phase === 'listening' ? (
            <View style={styles.row}>
              <ActionButton label="Cancel" icon="close" variant="secondary" onPress={cancelVoice} style={styles.flex} />
              <ActionButton label="Done" icon="check" onPress={finishSpeaking} style={styles.flex} />
            </View>
          ) : null}
          {phase === 'thinking' ? (
            <ActionButton label="Cancel" icon="close" variant="secondary" onPress={cancelVoice} />
          ) : null}
          {phase === 'responding' ? (
            <>
              {fromVideo ? (
                <ActionButton
                  label="Resume video"
                  icon="play"
                  onPress={() => runFromOverlay({ type: 'RESUME_VIDEO' })}
                  disabled={!revealDone}
                />
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
          ) : null}
          {phase === 'error' ? (
            <View style={styles.row}>
              <ActionButton label="Close" variant="secondary" onPress={dismissVoice} style={styles.flex} />
              <ActionButton label="Try again" icon="microphone" onPress={() => startVoice(voice.context)} style={styles.flex} />
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'rgba(8,8,8,0.97)', paddingHorizontal: spacing.xl },
  top: { minHeight: 36, alignItems: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  phaseLabel: { fontSize: 15, letterSpacing: 4, marginTop: spacing.sm },
  wave: { alignSelf: 'stretch', alignItems: 'center', marginVertical: spacing.sm },
  transcriptBox: { minHeight: 96, justifyContent: 'center' },
  transcript: { textAlign: 'center', maxWidth: 340 },
  answer: { alignSelf: 'stretch', maxHeight: '52%', flexGrow: 0 },
  actions: { gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
});
