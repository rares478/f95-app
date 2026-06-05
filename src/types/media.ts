export interface MediaFile {
  path: string;
  name: string;
  size: number;
}

export interface InstallMediaIndex {
  images: MediaFile[];
  videos: MediaFile[];
  pdfs: MediaFile[];
  archives: MediaFile[];
  suggestedEntry?: string;
}

export interface CbzPreviewResult {
  tempDir: string;
  pages: string[];
}

export type MediaViewKind = 'image' | 'video' | 'pdf' | 'cbz';

export interface MediaViewItem {
  kind: MediaViewKind;
  path: string;
  name: string;
  size?: number;
  /** Populated after CBZ extraction — page image paths. */
  cbzPages?: string[];
}
