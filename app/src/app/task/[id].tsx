import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SafetyChecklist } from '@/components/tasks/SafetyChecklist';
import { TaskSteps } from '@/components/tasks/TaskSteps';
import { VideoCard } from '@/components/video/VideoCard';
import { VideoThumbnail } from '@/components/video/VideoThumbnail';
import { ActionButton } from '@/components/ui/ActionButton';
import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { StateView } from '@/components/ui/StateView';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useAgentScreenContext } from '@/hooks/useAgentScreenContext';
import { useAsync } from '@/hooks/useAsync';
import { useSafetyChecks } from '@/hooks/useSafetyChecks';
import { taskService, videoService } from '@/services';
import { useAgent } from '@/state/AgentProvider';
import { useWorkerId } from '@/state/SessionProvider';
import type { Task, TaskStatus, TrainingVideo } from '@/types/domain';
import { colors, spacing } from '@/theme/tokens';
import { formatMinutes, formatVideoLength } from '@/utils/format';
import { dayLabel } from '@/utils/schedule';

async function loadTask(workerId: string, id: string) {
  const task = await taskService.getTask(workerId, id);
  const ids = [task.tutorialVideoId, ...task.relatedVideoIds].filter((v): v is string => Boolean(v));
  // Training links are optional: a Cat server outage must not hide the task.
  const videos = ids.length ? await videoService.getVideos(ids).catch(() => []) : [];
  return {
    task,
    tutorial: videos.find((v) => v.id === task.tutorialVideoId),
    related: task.relatedVideoIds
      .map((rid) => videos.find((v) => v.id === rid))
      .filter((v): v is TrainingVideo => Boolean(v)),
  };
}

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const workerId = useWorkerId();
  const { data, error, reload } = useAsync(() => loadTask(workerId, id), [workerId, id]);
  const [override, setOverride] = useState<Task>();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const { checked, toggle } = useSafetyChecks(id);
  const { startVoice } = useAgent();

  const task = override ?? data?.task;
  useAgentScreenContext(task ? { taskId: task.id, taskTitle: task.title } : undefined);

  const openVideo = useCallback(
    (v: TrainingVideo) =>
      router.push({ pathname: '/video/[id]', params: { id: v.id, taskId: task?.id } }),
    [task?.id],
  );

  const setStatus = async (status: TaskStatus) => {
    if (!task) return;
    setSaving(true);
    setSaveError(undefined);
    try {
      setOverride(await taskService.updateTaskStatus(task.id, status));
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not update the task.');
    } finally {
      setSaving(false);
    }
  };

  if (!data || !task) {
    return (
      <SafeAreaView style={styles.screen}>
        <ScreenHeader label="Task" />
        {error ? (
          <StateView kind="error" title="Unable to load task" message={error.message} onRetry={reload} />
        ) : (
          <StateView kind="loading" title="Loading task…" />
        )}
      </SafeAreaView>
    );
  }

  const { tutorial, related } = data;
  const started = task.status === 'in_progress' || task.status === 'completed';
  const plannedDay = task.scheduledStartAt ? dayLabel(new Date(task.scheduledStartAt)) : undefined;
  const remaining = task.safetyChecklist.filter((i) => !checked.has(i.id)).length;
  const askAboutTask = () => startVoice({ taskId: task.id, taskTitle: task.title });

  return (
    <SafeAreaView style={styles.screen}>
      <ScreenHeader
        label={task.id}
        right={<IconButton icon="microphone" label="Ask Cat about this task" tone="plain" onPress={askAboutTask} />}
      />
      <ScrollView contentContainerStyle={styles.content}>
        {/* Summary */}
        <View style={styles.summary}>
          <StatusBadge status={task.status} />
          <AppText variant="display" caps accessibilityRole="header">
            {task.title}
          </AppText>
          <View style={styles.facts}>
            <Fact icon="cog-outline" label="Machine" value={task.machine} />
            <Fact icon="map-marker-outline" label="Location" value={task.location} />
            <Fact icon="clock-outline" label="Estimated time" value={formatMinutes(task.estimatedMinutes)} mono />
            <Fact
              icon="calendar-clock"
              label="Planned start"
              value={plannedDay && plannedDay !== 'Today' ? `${task.scheduledStart} · ${plannedDay}` : task.scheduledStart}
              mono
            />
            {task.weather ? (
              <Fact icon="weather-partly-cloudy" label="Conditions" value={`${task.weather}${task.shiftType ? ` · ${task.shiftType} shift` : ''}`} />
            ) : null}
            {task.parallel && task.workSharePct !== undefined ? (
              <Fact icon="account-group-outline" label="Your share" value={`≈ ${Math.round(task.workSharePct)}% of a shared task`} />
            ) : null}
            {task.taskCode ? <Fact icon="pound" label="Task" value={task.taskCode} mono /> : null}
          </View>
        </View>

        <Card>
          <SectionHeader title="About this task" icon="clipboard-text-outline" />
          <AppText variant="body" tone="secondary">
            {task.description}
          </AppText>
        </Card>

        {/* 1. Required safety */}
        <SafetyChecklist items={task.safetyChecklist} checked={checked} onToggle={toggle} locked={started} />

        {/* 2. Tutorial (learning) */}
        {tutorial ? (
          <View>
            <SectionHeader title="Tutorial" icon="play-box-outline" />
            <Card style={{ gap: spacing.md }}>
              <VideoThumbnail video={tutorial} height={172} />
              <View>
                <AppText variant="heading">{tutorial.title}</AppText>
                <AppText variant="small" tone="muted">
                  {formatVideoLength(tutorial.durationSeconds)} · {tutorial.chapters.length} chapters
                  {tutorial.progressSeconds > 0 && !tutorial.completed ? ' · Resume where you left off' : ''}
                </AppText>
              </View>
              <ActionButton
                label={tutorial.progressSeconds > 0 && !tutorial.completed ? 'Resume tutorial' : 'Watch tutorial'}
                icon="play"
                variant="secondary"
                onPress={() => openVideo(tutorial)}
              />
            </Card>
          </View>
        ) : null}

        {/* 3. Actual work instructions */}
        <View>
          <SectionHeader title="Task steps" icon="format-list-numbered" meta={`${task.steps.length}`} />
          <Card>
            <TaskSteps steps={task.steps} />
          </Card>
        </View>

        {/* 4. Further learning */}
        {related.length ? (
          <View>
            <SectionHeader title="Related training" icon="school-outline" />
            <View style={{ gap: spacing.sm }}>
              {related.map((v) => (
                <VideoCard key={v.id} video={v} onPress={openVideo} />
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>

      {/* Sticky primary action */}
      <View style={styles.footer}>
        {saveError ? (
          <AppText variant="small" tone="warning" style={{ textAlign: 'center' }} accessibilityLiveRegion="polite">
            {saveError} Try again.
          </AppText>
        ) : null}
        {task.status === 'completed' ? (
          <View style={styles.doneRow} accessibilityLiveRegion="polite">
            <Icon name="check-circle" size={22} color={colors.success} />
            <AppText variant="bodyStrong" tone="success">
              Completed{task.completedAt ? ` at ${task.completedAt}` : ''}
            </AppText>
          </View>
        ) : task.status === 'in_progress' ? (
          <ActionButton label="Mark task complete" icon="check" loading={saving} onPress={() => setStatus('completed')} />
        ) : task.status === 'blocked' || task.status === 'cancelled' ? (
          <ActionButton
            label={task.status === 'cancelled' ? 'Cancelled' : 'Blocked'}
            hint={task.blockedReason}
            disabled
            onPress={() => undefined}
          />
        ) : (
          <ActionButton
            label="Start task"
            icon="arrow-right"
            disabled={remaining > 0}
            loading={saving}
            hint={remaining > 0 ? `Complete safety check · ${remaining} left` : undefined}
            onPress={() => setStatus('in_progress')}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

function Fact({ icon, label, value, mono }: { icon: IconName; label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.fact} accessibilityLabel={`${label}: ${value}`}>
      <Icon name={icon} size={18} color={colors.textMuted} />
      <AppText variant="small" tone="muted" style={styles.factLabel}>
        {label}
      </AppText>
      <AppText variant={mono ? 'mono' : 'bodyStrong'} style={{ flex: 1 }}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.xxxl },
  summary: { gap: spacing.sm },
  facts: { gap: spacing.sm, marginTop: spacing.xs },
  fact: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  factLabel: { width: 112 },
  footer: {
    padding: spacing.md,
    gap: spacing.xs,
    backgroundColor: colors.panel,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  doneRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, minHeight: 56 },
});
