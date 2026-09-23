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
import { NoPublishedPlanError, operatorService, taskService, videoService } from '@/services';
import { useAgent } from '@/state/AgentProvider';
import { useSession, useWorkerId } from '@/state/SessionProvider';
import type { MyTasks, Task } from '@/types/domain';
import { colors, spacing } from '@/theme/tokens';
import { deriveShift } from '@/utils/schedule';

async function loadHome(workerId: string) {
  const [operator, plan, requiredLeft] = await Promise.all([
    operatorService.getOperator(workerId),
    // A missing plan is a normal state, not a failure of the whole screen.
    taskService.getMyTasks(workerId).catch((e: unknown) => {
      if (e instanceof NoPublishedPlanError) return null;
      throw e;
    }),
    // Training counts are a nice-to-have; never block Home on the Cat server.
    videoService
      .getLibrary()
      .then((lib) => Object.values(lib.byCategory).flat().filter((v) => v.required && !v.completed).length)
      .catch(() => null),
  ]);
  return { operator, plan, requiredLeft };
}

export default function HomeScreen() {
  const workerId = useWorkerId();
  const { signOut } = useSession();
  const { data, error, loading, reload } = useAsync(() => loadHome(workerId), [workerId]);
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
  const switchWorker = useCallback(() => {
    signOut();
    router.replace('/');
  }, [signOut]);

  if (!data) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <ConnectionBanner />
        {error ? (
          <StateView kind="error" title="Unable to load your tasks" message={error.message} onRetry={reload} />
        ) : (
          <StateView kind="loading" title="Loading today's tasks…" />
        )}
      </SafeAreaView>
    );
  }

  const { operator, plan, requiredLeft } = data;

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
        <HomeHeader operator={operator} onTalk={() => startVoice()} onSwitchWorker={switchWorker} />
        <SosBanner />

        {plan ? (
          <PlanSection plan={plan} onOpen={openTask} />
        ) : (
          <Card>
            <StateView
              kind="empty"
              title="No plan published yet"
              message="Your supervisor hasn't dispatched a schedule. Pull down to check again."
              onRetry={reload}
              compact
            />
          </Card>
        )}

        <QuickActions
          actions={[
            {
              label: 'Learn',
              hint: requiredLeft ? `${requiredLeft} required videos` : 'Training library',
              icon: 'school-outline',
              onPress: () => router.navigate('/learn'),
            },
            { label: 'Ask Cat', hint: 'Voice or text', icon: 'waveform', onPress: () => router.navigate('/agent') },
            { label: 'Photo check', hint: 'Ask about a machine', icon: 'camera-outline', onPress: () => router.push('/camera') },
          ]}
        />

        {plan ? <TaskList plan={plan} onOpen={openTask} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function PlanSection({ plan, onOpen }: { plan: MyTasks; onOpen: (t: Task) => void }) {
  const { tasks, scope } = plan;
  const current = currentTask(tasks);
  const shift = deriveShift(tasks);
  const machines = [...new Set(tasks.map((t) => t.machineId))];
  return (
    <>
      <ShiftCard
        shift={shift}
        subtitle={machines.length ? `Machines: ${machines.join(', ')}` : 'No machines assigned'}
        tasks={tasks}
        progressLabel={scope === 'today' ? 'Today' : 'Next up'}
      />
      {current ? (
        <NextTaskCard task={current} onOpen={onOpen} />
      ) : tasks.length > 0 ? (
        <Card style={styles.allDone}>
          <Icon name="check-decagram" size={32} color={colors.success} />
          <View style={{ flex: 1 }}>
            <AppText variant="heading">All tasks done</AppText>
            <AppText variant="small" tone="secondary">
              {"Nice work. Tell your supervisor you're free for more."}
            </AppText>
          </View>
        </Card>
      ) : null}
    </>
  );
}

function TaskList({ plan, onOpen }: { plan: MyTasks; onOpen: (t: Task) => void }) {
  const { tasks, scope } = plan;
  const current = currentTask(tasks);
  return (
    <View>
      <SectionHeader
        title={scope === 'today' ? "Today's tasks" : 'Your next tasks'}
        icon="format-list-checks"
        meta={`${tasks.length}`}
      />
      {scope === 'upcoming' && tasks.length ? (
        <AppText variant="small" tone="muted" style={{ marginBottom: spacing.sm }}>
          Nothing starts today. These are your next scheduled tasks.
        </AppText>
      ) : null}
      {tasks.length === 0 ? (
        <Card>
          <StateView kind="empty" title="No tasks assigned to you" message="You're not in the current plan. Check with your supervisor." compact />
        </Card>
      ) : (
        <View style={styles.list}>
          {tasks.map((t) => (
            <TaskCard key={t.id} task={t} status={displayStatus(t, current)} onPress={onOpen} />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.xxxl },
  list: { gap: spacing.sm },
  allDone: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
