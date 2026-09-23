import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraPreview } from '@/components/camera/CameraPreview';
import { ImageAnalysisResult } from '@/components/camera/ImageAnalysisResult';
import { ActionButton } from '@/components/ui/ActionButton';
import { AppText } from '@/components/ui/AppText';
import { Chip } from '@/components/ui/Chip';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { StateView } from '@/components/ui/StateView';
import { mediaService } from '@/services';
import { useAgent } from '@/state/AgentProvider';
import type { AgentContext, ImageAnalysis } from '@/types/agent';
import { colors, fonts, radius, spacing, touch } from '@/theme/tokens';
import { makeId, nowIso } from '@/utils/format';

const QUICK_QUESTIONS = ['What is happening here?', 'Is this a leak?', 'Is this part damaged?', 'Is it safe to run?'];

type Phase =
  | { kind: 'compose' }
  | { kind: 'analyzing' }
  | { kind: 'result'; analysis: ImageAnalysis; question: string }
  | { kind: 'error'; message: string };

export default function CameraPreviewScreen() {
  const { uri, taskId } = useLocalSearchParams<{ uri: string; taskId?: string }>();
  const [question, setQuestion] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'compose' });
  const { appendMessages } = useAgent();

  if (!uri) {
    return (
      <SafeAreaView style={styles.screen}>
        <ScreenHeader label="Photo check" />
        <StateView kind="empty" title="No photo selected" onRetry={() => router.replace('/camera')} />
      </SafeAreaView>
    );
  }

  const context: AgentContext = { imageUri: uri, taskId };
  const asked = question.trim() || 'What is happening here?';

  const analyze = async () => {
    setPhase({ kind: 'analyzing' });
    try {
      const analysis = await mediaService.analyzeMachineryPhoto({ imageUri: uri, question: asked, context });
      setPhase({ kind: 'result', analysis, question: asked });
    } catch (e) {
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : 'Image analysis failed.' });
    }
  };

  const continueInChat = (analysis: ImageAnalysis, q: string) => {
    appendMessages([
      { id: makeId('MSG'), role: 'operator', text: q, createdAt: nowIso(), mode: 'image', status: 'sent', context },
      {
        id: analysis.id,
        role: 'agent',
        text: `${analysis.summary}\n\n${analysis.findings.map((f) => `• ${f.label}`).join('\n')}\n\n${analysis.recommendedAction}`,
        caution: analysis.limitations,
        createdAt: analysis.createdAt,
        mode: 'image',
        status: 'sent',
        citations: [],
        actions: [{ type: 'CONTACT_SUPERVISOR' }],
      },
    ]);
    router.dismissAll();
    router.navigate('/agent');
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScreenHeader label="Photo check" />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <AppText variant="label" tone="secondary" caps accessibilityRole="header">
            Ask about machinery
          </AppText>
          <CameraPreview uri={uri} analyzing={phase.kind === 'analyzing'} />

          {phase.kind === 'compose' ? (
            <>
              <View style={{ gap: spacing.sm }}>
                <AppText variant="bodyStrong">Your question (optional)</AppText>
                <TextInput
                  value={question}
                  onChangeText={setQuestion}
                  placeholder="What is happening here?"
                  placeholderTextColor={colors.textMuted}
                  style={styles.input}
                  multiline
                  accessibilityLabel="Question about the photo"
                  cursorColor={colors.brand}
                />
                <View style={styles.chips}>
                  {QUICK_QUESTIONS.map((q) => (
                    <Chip key={q} label={q} selected={question === q} onPress={() => setQuestion(q)} />
                  ))}
                </View>
              </View>
              <ActionButton label="Ask Jarvis" icon="image-search-outline" onPress={analyze} />
              <ActionButton label="Retake photo" icon="camera-retake-outline" variant="secondary" onPress={() => router.back()} />
            </>
          ) : null}

          {phase.kind === 'analyzing' ? (
            <AppText variant="small" tone="secondary" style={{ textAlign: 'center' }}>
              “{asked}”
            </AppText>
          ) : null}

          {phase.kind === 'error' ? (
            <StateView kind="error" title="Image analysis unavailable" message={phase.message} onRetry={analyze} compact />
          ) : null}

          {phase.kind === 'result' ? (
            <>
              <AppText variant="small" tone="muted">
                You asked: “{phase.question}”
              </AppText>
              <ImageAnalysisResult analysis={phase.analysis} />
              <ActionButton
                label="Continue in chat"
                icon="message-text-outline"
                onPress={() => continueInChat(phase.analysis, phase.question)}
              />
              <ActionButton
                label="Take another photo"
                icon="camera-outline"
                variant="secondary"
                onPress={() => router.back()}
              />
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxxl },
  input: {
    minHeight: touch.large,
    maxHeight: 120,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.inset,
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 16,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
