import { router } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { FlatList, KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AgentInput } from '@/components/agent/AgentInput';
import { AgentMessage } from '@/components/agent/AgentMessage';
import { ContextTag } from '@/components/agent/ContextTag';
import { SosBanner } from '@/components/agent/SosBanner';
import { ThinkingIndicator } from '@/components/agent/ThinkingIndicator';
import { WakeWordBar } from '@/components/agent/WakeWordBar';
import { AppText } from '@/components/ui/AppText';
import { Chip } from '@/components/ui/Chip';
import { ConnectionBanner } from '@/components/ui/ConnectionBanner';
import { StateView } from '@/components/ui/StateView';
import { JarvisOrb } from '@/components/agent/JarvisOrb';
import { useConnectionState } from '@/hooks/useConnectionState';
import { useAgent } from '@/state/AgentProvider';
import type { AgentMessage as Message } from '@/types/agent';
import { colors, spacing } from '@/theme/tokens';

const SUGGESTIONS = [
  'What is my next task?',
  'How do I check the hydraulic pressure?',
  'Lockout steps for the pump',
  'Is this leak normal?',
];

export default function AgentScreen() {
  const agent = useAgent();
  const connection = useConnectionState();
  const listRef = useRef<FlatList<Message>>(null);
  const offline = connection === 'offline';

  const send = useCallback(
    (text: string) => {
      agent.sendText(text, agent.chatContext);
      agent.setChatContext(undefined);
    },
    [agent],
  );

  // Keep the newest message in view.
  useEffect(() => {
    const id = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(id);
  }, [agent.messages.length, agent.isThinking]);

  const renderItem = useCallback(
    ({ item }: { item: Message }) => (
      <AgentMessage message={item} onRunAction={agent.runAction} onRetry={agent.retryMessage} />
    ),
    [agent.runAction, agent.retryMessage],
  );

  let body;
  if (agent.historyLoading && agent.messages.length === 0) {
    body = <StateView kind="loading" title="Loading conversation…" />;
  } else if (agent.historyError && agent.messages.length === 0) {
    body = (
      <StateView
        kind="error"
        title="Unable to load conversation"
        message="You can still ask a new question."
        onRetry={agent.reloadHistory}
      />
    );
  } else if (agent.messages.length === 0) {
    body = (
      <ScrollView contentContainerStyle={styles.empty}>
        <JarvisOrb phase="idle" size={120} />
        <AppText variant="heading" style={{ textAlign: 'center' }}>
          Say “Jarvis” or tap the mic
        </AppText>
        <AppText variant="small" tone="secondary" style={{ textAlign: 'center', maxWidth: 280 }}>
          Ask about your tasks, a machine, or a step in a training video.
        </AppText>
      </ScrollView>
    );
  } else {
    body = (
      <FlatList
        ref={listRef}
        data={agent.messages}
        keyExtractor={(m) => m.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={Separator}
        ListHeaderComponent={
          <AppText variant="label" tone="muted" caps style={styles.dayLabel}>
            This shift
          </AppText>
        }
        ListFooterComponent={agent.isThinking ? <ThinkingIndicator /> : null}
        keyboardShouldPersistTaps="handled"
      />
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <AppText variant="title">Jarvis</AppText>
        <AppText variant="small" tone="secondary">
          Field assistant · voice or text
        </AppText>
      </View>
      <ConnectionBanner />
      <WakeWordBar />
      {agent.sos ? (
        <View style={styles.sos}>
          <SosBanner />
        </View>
      ) : null}

      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <View style={styles.flex}>{body}</View>

        {agent.chatContext ? (
          <View style={styles.context}>
            <AppText variant="small" tone="muted">
              Asking about
            </AppText>
            <ContextTag context={agent.chatContext} onClear={() => agent.setChatContext(undefined)} />
          </View>
        ) : null}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.suggestions}
          keyboardShouldPersistTaps="handled"
          style={styles.suggestionBar}
        >
          {SUGGESTIONS.map((s) => (
            <Chip key={s} label={s} onPress={() => send(s)} />
          ))}
        </ScrollView>

        <AgentInput
          onSend={send}
          onMic={() => agent.startVoice(agent.chatContext)}
          onCamera={() => router.push('/camera')}
          disabled={offline}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Separator() {
  return <View style={{ height: spacing.xl }} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  sos: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  list: { padding: spacing.lg, paddingBottom: spacing.xl },
  dayLabel: { textAlign: 'center', marginBottom: spacing.lg },
  empty: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xxl },
  context: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  suggestionBar: { flexGrow: 0 },
  suggestions: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
});
