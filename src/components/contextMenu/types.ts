export interface ContextMenuItem {
  id: string;
  label: string;
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
  hidden?: boolean;
  title?: string;
}

export interface OpenContextMenuOptions {
  x: number;
  y: number;
  items: ContextMenuItem[];
}
