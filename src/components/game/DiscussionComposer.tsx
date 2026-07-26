import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from 'react';
import DOMPurify from 'dompurify';
import { openUrl } from '@tauri-apps/plugin-opener';
import { GameDescription } from './GameDescription';
import { dialog } from '../../lib/dialog';
import { bbcodePreview } from '../../lib/ipc';
import { formatIpcError } from '../../lib/ipcError';
import {
  insertBbcodeImage,
  insertBbcodeList,
  insertBbcodeUrl,
  wrapBbcodeTag,
  type BbcodeEditResult,
  type BbcodeSelection,
} from '../../lib/bbcodeToolbar';
import { useT } from '../../lib/i18n';

type ComposerTab = 'write' | 'preview';

export interface DiscussionComposerProps {
  threadId: string;
  draft: string;
  onDraftChange: (next: string) => void;
  replyBusy: boolean;
  replyError: string | null;
  replyNeedsBrowser: boolean;
  onSubmit: (e: FormEvent) => void;
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

export function DiscussionComposer({
  threadId,
  draft,
  onDraftChange,
  replyBusy,
  replyError,
  replyNeedsBrowser,
  onSubmit,
  textareaRef: textareaRefProp,
  writeFocusKey = 0,
  formRef,
}: DiscussionComposerProps) {
  const { t } = useT();
  const localTextareaRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = textareaRefProp ?? localTextareaRef;

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
      void bbcodePreview(draft)
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
  }, [tab, draft]);

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

  const toolbarDisabled = replyBusy || tab !== 'write';

  return (
    <form
      ref={formRef}
      className="thread-discussion-composer"
      onSubmit={onSubmit}
    >
      <div className="thread-discussion-composer-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'write'}
          className={
            tab === 'write'
              ? 'thread-discussion-composer-tab thread-discussion-composer-tab--active'
              : 'thread-discussion-composer-tab'
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
              ? 'thread-discussion-composer-tab thread-discussion-composer-tab--active'
              : 'thread-discussion-composer-tab'
          }
          onClick={() => setTab('preview')}
        >
          {t('gamedetail.discussion.preview')}
        </button>
      </div>

      <div className="thread-discussion-bb-toolbar" role="toolbar" aria-label="BBCode">
        <button
          type="button"
          className="thread-discussion-bb-btn"
          title={t('gamedetail.discussion.bb.bold')}
          aria-label={t('gamedetail.discussion.bb.bold')}
          disabled={toolbarDisabled}
          onClick={() => onWrap('B')}
        >
          B
        </button>
        <button
          type="button"
          className="thread-discussion-bb-btn"
          title={t('gamedetail.discussion.bb.italic')}
          aria-label={t('gamedetail.discussion.bb.italic')}
          disabled={toolbarDisabled}
          onClick={() => onWrap('I')}
        >
          I
        </button>
        <button
          type="button"
          className="thread-discussion-bb-btn"
          title={t('gamedetail.discussion.bb.underline')}
          aria-label={t('gamedetail.discussion.bb.underline')}
          disabled={toolbarDisabled}
          onClick={() => onWrap('U')}
        >
          U
        </button>
        <button
          type="button"
          className="thread-discussion-bb-btn"
          title={t('gamedetail.discussion.bb.spoiler')}
          aria-label={t('gamedetail.discussion.bb.spoiler')}
          disabled={toolbarDisabled}
          onClick={() => onWrap('SPOILER')}
        >
          Spoiler
        </button>
        <button
          type="button"
          className="thread-discussion-bb-btn"
          title={t('gamedetail.discussion.bb.url')}
          aria-label={t('gamedetail.discussion.bb.url')}
          disabled={toolbarDisabled}
          onClick={onUrl}
        >
          URL
        </button>
        <button
          type="button"
          className="thread-discussion-bb-btn"
          title={t('gamedetail.discussion.bb.image')}
          aria-label={t('gamedetail.discussion.bb.image')}
          disabled={toolbarDisabled}
          onClick={onImage}
        >
          Image
        </button>
        <button
          type="button"
          className="thread-discussion-bb-btn"
          title={t('gamedetail.discussion.bb.list')}
          aria-label={t('gamedetail.discussion.bb.list')}
          disabled={toolbarDisabled}
          onClick={onList}
        >
          List
        </button>
        <button
          type="button"
          className="thread-discussion-bb-btn"
          title={t('gamedetail.discussion.bb.code')}
          aria-label={t('gamedetail.discussion.bb.code')}
          disabled={toolbarDisabled}
          onClick={() => onWrap('CODE')}
        >
          Code
        </button>
      </div>

      <label
        className="thread-discussion-composer-label"
        htmlFor={`thread-reply-${threadId}`}
      >
        {t('gamedetail.discussion.replyPlaceholder')}
      </label>

      {tab === 'write' ? (
        <textarea
          ref={textareaRef}
          id={`thread-reply-${threadId}`}
          className="thread-discussion-composer-input"
          rows={3}
          value={draft}
          disabled={replyBusy}
          placeholder={t('gamedetail.discussion.replyPlaceholder')}
          onChange={(e) => onDraftChange(e.target.value)}
        />
      ) : (
        <div className="thread-discussion-preview" aria-live="polite">
          {!draft.trim() ? (
            <div className="thread-discussion-preview-hint">
              {t('gamedetail.discussion.previewEmpty')}
            </div>
          ) : previewLoading ? (
            <div className="thread-discussion-preview-hint">
              {t('gamedetail.discussion.previewLoading')}
            </div>
          ) : previewError ? (
            <div className="thread-discussion-preview-error" role="alert">
              {t('gamedetail.discussion.previewFailed', { error: previewError })}
            </div>
          ) : previewHtml != null ? (
            <GameDescription
              html={sanitizePostHtml(previewHtml)}
              className="thread-post-body thread-discussion-preview-body"
            />
          ) : null}
        </div>
      )}

      {replyError && (
        <div className="thread-discussion-composer-error" role="alert">
          {t('gamedetail.discussion.replyFailed', { error: replyError })}
          {replyNeedsBrowser && (
            <button
              type="button"
              className="thread-discussion-open-f95"
              onClick={() =>
                void openUrl(`https://f95zone.to/threads/${threadId}/`)
              }
            >
              {t('gamedetail.discussion.replyOpenOnF95')}
            </button>
          )}
        </div>
      )}

      <div className="thread-discussion-composer-actions">
        <button
          type="submit"
          className="thread-discussion-pager-btn thread-discussion-composer-submit"
          disabled={replyBusy || !draft.trim()}
        >
          {replyBusy
            ? t('gamedetail.discussion.replyPosting')
            : t('gamedetail.discussion.replyPost')}
        </button>
      </div>
    </form>
  );
}
