import React from "react";
import { Button as AntButton } from "antd";
import {
  Box,
  Button,
  Menu,
  Select,
  ThemeIcon,
  Tooltip,
} from "components/antd-compat";
import {
  IconChevronDown,
  IconCode,
  IconHelpCircle,
  IconHome2,
  IconUserCircle,
} from "components/antd-icons";
import { Link } from "react-router-dom";

import roomPageStyles from "../../pages/RoomPage.module.css";
import styles from "./TopBar.module.css";
import { ThemeToggleButton } from "../theme/ThemeToggleButton";
import {
  awarenessUserColors,
} from "./awarenessIdentity";
import { normalizeRoomLanguage } from "./roomLanguage";

/**
 * Список поддерживаемых языков для селекта в шапке комнаты.
 *
 * Source of truth для UI — синхронизирован с backend
 * `LanguageNormalizer` (см. `LanguageNormalizer.kt`).
 */
export const LANGUAGES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "nodejs", label: "Node JS" },
  { value: "python", label: "Python" },
  { value: "kotlin", label: "Kotlin" },
  { value: "java", label: "Java" },
  { value: "sql", label: "SQL" },
  /**
   * `plaintext` доступен в селекте языков комнаты на равных правах с
   * остальными — это позволяет вести интервью на чистом тексте
   * (например, вопросы по теории) без подсветки и парсинга синтаксиса.
   */
  { value: "plaintext", label: "Plain text" },
];

export type Participant = {
  sessionId: string;
  displayName: string;
  userId?: string | null;
  participantId?: string | null;
  role: "owner" | "interviewer" | "candidate";
  presenceStatus: "active" | "away";
  isAuthenticated?: boolean;
  isHr?: boolean;
  canBeGrantedInterviewerAccess?: boolean;
};

export function isEligibleHrParticipant(participant: Participant): boolean {
  return participant.isAuthenticated === true &&
    Boolean(participant.userId?.trim()) && participant.isHr === true;
}

export type HrAction = "assign" | "remove";

function getParticipantPresenceLabel(status: Participant["presenceStatus"]) {
  return status === "active" ? "В фокусе" : "Вне фокуса";
}

export type TopBarProps = {
  roomTitle: string;
  interviewListPath: string;
  authToken: string | null;
  connected: boolean;
  participants: Participant[];
  showParticipants: boolean;
  showLanguageControl: boolean;
  languageDisabled?: boolean;
  currentLanguage: string;
  onLanguageChange: (value: string | null) => void;
  canGrantAccess: boolean;
  canAssignHr: boolean;
  pendingHrActions: ReadonlyMap<string, HrAction>;
  onAssignHr: (participant: Participant) => void;
  onRemoveHr: (participant: Participant) => void;
  onToggleInterviewerRole: (participant: Participant) => void;
};

/**
 * Шапка комнаты: бренд, инлайновый список участников, селект языка
 * и кнопки навигации (Кабинет / Главная).
 *
 * Раньше жил inline в `RoomPage.tsx` (~180 строк) — выделен отдельно,
 * чтобы изоляция UI/state была явной: `TopBar` чистый и зависит
 * только от пропсов.
 */
export function TopBar({
  roomTitle,
  interviewListPath,
  authToken,
  connected,
  participants,
  showParticipants,
  showLanguageControl,
  currentLanguage,
  languageDisabled = false,
  onLanguageChange,
  canGrantAccess,
  canAssignHr,
  pendingHrActions,
  onAssignHr,
  onRemoveHr,
  onToggleInterviewerRole,
}: TopBarProps) {
  const [openParticipantMenus, setOpenParticipantMenus] = React.useState<Record<string, boolean>>({});
  const hasHrControls = canAssignHr && participants.some(
    (participant) => participant.role !== "owner" && isEligibleHrParticipant(participant),
  );
  const hasOrdinaryControls = canGrantAccess && participants.some(
    (participant) => participant.role !== "owner" &&
      (participant.canBeGrantedInterviewerAccess ?? true),
  );
  const participantHelp = "Нажмите на участника, чтобы открыть доступные действия";
  return (
    <header className={roomPageStyles.topBar}>
      <Box className={roomPageStyles.topInner}>
        <Box className={roomPageStyles.brand}>
          <ThemeIcon size={26} variant="light" color="gray">
            <IconCode size={14} />
          </ThemeIcon>
          <div className={roomPageStyles.brandTitle}>{roomTitle}</div>
        </Box>

        {showParticipants ? (
          <Box className={roomPageStyles.participantsHost}>
            <div
              className={roomPageStyles.participantsInline}
              aria-label="Участники комнаты"
            >
              {participants.map((participant) => {
                const presenceLabel = getParticipantPresenceLabel(
                  participant.presenceStatus,
                );
                const eligibleHr = isEligibleHrParticipant(participant);
                const isInterviewer = participant.role === "interviewer";
                const canChangeInterviewerRole =
                  canGrantAccess &&
                  participant.role !== "owner" &&
                  !(eligibleHr && isInterviewer) &&
                  (participant.canBeGrantedInterviewerAccess ?? true);
                const showHrAction = canAssignHr && eligibleHr && participant.role !== "owner";
                const pendingHrAction = pendingHrActions.get(participant.userId?.trim() ?? "");
                const hrPending = pendingHrAction !== undefined;
                const canOpenMenu = canChangeInterviewerRole || showHrAction;
                const menuActionLabel = isInterviewer
                  ? "Снять роль интервьюера"
                  : "Назначить интервьюером";
                const hrActionLabel = pendingHrAction === "remove" ? "Снимаем роль нанимающего…" :
                  pendingHrAction === "assign" ? "Назначаем нанимающего…" :
                  isInterviewer ? "Снять роль нанимающего" : "Назначить нанимающим";
                const { color: cursorColor, colorLight: cursorColorLight } =
                  awarenessUserColors(participant.sessionId);
                const menuOpened = openParticipantMenus[participant.sessionId] === true;
                const participantCard = (
                  <span className={roomPageStyles.participantNameRow}>
                    <span className={roomPageStyles.participantName}>
                      {participant.displayName}
                    </span>
                    {participant.role === "owner" ? (
                      <span className={roomPageStyles.participantHrBadge} aria-label="Владелец">Владелец</span>
                    ) : isInterviewer && eligibleHr ? (
                      <span
                        className={roomPageStyles.participantHrBadge}
                        aria-label="Нанимающий"
                        title="Нанимающий"
                      >
                        НМ
                      </span>
                    ) : isInterviewer ? (
                      <span
                        className={roomPageStyles.participantInterviewerStar}
                        aria-label="Интервьюер"
                        title="Интервьюер"
                      >
                        *
                      </span>
                    ) : null}
                    {canOpenMenu ? (
                      <IconChevronDown
                        size={11}
                        stroke={2.4}
                        className={roomPageStyles.participantMenuCaret}
                        aria-hidden="true"
                      />
                    ) : null}
                  </span>
                );
                const participantStyle = {
                  "--participant-role-color": cursorColor,
                  "--participant-cursor-color": cursorColor,
                  "--participant-cursor-color-light": cursorColorLight,
                } as React.CSSProperties;

                if (!canOpenMenu) {
                  return (
                    <div
                      key={participant.sessionId}
                      className={roomPageStyles.participantCard}
                      data-presence={participant.presenceStatus}
                      data-testid={`participant-badge-${participant.presenceStatus}`}
                      style={participantStyle}
                      title={presenceLabel}
                    >
                      {participantCard}
                    </div>
                  );
                }

                return (
                  <Menu
                    key={participant.sessionId}
                    trigger="click"
                    opened={menuOpened}
                    onChange={(opened: boolean) => setOpenParticipantMenus((current) => ({
                      ...current,
                      [participant.sessionId]: opened,
                    }))}
                    withinPortal
                    position="bottom"
                    shadow="md"
                    className={styles.roleMenu}
                    offset={8}
                  >
                    <Menu.Target>
                      <button
                        type="button"
                        className={`${roomPageStyles.participantCard} ${roomPageStyles.participantCardButton} app-header-control`}
                        data-presence={participant.presenceStatus}
                        data-testid={`participant-badge-${participant.presenceStatus}`}
                        style={participantStyle}
                        aria-label={`${participant.displayName}, ${presenceLabel}. Открыть доступные действия участника`}
                        aria-haspopup="menu"
                        aria-expanded={menuOpened}
                      >
                        {participantCard}
                      </button>
                    </Menu.Target>
                    <Menu.Dropdown>
                      {showHrAction ? (
                        <Menu.Item
                          disabled={hrPending}
                          onClick={() => isInterviewer ? onRemoveHr(participant) : onAssignHr(participant)}
                        >
                          {hrActionLabel}
                        </Menu.Item>
                      ) : null}
                      {canChangeInterviewerRole ? (
                        <Menu.Item
                          disabled={hrPending}
                          onClick={() => onToggleInterviewerRole(participant)}
                        >
                          {menuActionLabel}
                        </Menu.Item>
                      ) : null}
                    </Menu.Dropdown>
                  </Menu>
                );
              })}

              {hasOrdinaryControls || hasHrControls ? (
                <Tooltip label={participantHelp} trigger={["hover", "focus"]} position="bottom" withArrow styles={{ root: { pointerEvents: "none" }, container: { pointerEvents: "none" } }}>
                <button
                  type="button"
                  className={`${roomPageStyles.participantsHelpHint} app-header-control`}
                  style={{ "--header-control-color": "var(--app-muted)", "--header-control-border": "transparent" } as React.CSSProperties}
                  aria-label="Действия участников"
                  data-testid="participants-help-hint"
                >
                  <IconHelpCircle size={14} stroke={1.8} aria-hidden="true" />
                </button>
                </Tooltip>
              ) : null}
            </div>
          </Box>
        ) : (
          <Box className={roomPageStyles.participantsHost} />
        )}

        <div className={roomPageStyles.topActions}>
          {showLanguageControl ? (
            <div className={roomPageStyles.topLanguageControl}>
              <Select
                id="room-language-select"
                disabled={languageDisabled}
                placeholder="Выберите язык"
                size="xs"
                data={LANGUAGES.slice() as Array<{ value: string; label: string }>}
                value={normalizeRoomLanguage(currentLanguage)}
                onChange={(value) =>
                  onLanguageChange(value ? normalizeRoomLanguage(value) : null)
                }
                className={roomPageStyles.topLanguageSelect}
                classNames={{
                  input: roomPageStyles.topLanguageInput,
                  dropdown: roomPageStyles.topLanguageDropdown,
                  option: roomPageStyles.topLanguageOption,
                }}
                aria-label="Язык комнаты"
                allowDeselect={false}
                comboboxProps={{ withinPortal: false }}
              />
            </div>
          ) : null}
          <div className={roomPageStyles.topActionButtons}>
            {/*
             * Connection state used to be a bright "Подключено" badge, which
             * pulled focus away from the actual navigation buttons even
             * though it's just a passive status. We now render it as a tiny
             * LED-style dot with a tooltip — visible enough to debug, quiet
             * enough to ignore in steady state.
             */}
            <Tooltip
              label={connected ? "Соединение установлено" : "Соединение восстанавливается"}
              position="bottom"
              withArrow
            >
              <span
                className={roomPageStyles.connectionDot}
                data-state={connected ? "online" : "offline"}
                role="status"
                aria-live="polite"
                aria-label={connected ? "Соединение установлено" : "Соединение восстанавливается"}
                data-testid="room-connection-status"
              />
            </Tooltip>
            <Button
              component={Link}
              to={authToken ? interviewListPath : "/login"}
              className={`app-header-control ${styles.returnAction}`}
              aria-label="Вернуться к списку интервью"
              title="Вернуться к списку интервью"
              size="sm"
              variant="outline"
              color="gray"
              leftSection={<IconUserCircle size={14} />}
            >
              Вернуться к списку интервью
            </Button>
            <Button
              component={Link}
              to="/"
              className="app-header-control"
              size="sm"
              variant="outline"
              color="gray"
              leftSection={<IconHome2 size={14} />}
            >
              Главная
            </Button>
            <ThemeToggleButton />
          </div>
        </div>
      </Box>
    </header>
  );
}
