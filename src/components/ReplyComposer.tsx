import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from 'react';
import DOMPurify from 'dompurify';
import { openUrl } from '@tauri-apps/plugin-opener';
import { GameDescription } from './game/GameDescription';
import { dialog } from '../lib/dialog';
import { formatIpcError } from '../lib/ipcError';
import {
  insertBbcodeImage,
  insertBbcodeList,
  insertBbcodeUrl,
  wrapBbcodeTag,
  type BbcodeEditResult,
  type BbcodeSelection,
} from '../lib/bbcodeToolbar';
import {
  composerIdFor,
  openOnF95UrlFor,
  previewBbcodeFor,
  type BbcodePreviewTarget,
} from '../lib/replyComposer';
import { useT } from '../lib/i18n';
import '../styles/reply-composer.css';

type ComposerTab = 'write' | 'preview';

export interface ReplyComposerProps {
  /** Routes BBCode preview to the correct F95 endpoint. */
  previewTarget: BbcodePreviewTarget;
  /** Optional override for captcha / browser fallback link. */
  openOnF95Url?: string | null;
  draft: string;
  onDraftChange: (next: string) => void;
  replyBusy: boolean;
  replyError: string | null;
  replyNeedsBrowser: boolean;
  onSubmit: (e: FormEvent) => void;
  disabled?: boolean;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  /** Increment to switch to Write and focus the textarea (e.g. after Quote). */
  writeFocusKey?: number;
  formRef?: RefObject<HTMLFormElement | null>;
}

function sanitizePostHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ['details', 'summary', 'button'],
    ADD_ATTR: ['target', 'rel', 'loading', 'type', 'hidden'],
  });
}

/**
 * Shared BBCode reply box: toolbar, write/preview tabs, submit chrome.
 * Wire `previewTarget` to thread or conversation helpers in `lib/replyComposer.ts`.
 */
export function ReplyComposer({
  previewTarget,
  openOnF95Url,
  draft,
  onDraftChange,
  replyBusy,
  replyError,
  replyNeedsBrowser,
  onSubmit,
  disabled = false,
  textareaRef: textareaRefProp,
  writeFocusKey = 0,
  formRef,
}: ReplyComposerProps) {
  const { t } = useT();
  const localTextareaRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = textareaRefProp ?? localTextareaRef;
  const targetKey =
    previewTarget.kind === 'thread'
      ? `thread:${previewTarget.threadId}`
      : `conversation:${previewTarget.conversationPath}`;
  const composerId = useMemo(() => composerIdFor(previewTarget), [targetKey]);
  const f95Url = useMemo(
    () => openOnF95UrlFor(previewTarget, openOnF95Url),
    [targetKey, openOnF95Url],
  );

  const [tab, setTab] = useState<ComposerTab>('write');
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (!writeFocusKey) return;
    setTab('write');
  }, [writeFocusKey]);

  useEffect(() => {
    if (!writeFocusKey || tab !== 'write') return;
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }, [writeFocusKey, tab, textareaRef]);

  useEffect(() => {
    if (tab !== 'preview') return;
    const trimmed = draft.trim();
    if (!trimmed) {
      setPreviewHtml(null);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }

    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    const timer = window.setTimeout(() => {
      void previewBbcodeFor(previewTarget, draft)
        .then((result) => {
          if (cancelled) return;
          setPreviewHtml(result.html);
          setPreviewLoading(false);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setPreviewError(formatIpcError(err));
          setPreviewHtml(null);
          setPreviewLoading(false);
        });
    }, 400);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [tab, draft, targetKey]);

  const getSelection = (): BbcodeSelection => {
    const el = textareaRef.current;
    if (!el) return { value: draft, start: draft.length, end: draft.length };
    return { value: draft, start: el.selectionStart, end: el.selectionEnd };
  };

  const applyEdit = (result: BbcodeEditResult) => {
    onDraftChange(result.value);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(result.start, result.end);
    });
  };

  const onWrap = (tag: string) => {
    applyEdit(wrapBbcodeTag(getSelection(), tag));
  };

  const onUrl = async () => {
    const selection = getSelection();
    const url = await dialog.prompt(t('gamedetail.discussion.bb.urlPrompt'), {
      title: t('gamedetail.discussion.bb.url'),
    });
    if (url == null || !url.trim()) return;
    applyEdit(insertBbcodeUrl(selection, url.trim()));
  };

  const onImage = async () => {
    const selection = getSelection();
    const url = await dialog.prompt(t('gamedetail.discussion.bb.imagePrompt'), {
      title: t('gamedetail.discussion.bb.image'),
    });
    if (url == null || !url.trim()) return;
    applyEdit(insertBbcodeImage(selection, url.trim()));
  };

  const onList = () => {
    applyEdit(insertBbcodeList(getSelection()));
  };

  const inputDisabled = replyBusy || disabled;
  const toolbarDisabled = inputDisabled || tab !== 'write';

  return (
    <form ref={formRef} className="reply-composer" onSubmit={onSubmit}>
      <div className="reply-composer-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'write'}
          className={
            tab === 'write'
              ? 'reply-composer-tab reply-composer-tab--active'
              : 'reply-composer-tab'
          }
          onClick={() => setTab('write')}
        >
          {t('gamedetail.discussion.write')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'preview'}
          className={
            tab === 'preview'
              ? 'reply-composer-tab reply-composer-tab--active'
              : 'reply-composer-tab'
          }
          onClick={() => setTab('preview')}
        >
          {t('gamedetail.discussion.preview')}
        </button>
      </div>

      <div className="reply-composer-bb-toolbar" role="toolbar" aria-label="BBCode">
        <button
          type="button"
          className="reply-composer-bb-btn"
          title={t('gamedetail.discussion.bb.bold')}
          aria-label={t('gamedetail.discussion.bb.bold')}
          disabled={toolbarDisabled}
          onClick={() => onWrap('B')}
        >
          B
        </button>
        <button
          type="button"
          className="reply-composer-bb-btn"
          title={t('gamedetail.discussion.bb.italic')}
          aria-label={t('gamedetail.discussion.bb.italic')}
          disabled={toolbarDisabled}
          onClick={() => onWrap('I')}
        >
          I
        </button>
        <button
          type="button"
          className="reply-composer-bb-btn"
          title={t('gamedetail.discussion.bb.underline')}
          aria-label={t('gamedetail.discussion.bb.underline')}
          disabled={toolbarDisabled}
          onClick={() => onWrap('U')}
        >
          U
        </button>
        <button
          type="button"
          className="reply-composer-bb-btn"
          title={t('gamedetail.discussion.bb.spoiler')}
          aria-label={t('gamedetail.discussion.bb.spoiler')}
          disabled={toolbarDisabled}
          onClick={() => onWrap('SPOILER')}
        >
          Spoiler
        </button>
        <button
          type="button"
          className="reply-composer-bb-btn"
          title={t('gamedetail.discussion.bb.url')}
          aria-label={t('gamedetail.discussion.bb.url')}
          disabled={toolbarDisabled}
          onClick={onUrl}
        >
          URL
        </button>
        <button
          type="button"
          className="reply-composer-bb-btn"
          title={t('gamedetail.discussion.bb.image')}
          aria-label={t('gamedetail.discussion.bb.image')}
          disabled={toolbarDisabled}
          onClick={onImage}
        >
          Image
        </button>
        <button
          type="button"
          className="reply-composer-bb-btn"
          title={t('gamedetail.discussion.bb.list')}
          aria-label={t('gamedetail.discussion.bb.list')}
          disabled={toolbarDisabled}
          onClick={onList}
        >
          List
        </button>
        <button
          type="button"
          className="reply-composer-bb-btn"
          title={t('gamedetail.discussion.bb.code')}
          aria-label={t('gamedetail.discussion.bb.code')}
          disabled={toolbarDisabled}
          onClick={() => onWrap('CODE')}
        >
          Code
        </button>
      </div>

      <label className="reply-composer-label" htmlFor={composerId}>
        {t('gamedetail.discussion.replyPlaceholder')}
      </label>

      {tab === 'write' ? (
        <textarea
          ref={textareaRef}
          id={composerId}
          className="reply-composer-input"
          rows={3}
          value={draft}
          disabled={inputDisabled}
          placeholder={t('gamedetail.discussion.replyPlaceholder')}
          onChange={(e) => onDraftChange(e.target.value)}
        />
      ) : (
        <div className="reply-composer-preview" aria-live="polite">
          {!draft.trim() ? (
            <div className="reply-composer-preview-hint">
              {t('gamedetail.discussion.previewEmpty')}
            </div>
          ) : previewLoading ? (
            <div className="reply-composer-preview-hint">
              {t('gamedetail.discussion.previewLoading')}
            </div>
          ) : previewError ? (
            <div className="reply-composer-preview-error" role="alert">
              {t('gamedetail.discussion.previewFailed', { error: previewError })}
            </div>
          ) : previewHtml != null ? (
            <GameDescription
              html={sanitizePostHtml(previewHtml)}
              className="reply-composer-preview-body"
            />
          ) : null}
        </div>
      )}

      {replyError && (
        <div className="reply-composer-error" role="alert">
          {t('gamedetail.discussion.replyFailed', { error: replyError })}
          {replyNeedsBrowser && f95Url && (
            <button
              type="button"
              className="reply-composer-open-f95"
              onClick={() => void openUrl(f95Url)}
            >
              {t('gamedetail.discussion.replyOpenOnF95')}
            </button>
          )}
        </div>
      )}

      <div className="reply-composer-actions">
        <button
          type="submit"
          className="reply-composer-submit"
          disabled={inputDisabled || !draft.trim()}
        >
          {replyBusy
            ? t('gamedetail.discussion.replyPosting')
            : t('gamedetail.discussion.replyPost')}
        </button>
      </div>
    </form>
  );
}
