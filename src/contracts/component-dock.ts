import type { ComponentContent } from './collaboration';
export type DockCard = { id: string; revision: number; content: ComponentContent; preparing: boolean };
export type ComponentDockView = {
  meetingId: string | null;
  locale: string;
  cards: DockCard[];
  selectedId: string | null;
  pinned: boolean;
};
