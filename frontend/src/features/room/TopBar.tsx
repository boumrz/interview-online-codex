import React from "react";
import {
  Badge,
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
  IconLayoutDashboard,
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
];

export type Participant = {
  sessionId: string;
  displayName: string;
  userId?: string | null;
  participantId?: string | null;
  role: "owner" | "interviewer" | "candidate";
  presenceStatus: "active" | "away";
  isAuthenticated?: boolean;
  canBeGrantedInterviewerAccess?: boolean;
};

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
  onToggleInterviewerRole,
}: TopBarProps) {
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
                const canOpenMenu =
                  canGrantAccess &&
                  participant.role !== "owner" &&
                  (participant.canBeGrantedInterviewerAccess ?? true);
                const isInterviewer = participant.role === "interviewer";
                const menuActionLabel = isInterviewer
                  ? "Снять роль интервьюера"
                  : "Назначить интервьюером";
                const { color: cursorColor, colorLight: cursorColorLight } =
                  awarenessUserColors(participant.sessionId);
                const participantCard = (
                  <span className={roomPageStyles.participantNameRow}>
                    <span className={roomPageStyles.participantName}>
                      {participant.displayName}
                    </span>
                    {isInterviewer ? (
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
                        label={menuActionLabel}
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
                          aria-label={`${participant.displayName}, ${presenceLabel}. ${menuActionLabel}`}
                          aria-haspopup="menu"
                        >
                          {participantCard}
                        </button>
                      </Tooltip>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item
                        onClick={() => onToggleInterviewerRole(participant)}
                      >
                        {menuActionLabel}
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                );
              })}

              {/*
               * Compact discoverability helper: shown only when the owner can
               * actually promote someone (canGrantAccess + ≥1 promotable
               * participant). Lives in the same row as the chips, opacity 0.6,
               * tooltip carries the full instruction. This avoids a permanent
               * banner while still teaching the click-to-promote affordance.
               */}
              {canGrantAccess &&
              participants.some(
                (p) =>
                  p.role !== "owner" &&
                  (p.canBeGrantedInterviewerAccess ?? true),
              ) ? (
                <Tooltip
                  label="Кликните по нику участника, чтобы назначить или снять роль интервьюера"
                  withArrow
                  multiline
                  w={260}
                  position="bottom"
                  openDelay={150}
                >
                  <span
                    className={roomPageStyles.participantsHelpHint}
                    role="note"
                    aria-label="Подсказка: кликните по участнику, чтобы назначить или снять роль интервьюера"
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
            <Badge color={connected ? "teal" : "gray"} variant="light">
              {connected ? "Подключено" : "Подключение"}
            </Badge>
            <Button
              component={Link}
              to={authToken ? "/dashboard/rooms" : "/login"}
              size="xs"
              variant="light"
              color="gray"
              leftSection={<IconLayoutDashboard size={14} />}
            >
              Кабинет
            </Button>
            <Button
              component={Link}
              to="/"
              size="xs"
              variant="outline"
              color="gray"
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
