import React from "react";
import {
  Box,
  Button,
  Menu,
  Select,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconChevronDown,
  IconCode,
  IconHelpCircle,
  IconHome2,
  IconUserCircle,
} from "@tabler/icons-react";
import { Link } from "react-router-dom";

import roomPageStyles from "../../pages/RoomPage.module.css";
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
  authToken: string | null;
  connected: boolean;
  participants: Participant[];
  showParticipants: boolean;
  showLanguageControl: boolean;
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
  authToken,
  connected,
  participants,
  showParticipants,
  showLanguageControl,
  currentLanguage,
  onLanguageChange,
  canGrantAccess,
  canAssignHr,
  pendingHrActions,
  onAssignHr,
  onRemoveHr,
  onToggleInterviewerRole,
}: TopBarProps) {
  const hasHrControls = canAssignHr && participants.some(
    (participant) => participant.role !== "owner" && isEligibleHrParticipant(participant),
  );
  const hasOrdinaryControls = canGrantAccess && participants.some(
    (participant) => participant.role !== "owner" &&
      (participant.canBeGrantedInterviewerAccess ?? true),
  );
  const participantHelp = hasHrControls
    ? `Кликните по участнику, чтобы назначить или снять роль нанимающего${hasOrdinaryControls ? ", изменить роль интервьюера" : ""}`
    : "Кликните по нику участника, чтобы назначить или снять роль интервьюера";
  return (
    <Box className={roomPageStyles.topBar}>
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
                const menuHint = [
                  ...(showHrAction ? [hrActionLabel] : []),
                  ...(canChangeInterviewerRole ? [menuActionLabel] : []),
                ].join(". ");
                const { color: cursorColor, colorLight: cursorColorLight } =
                  awarenessUserColors(participant.sessionId);
                const participantCard = (
                  <span className={roomPageStyles.participantNameRow}>
                    <span className={roomPageStyles.participantName}>
                      {participant.displayName}
                    </span>
                    {isInterviewer && eligibleHr ? (
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
                    withinPortal
                    position="bottom"
                    shadow="md"
                    offset={8}
                  >
                    <Menu.Target>
                      <Tooltip
                        label={menuHint}
                        withArrow
                        position="bottom"
                        openDelay={250}
                        closeDelay={50}
                      >
                        <button
                          type="button"
                          className={`${roomPageStyles.participantCard} ${roomPageStyles.participantCardButton}`}
                          data-presence={participant.presenceStatus}
                          data-testid={`participant-badge-${participant.presenceStatus}`}
                          style={participantStyle}
                          aria-label={`${participant.displayName}, ${presenceLabel}. ${menuHint}`}
                          aria-haspopup="menu"
                        >
                          {participantCard}
                        </button>
                      </Tooltip>
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
                <Tooltip
                  label={participantHelp}
                  withArrow
                  multiline
                  w={260}
                  position="bottom"
                  openDelay={150}
                >
                  <span
                    className={roomPageStyles.participantsHelpHint}
                    role="note"
                    aria-label={`Подсказка: ${participantHelp}`}
                    tabIndex={0}
                    data-testid="participants-help-hint"
                  >
                    <IconHelpCircle size={14} stroke={1.8} aria-hidden="true" />
                  </span>
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
            {/*
             * Cabinet is a secondary nav action. Keeps a light filled
             * surface (variant="light") so it's clearly clickable without
             * competing with the primary filled "Главная" CTA — `subtle`
             * was too quiet and read as a passive label per UX feedback.
             */}
            <Button
              component={Link}
              to={authToken ? "/dashboard/rooms" : "/login"}
              size="xs"
              variant="light"
              color="blue"
              leftSection={<IconUserCircle size={14} />}
            >
              Кабинет
            </Button>
            <Button
              component={Link}
              to="/"
              size="xs"
              variant="filled"
              color="blue"
              leftSection={<IconHome2 size={14} />}
            >
              Главная
            </Button>
          </div>
        </div>
      </Box>
    </Box>
  );
}
