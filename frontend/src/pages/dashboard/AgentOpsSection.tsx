import React, { type FormEvent } from "react";
import {
  Badge,
  Button,
  Card,
  Group,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconBolt,
  IconRobot,
  IconShieldCheck,
} from "@tabler/icons-react";
import type {
  AgentPolicyGateResult,
  AgentRun,
  EnvironmentDoctorReport,
} from "../../types";
import {
  darkFieldStyles,
  darkSelectStyles,
} from "./dashboardFieldStyles";

export type AgentProvider = "temporal" | "langgraph";

interface AgentRunFormState {
  issueId: string;
  provider: AgentProvider;
  role: string;
  requiresApproval: boolean;
  criteria: string;
}

interface AgentRunFormHandlers {
  onIssueIdChange: (value: string) => void;
  onProviderChange: (value: AgentProvider) => void;
  onRoleChange: (value: string) => void;
  onRequiresApprovalChange: (value: boolean) => void;
  onCriteriaChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  isSubmitting: boolean;
}

interface FaultsState {
  inviteCode: string;
  latencyMs: string;
  dropEvery: string;
}

interface FaultsHandlers {
  onInviteCodeChange: (value: string) => void;
  onLatencyMsChange: (value: string) => void;
  onDropEveryChange: (value: string) => void;
  onConfigure: (event: FormEvent) => void;
  onClear: () => void;
  isConfiguring: boolean;
  isClearing: boolean;
}

interface AgentRunsState {
  runs: AgentRun[];
  issueLabel: string;
  isIssueValid: boolean;
  transitionComment: string;
  selectedPolicyRunId: string | null;
  selectedPolicyResult?: AgentPolicyGateResult;
  isTransitioning: boolean;
  isExecutingReviewers: boolean;
}

interface AgentRunsHandlers {
  onRefresh: () => void;
  onTransitionCommentChange: (value: string) => void;
  onTransitionRun: (runId: string, targetState: string) => void;
  onExecuteReviewers: (runId: string) => void;
  onSelectPolicyRun: (runId: string) => void;
}

interface AgentOpsSectionProps {
  runForm: AgentRunFormState & AgentRunFormHandlers;
  environment: {
    report: EnvironmentDoctorReport | undefined;
    onRefresh: () => void;
  };
  faults: FaultsState & FaultsHandlers;
  agentRuns: AgentRunsState & AgentRunsHandlers;
}

/**
 * Agent operations dashboard section. Composes four feature cards
 * (orchestration form, environment doctor, realtime fault injector and the
 * runs/policy gate viewer). Receives all data and handlers via props so the
 * parent page keeps owning RTK mutations and event tracking.
 */
export function AgentOpsSection({
  runForm,
  environment,
  faults,
  agentRuns,
}: AgentOpsSectionProps) {
  return (
    <Stack>
      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
        <AgentRunFormCard {...runForm} />
        <EnvironmentDoctorCard
          report={environment.report}
          onRefresh={environment.onRefresh}
        />
      </SimpleGrid>
      <RealtimeFaultsCard {...faults} />
      <AgentRunsCard {...agentRuns} />
    </Stack>
  );
}

function AgentRunFormCard({
  issueId,
  provider,
  role,
  requiresApproval,
  criteria,
  onIssueIdChange,
  onProviderChange,
  onRoleChange,
  onRequiresApprovalChange,
  onCriteriaChange,
  onSubmit,
  isSubmitting,
}: AgentRunFormState & AgentRunFormHandlers) {
  return (
    <Card
      withBorder
      radius="lg"
      padding="lg"
      bg="#11151c"
      c="gray.1"
      style={{ borderColor: "#272b34" }}
    >
      <form onSubmit={onSubmit}>
        <Stack>
          <Group>
            <ThemeIcon color="gray" variant="light">
              <IconRobot size={15} />
            </ThemeIcon>
            <Title order={4}>Запуск агентного процесса</Title>
          </Group>
          <Text size="sm" c="gray.4">
            Запуск процесса оркестрации доступен только внутри задачи Linear.
          </Text>
          <TextInput
            label="Задача Linear"
            placeholder="LDT-76"
            value={issueId}
            onChange={(event) => onIssueIdChange(event.currentTarget.value)}
            styles={darkFieldStyles}
            required
          />
          <Select
            label="Провайдер процесса"
            value={provider}
            onChange={(value) =>
              onProviderChange((value as AgentProvider) ?? "temporal")
            }
            data={[
              { value: "temporal", label: "Temporal (основной)" },
              { value: "langgraph", label: "LangGraph (прототип)" },
            ]}
            styles={darkSelectStyles}
            labelProps={{ onClick: (e: React.MouseEvent) => e.preventDefault() }}
          />
          <TextInput
            label="Текущая роль"
            value={role}
            onChange={(event) => onRoleChange(event.currentTarget.value)}
            styles={darkFieldStyles}
          />
          <Switch
            label="Ручное подтверждение обязательно для финальных этапов"
            checked={requiresApproval}
            onChange={(event) =>
              onRequiresApprovalChange(event.currentTarget.checked)
            }
          />
          <Textarea
            label="Критерии приемки (по строкам)"
            minRows={5}
            value={criteria}
            onChange={(event) => onCriteriaChange(event.currentTarget.value)}
            styles={darkFieldStyles}
          />
          <Button type="submit" loading={isSubmitting}>
            Запустить процесс
          </Button>
        </Stack>
      </form>
    </Card>
  );
}

function statusBadgeColor(
  status: EnvironmentDoctorReport["status"] | undefined,
) {
  if (status === "PASS") return "teal";
  if (status === "WARN") return "yellow";
  if (status === "FAIL") return "red";
  return "red";
}

function EnvironmentDoctorCard({
  report,
  onRefresh,
}: {
  report: EnvironmentDoctorReport | undefined;
  onRefresh: () => void;
}) {
  return (
    <Card
      withBorder
      radius="lg"
      padding="lg"
      bg="#11151c"
      c="gray.1"
      style={{ borderColor: "#272b34" }}
    >
      <Stack>
        <Group justify="space-between">
          <Group>
            <ThemeIcon color="gray" variant="light">
              <IconShieldCheck size={15} />
            </ThemeIcon>
            <Title order={4}>Проверка окружения</Title>
          </Group>
          <Button variant="light" size="xs" onClick={onRefresh}>
            Обновить
          </Button>
        </Group>
        <Badge variant="light" color={statusBadgeColor(report?.status)}>
          Статус: {report?.status ?? "НЕИЗВЕСТНО"}
        </Badge>
        <Stack gap="xs">
          {(report?.checks ?? []).map((check) => (
            <Card
              key={check.key}
              withBorder
              radius="md"
              padding="xs"
              bg="#121720"
              style={{ borderColor: "#2a3039" }}
            >
              <Group justify="space-between" align="flex-start">
                <Stack gap={2}>
                  <Text size="sm" fw={700}>
                    {check.key}
                  </Text>
                  <Text size="xs" c="gray.4">
                    {check.message}
                  </Text>
                </Stack>
                <Badge
                  size="xs"
                  color={statusBadgeColor(check.status)}
                  variant="light"
                >
                  {check.status}
                </Badge>
              </Group>
            </Card>
          ))}
        </Stack>
      </Stack>
    </Card>
  );
}

function RealtimeFaultsCard({
  inviteCode,
  latencyMs,
  dropEvery,
  onInviteCodeChange,
  onLatencyMsChange,
  onDropEveryChange,
  onConfigure,
  onClear,
  isConfiguring,
  isClearing,
}: FaultsState & FaultsHandlers) {
  return (
    <Card
      withBorder
      radius="lg"
      padding="lg"
      bg="#11151c"
      c="gray.1"
      style={{ borderColor: "#272b34" }}
    >
      <form onSubmit={onConfigure}>
        <Stack>
          <Group>
            <ThemeIcon color="gray" variant="light">
              <IconBolt size={15} />
            </ThemeIcon>
            <Title order={4}>Инъекции сбоев realtime</Title>
          </Group>
          <Text size="sm" c="gray.4">
            Для тестов хаоса: искусственная задержка и периодический пропуск
            broadcast по комнате.
          </Text>
          <Group grow>
            <TextInput
              label="Код приглашения"
              placeholder="r-xxxxxxxx"
              value={inviteCode}
              onChange={(event) =>
                onInviteCodeChange(event.currentTarget.value)
              }
              styles={darkFieldStyles}
              required
            />
            <TextInput
              label="Задержка (мс)"
              value={latencyMs}
              onChange={(event) => onLatencyMsChange(event.currentTarget.value)}
              styles={darkFieldStyles}
            />
            <TextInput
              label="Пропускать каждый N-й"
              value={dropEvery}
              onChange={(event) => onDropEveryChange(event.currentTarget.value)}
              styles={darkFieldStyles}
            />
          </Group>
          <Group>
            <Button type="submit" variant="light" loading={isConfiguring}>
              Применить профиль
            </Button>
            <Button
              type="button"
              color="red"
              variant="outline"
              loading={isClearing}
              onClick={onClear}
            >
              Очистить профиль
            </Button>
          </Group>
        </Stack>
      </form>
    </Card>
  );
}

function AgentRunsCard({
  runs,
  issueLabel,
  isIssueValid,
  transitionComment,
  selectedPolicyRunId,
  selectedPolicyResult,
  isTransitioning,
  isExecutingReviewers,
  onRefresh,
  onTransitionCommentChange,
  onTransitionRun,
  onExecuteReviewers,
  onSelectPolicyRun,
}: AgentRunsState & AgentRunsHandlers) {
  return (
    <Card
      withBorder
      radius="lg"
      padding="lg"
      bg="#11151c"
      c="gray.1"
      style={{ borderColor: "#272b34" }}
    >
      <Stack>
        <Group justify="space-between">
          <Title order={4}>
            Запуски по задаче {isIssueValid ? issueLabel : "—"}
          </Title>
          <Button
            variant="light"
            size="xs"
            disabled={!isIssueValid}
            onClick={onRefresh}
          >
            Обновить список
          </Button>
        </Group>
        <TextInput
          label="Комментарий для передачи"
          value={transitionComment}
          onChange={(event) =>
            onTransitionCommentChange(event.currentTarget.value)
          }
          styles={darkFieldStyles}
        />
        <Stack gap="sm">
          {runs.map((run) => (
            <Card
              key={run.id}
              withBorder
              radius="md"
              padding="sm"
              bg="#121720"
              style={{ borderColor: "#2a3039" }}
            >
              <Stack gap="xs">
                <Group justify="space-between">
                  <Group gap="xs">
                    <Badge color="gray" variant="light">
                      {run.workflowProvider}
                    </Badge>
                    <Badge variant="outline" color="gray">
                      {run.currentState}
                    </Badge>
                    <Badge variant="outline" color="gray">
                      повтор {run.retryCount}/{run.maxRetries}
                    </Badge>
                  </Group>
                  <Text size="xs" c="gray.4">
                    трасса: {run.traceId}
                  </Text>
                </Group>
                <Text size="sm">Роль: {run.assignedRole || "—"}</Text>
                <Group gap="xs" wrap="wrap">
                  {run.allowedTransitions.map((targetState) => (
                    <Button
                      key={targetState}
                      size="xs"
                      variant="light"
                      onClick={() => onTransitionRun(run.id, targetState)}
                      loading={isTransitioning}
                    >
                      {targetState}
                    </Button>
                  ))}
                  <Button
                    size="xs"
                    color="gray"
                    variant="outline"
                    onClick={() => onSelectPolicyRun(run.id)}
                  >
                    Проверить гейты
                  </Button>
                  <Button
                    size="xs"
                    color="gray"
                    variant="outline"
                    onClick={() => onExecuteReviewers(run.id)}
                    loading={isExecutingReviewers}
                  >
                    Запустить ревьюеров
                  </Button>
                </Group>
              </Stack>
            </Card>
          ))}
          {isIssueValid && runs.length === 0 && (
            <Text size="sm" c="gray.4">
              Для задачи пока нет запущенных процессов.
            </Text>
          )}
        </Stack>

        {selectedPolicyRunId && selectedPolicyResult && (
          <Card
            withBorder
            radius="md"
            padding="sm"
            bg="#121720"
            style={{ borderColor: "#2a3039" }}
          >
            <Stack gap="xs">
              <Group justify="space-between">
                <Text fw={700}>Результат гейтов для {selectedPolicyRunId}</Text>
                <Badge
                  color={selectedPolicyResult.passed ? "teal" : "red"}
                  variant="light"
                >
                  {selectedPolicyResult.passed ? "ПРОЙДЕНО" : "НЕ ПРОЙДЕНО"}
                </Badge>
              </Group>
              {selectedPolicyResult.checks.map((check) => (
                <Text
                  key={check.id}
                  size="sm"
                  c={check.passed ? "teal.2" : "red.4"}
                >
                  {check.id}: {check.message}
                </Text>
              ))}
            </Stack>
          </Card>
        )}
      </Stack>
    </Card>
  );
}
