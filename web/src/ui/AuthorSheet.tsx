// 가족 작가(그린 사람) 고치기: 이름·얼굴·색, 추가, 숨기기
import { LIMITS } from "@shared/limits";
import { AUTHOR_COLORS, AUTHOR_EMOJIS, type Author } from "@shared/types";
import { useState } from "react";
import { useData } from "../app/data";
import { friendlyError } from "../lib/api";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";

interface Draft {
  id: string | null;
  name: string;
  emoji: string;
  color: string;
}

const fromAuthor = (a: Author): Draft => ({ id: a.id, name: a.name, emoji: a.emoji, color: a.color });

interface Props {
  currentId: string | null;
  onClose: () => void;
  onPicked: (id: string) => void;
}

export function AuthorSheet({ currentId, onClose, onPicked }: Props) {
  const { authors, addAuthor, updateAuthor, hideAuthor } = useData();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!draft || busy) return;
    const name = draft.name.trim();
    if (!name) {
      toast("이름을 적어 주세요");
      return;
    }
    setBusy(true);
    try {
      if (draft.id) {
        await updateAuthor(draft.id, { name, emoji: draft.emoji, color: draft.color });
      } else {
        const created = await addAuthor({ name, emoji: draft.emoji, color: draft.color });
        onPicked(created.id);
      }
      setDraft(null);
    } catch (error) {
      toast(friendlyError(error), { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function hide() {
    if (!draft?.id || busy) return;
    setBusy(true);
    try {
      await hideAuthor(draft.id);
      toast("휴지통으로 옮겼어요. 앨범 > 휴지통에서 되살릴 수 있어요");
      setDraft(null);
    } catch (error) {
      toast(friendlyError(error), { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="누가 그려요?" onClose={onClose}>
      <div className="author-list">
        {authors.map((a) => (
          <span key={a.id} className="author-pick">
            <button
              type="button"
              className={`author-chip ${currentId === a.id ? "on" : ""}`}
              style={{ borderColor: a.color, background: currentId === a.id ? a.color : undefined }}
              onClick={() => {
                onPicked(a.id);
                onClose();
              }}
            >
              <span aria-hidden>{a.emoji}</span> {a.name}
            </button>
            <button
              type="button"
              className={`mini-btn ${draft?.id === a.id ? "on" : ""}`}
              onClick={() => setDraft(fromAuthor(a))}
              aria-label={`${a.name} 고치기`}
            >
              ✏️
            </button>
          </span>
        ))}
        {authors.length < LIMITS.authorsMax && (
          <button
            type="button"
            className="author-chip add"
            onClick={() => setDraft({ id: null, name: "", emoji: "🐱", color: AUTHOR_COLORS[3] })}
          >
            ➕ 새 사람
          </button>
        )}
      </div>

      {draft && (
        <div className="author-form">
          <label className="field">
            <span>이름</span>
            <input
              value={draft.name}
              maxLength={LIMITS.authorNameMax}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="예: 할머니"
            />
          </label>
          <div className="field">
            <span>얼굴</span>
            <div className="emoji-grid">
              {AUTHOR_EMOJIS.map((em) => (
                <button
                  type="button"
                  key={em}
                  className={draft.emoji === em ? "on" : ""}
                  onClick={() => setDraft({ ...draft, emoji: em })}
                >
                  {em}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span>색</span>
            <div className="color-grid">
              {AUTHOR_COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  aria-label={c}
                  className={draft.color === c ? "on" : ""}
                  style={{ background: c }}
                  onClick={() => setDraft({ ...draft, color: c })}
                />
              ))}
            </div>
          </div>
          <div className="form-actions">
            {draft.id && (
              <button type="button" className="ghost-btn danger" onClick={hide} disabled={busy}>
                🗑 숨기기
              </button>
            )}
            <button type="button" className="primary-btn" onClick={save} disabled={busy}>
              {draft.id ? "저장" : "추가"}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
