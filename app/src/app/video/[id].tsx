import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChapterList } from '@/components/video/ChapterList';
import { VideoPlayer, chapterAt } from '@/components/video/VideoPlayer';
import { categoryMeta, progressLabel } from '@/components/video/videoMeta';
import { ActionButton } from '@/components/ui/ActionButton';
import { AppText } from '@/components/ui/AppText';
import { Icon } from '@/components/ui/Icon';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { StateView } from '@/components/ui/StateView';
import { useAgentScreenContext } from '@/hooks/useAgentScreenContext';
import { useAsync } from '@/hooks/useAsync';
import { useMockPlayback } from '@/hooks/useMockPlayback';
import { videoService } from '@/services';
import { useAgent } from '@/state/AgentProvider';
import { agentActionBus } from '@/state/agentActionBus';
import type { AgentContext } from '@/types/agent';
import type { TrainingVideo } from '@/types/domain';
import { colors, radius, spacing } from '@/theme/tokens';
import { formatClock, formatVideoLength } from '@/utils/format';

export default function VideoScreen() {
  const { id, t, taskId } = useLocalSearchParams<{ id: string; t?: string; taskId?: string }>();
  const { data: video, error, reload } = useAsync(() => videoService.getVideo(id), [id]);

  if (!video) {
    return (
      <SafeAreaView style={styles.screen}>
        <ScreenHeader label="Training video" />
        {error ? (
          <StateView kind="error" title="Unable to load video" message={error.message} onRetry={reload} />
        ) : (
          <StateView kind="loading" title="Loading video…" />
        )}
      </SafeAreaView>
    );
  }

  const start = t !== undefined ? Number(t) : video.completed ? 0 : video.progressSeconds;
  return <VideoContent video={video} startAt={Number.isFinite(start) ? start : 0} taskId={taskId} />;
}

function VideoContent({ video, startAt, taskId }: { video: TrainingVideo; startAt: number; taskId?: string }) {
  const playback = useMockPlayback(video.durationSeconds, startAt);
  const { startVoice, overlayVisible, setChatContext } = useAgent();
  const { chapter, index } = chapterAt(video.chapters, playback.position);
  const focused = useRef(false);

  const context: AgentContext = {
    taskId,
    videoId: video.id,
    videoTitle: video.title,
    timestamp: Math.floor(playback.position),
    chapterTitle: chapter?.title,
  };
  // Keeps the wake word aware of the current moment in the video.
  useAgentScreenContext(context);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      return () => {
        focused.current = false;
      };
    }, []),
  );

  // Talking to Jarvis pauses the video, however the overlay was opened.
  const { pause, play } = playback;
  useEffect(() => {
    if (overlayVisible) pause();
  }, [overlayVisible, pause]);

  // Agent-issued playback controls.
  useEffect(
    () =>
      agentActionBus.subscribe((action) => {
        if (!focused.current) return;
        if (action.type === 'PAUSE_VIDEO') pause();
        if (action.type === 'RESUME_VIDEO') play();
      }),
    [pause, play],
  );

  // Save progress when paused and on leave.
  const positionRef = useRef(playback.position);
  useEffect(() => {
    positionRef.current = playback.position;
  }, [playback.position]);
  useEffect(() => {
    if (playback.status !== 'playing') videoService.saveProgress(video.id, positionRef.current);
  }, [playback.status, video.id]);
  useEffect(() => () => void videoService.saveProgress(video.id, positionRef.current), [video.id]);

  const paused = playback.status !== 'playing';
  const cat = categoryMeta[video.category];

  return (
    <SafeAreaView style={styles.screen}>
      <ScreenHeader label={taskId ? `Tutorial · ${taskId}` : 'Training video'} />
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxxl }}>
        <VideoPlayer
          videoId={video.id}
          title={video.title}
          durationSeconds={video.durationSeconds}
          videoUrl={video.videoUrl}
          taskId={taskId}
          chapters={video.chapters}
          machineType={video.machineType}
          playback={playback}
        />

        <View style={styles.body}>
          {paused ? (
            <View style={styles.askCard} accessibilityLiveRegion="polite">
              <View style={styles.askHead}>
                <Icon name="pause-circle-outline" size={20} color={colors.brand} />
                <AppText variant="small" tone="secondary" style={{ flex: 1 }}>
                  Paused at{' '}
                  <AppText variant="mono" tone="primary">
                    {formatClock(playback.position)}
                  </AppText>
                  {chapter ? ` · ${chapter.title}` : ''}
                </AppText>
              </View>
              <ActionButton
                label="Ask Jarvis about this"
                icon="microphone"
                onPress={() => startVoice(context)}
                accessibilityHint="Opens the voice assistant with this moment of the video as context"
              />
              <ActionButton
                label="Type a question instead"
                icon="keyboard-outline"
                variant="ghost"
                size="md"
                onPress={() => {
                  setChatContext(context);
                  router.navigate('/agent');
                }}
              />
            </View>
          ) : null}

          <View style={{ gap: spacing.xs }}>
            <AppText variant="title" accessibilityRole="header">
              {video.title}
            </AppText>
            <View style={styles.meta}>
              <Icon name={cat.icon} size={16} color={colors.textMuted} />
              <AppText variant="small" tone="muted">
                {cat.label} · {formatVideoLength(video.durationSeconds)} · {progressLabel(video)}
              </AppText>
            </View>
            <AppText variant="body" tone="secondary" style={{ marginTop: spacing.xs }}>
              {video.summary}
            </AppText>
          </View>

          {video.chapters.length > 1 ? (
            <View>
              <SectionHeader title="Chapters" icon="format-list-numbered" meta={`${video.chapters.length}`} />
              <ChapterList chapters={video.chapters} currentIndex={index} onSelect={(c) => playback.seek(c.startsAt)} />
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  body: { padding: spacing.lg, gap: spacing.xl },
  askCard: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brandBorder,
    backgroundColor: colors.brandSubtle,
  },
  askHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});
