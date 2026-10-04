import React from "react";
import {
  FolderOpenOutlined,
  BookOutlined,
  CheckOutlined,
  CheckSquareOutlined,
  CloseOutlined,
  CodeOutlined,
  ColumnHeightOutlined,
  ColumnWidthOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  FireOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
  HolderOutlined,
  HomeOutlined,
  InboxOutlined,
  LayoutOutlined,
  LogoutOutlined,
  MenuOutlined,
  MessageOutlined,
  MoreOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  ReadOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  UserOutlined,
  DownloadOutlined,
  DownOutlined,
  RightOutlined,
} from "@ant-design/icons";

type IconProps = { size?: number; stroke?: number; className?: string; style?: React.CSSProperties; [key: string]: unknown };
function makeIcon(Icon: React.ComponentType<any>) {
  return function DesignSystemIcon({ size = 16, stroke: _stroke, style, ...props }: IconProps) {
    return <Icon {...props} style={{ fontSize: size, ...style }} />;
  };
}

export const IconArchive = makeIcon(FolderOpenOutlined);
export const IconArchiveOff = makeIcon(InboxOutlined);
export const IconBookmark = makeIcon(BookOutlined);
export const IconBolt = makeIcon(ThunderboltOutlined);
export const IconBook2 = makeIcon(ReadOutlined);
export const IconCheck = makeIcon(CheckOutlined);
export const IconChecklist = makeIcon(CheckSquareOutlined);
export const IconChevronDown = makeIcon(DownOutlined);
export const IconChevronRight = makeIcon(RightOutlined);
export const IconCode = makeIcon(CodeOutlined);
export const IconCopy = makeIcon(CopyOutlined);
export const IconDots = makeIcon(MoreOutlined);
export const IconDownload = makeIcon(DownloadOutlined);
export const IconEdit = makeIcon(EditOutlined);
export const IconFileDescription = makeIcon(FileTextOutlined);
export const IconGripVertical = makeIcon(HolderOutlined);
export const IconHelpCircle = makeIcon(QuestionCircleOutlined);
export const IconHome2 = makeIcon(HomeOutlined);
export const IconLayoutColumns = makeIcon(ColumnWidthOutlined);
export const IconLayoutDashboard = makeIcon(LayoutOutlined);
export const IconLayoutRows = makeIcon(ColumnHeightOutlined);
export const IconLogout2 = makeIcon(LogoutOutlined);
export const IconMenu2 = makeIcon(MenuOutlined);
export const IconMessages = makeIcon(MessageOutlined);
export const IconNote = makeIcon(FileTextOutlined);
export const IconPencil = makeIcon(EditOutlined);
export const IconPlus = makeIcon(PlusOutlined);
export const IconRefresh = makeIcon(ReloadOutlined);
export const IconRobot = makeIcon(FireOutlined);
export const IconRocket = makeIcon(ThunderboltOutlined);
export const IconShieldCheck = makeIcon(SafetyCertificateOutlined);
export const IconTrash = makeIcon(DeleteOutlined);
export const IconUserCircle = makeIcon(UserOutlined);
export const IconUsers = makeIcon(TeamOutlined);
export const IconX = makeIcon(CloseOutlined);
export const IconArrowsDiagonal = makeIcon(FullscreenOutlined);
export const IconArrowsDiagonalMinimize2 = makeIcon(FullscreenExitOutlined);
