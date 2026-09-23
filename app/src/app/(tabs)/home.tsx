import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SosBanner } from '@/components/agent/SosBanner';
import { HomeHeader } from '@/components/home/HomeHeader';
import { QuickActions } from '@/components/home/QuickActions';
import { ShiftCard } from '@/components/home/ShiftCard';
import { NextTaskCard } from '@/components/tasks/NextTaskCard';
import { TaskCard } from '@/components/tasks/TaskCard';
import { currentTask, displayStatus } from '@/components/tasks/taskUtils';
import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { ConnectionBanner } from '@/components/ui/ConnectionBanner';
import { Icon } from '@/components/ui/Icon';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { StateView } from '@/components/ui/StateView';
import { useAsync } from '@/hooks/useAsync';
import { operatorService, taskService, videoService } from '@/services';
import { useAgent } from '@/state/AgentProvider';
import type { Task } from '@/types/domain';
import { colors, spacing } from '@/theme/tokens';

async function loadHome() {
  const [operator, shift, tasks, library] = await Promise.all([
    operatorService.getCurrentOperator(),
    operatorService.getCurrentShift(),
    taskService.getTodaysTasks(),
    videoService.getLibrary(),
  ]);
  const requiredLeft = Object.values(library.byCategory)
    .flat()
    .filter((v) => v.required && !v.completed).length;
  return { operator, shift, tasks, requiredLeft };
}

export default function HomeScreen() {
  const { data, error, loading, reload } = useAsync(loadHome, []);
  const { startVoice } = useAgent();

  // Refresh when coming back from a task so status changes show up.
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      reload();
    }, [reload]),
  );

  const openTask = useCallback((task: Task) => router.push({ pathname: '/task/[id]', params: { id: task.id } }), []);

  if (!data) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        {error ? (
          <StateView
            kind="error"
            title="Unable to load today's tasks"
            message="Check your connection. Your supervisor can also read out your task list."
            onRetry={reload}
          />
        ) : (
          <StateView kind="loading" title="Loading today's tasks…" />
        )}
      </SafeAreaView>
    );
  }

  const { operator, shift, tasks, requiredLeft } = data;
  const current = currentTask(tasks);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ConnectionBanner />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={reload}
            tintColor={colors.brand}
            colors={[colors.onBrand]}
            progressBackgroundColor={colors.brand}
          />
        }
      >
        <HomeHeader operator={operator} onJarvis={() => startVoice()} />
        <SosBanner />

        <ShiftCard shift={shift} machine={`Assigned: Cat 320D · ${operator.assignedMachineId}`} tasks={tasks} />

        {current ? (
          <NextTaskCard task={current} onOpen={openTask} />
        ) : tasks.length > 0 ? (
          <Card style={styles.allDone}>
            <Icon name="check-decagram" size={32} color={colors.success} />
            <View style={{ flex: 1 }}>
              <AppText variant="heading">All tasks done</AppText>
              <AppText variant="small" tone="secondary">
                Nice work. Complete your handover before the shift ends.
              </AppText>
            </View>
          </Card>
        ) : null}

        <QuickActions
          actions={[
            {
              label: 'Learn',
              hint: requiredLeft ? `${requiredLeft} required videos` : 'Training library',
              icon: 'school-outline',
              onPress: () => router.navigate('/learn'),
            },
            { label: 'Ask Jarvis', hint: 'Voice or text', icon: 'waveform', onPress: () => router.navigate('/agent') },
            { label: 'Photo check', hint: 'Ask about a machine', icon: 'camera-outline', onPress: () => router.push('/camera') },
          ]}
        />

        <View>
          <SectionHeader title="Today's tasks" icon="format-list-checks" meta={`${tasks.length}`} />
          {tasks.length === 0 ? (
            <Card>
              <StateView kind="empty" title="No tasks assigned today" message="Check with your supervisor." compact />
            </Card>
          ) : (
            <View style={styles.list}>
              {tasks.map((t) => (
                <TaskCard key={t.id} task={t} status={displayStatus(t, current)} onPress={openTask} />
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.xxxl },
  list: { gap: spacing.sm },
  allDone: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
